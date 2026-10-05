/**
 * Matching a supplier's line to an item in the pharmacy's catalogue.
 *
 * The brief from the pharmacy was blunt: be right, and when you cannot be,
 * say so. So this module never returns a bare answer. Every line comes back
 * with a confidence and the reasons behind it, and only `certain` is allowed to
 * flow into an order untouched.
 *
 * Three signals decide a match, and they are deliberately independent:
 *
 *   brand    the consonant skeleton (see phonetic.ts)
 *   price    the public price, which both sides print
 *   strength the dose, which rules out look-alikes
 *
 * One signal alone is never enough. A brand that matches perfectly at the wrong
 * price is suspicious — prices do rise, but so do confusions between a 20-tablet
 * pack and a 30-tablet one. Two brands that sound alike at the same price are
 * worse: MOFLOX 400 sells for 184 and MOXIFLOX 400 for 180, and the pharmacy
 * stocks both. Cases like that must reach a human, every time.
 */

import type { Alias, Candidate, CatalogItem, Confidence, MatchReason, MatchResult, SupplierLine } from './types.ts';
import { parseLine, aliasKey, type ParsedLine } from './tokens.ts';
import { phraseSimilarity } from './phonetic.ts';

/** Below this brand similarity an item is not worth considering at all. */
const CANDIDATE_FLOOR = 0.6;

/**
 * Relaxed floor for a candidate whose price matches to the piastre.
 *
 * Suppliers drop words the catalogue keeps: "لبن هيرو ٢" is HERO BABY 2 MILK
 * with "baby" left out, which costs enough brand similarity to fall under the
 * normal floor. An exact price is an independent signal, so it earns the item a
 * hearing — but never a verdict, because `certain` still demands an exact brand.
 */
const PRICE_BACKED_FLOOR = 0.5;

/** A `likely` match needs at least this much brand similarity. */
const LIKELY_FLOOR = 0.72;

/**
 * How far the best candidate must out-score the runner-up to be called certain.
 * Two plausible items at the same price is exactly the MOFLOX/MOXIFLOX trap, so
 * the gap is wide on purpose.
 */
const RIVAL_MARGIN = 0.15;

/** Treat prices this close as equal, to absorb rounding in scanned documents. */
const PRICE_TOLERANCE = 0.01;

interface IndexedItem {
  item: CatalogItem;
  parsed: ParsedLine;
}

/**
 * Pre-computed view of the catalogue.
 *
 * Parsing 26,000 names costs about a second, so we do it once and keep it.
 * Lookups go through the brand skeleton and the price; the bucket index exists
 * so a near-miss on the skeleton does not force a scan of the whole catalogue.
 */
export class CatalogIndex {
  private readonly items: IndexedItem[] = [];
  private readonly byKey = new Map<string, IndexedItem[]>();
  private readonly byPrice = new Map<number, IndexedItem[]>();
  /** Keyed by first consonant, for candidates whose skeleton is close but not equal. */
  private readonly byInitial = new Map<string, IndexedItem[]>();
  private readonly byBarcode = new Map<string, IndexedItem>();
  private readonly byItemCode = new Map<string, CatalogItem>();

  constructor(catalog: CatalogItem[]) {
    for (const item of catalog) {
      const parsed = parseLine(item.name, item.price);
      const indexed: IndexedItem = { item, parsed };
      this.items.push(indexed);

      this.byItemCode.set(item.code, item);
      push(this.byKey, parsed.key, indexed);
      push(this.byPrice, round(item.price), indexed);
      if (parsed.key) push(this.byInitial, parsed.key[0], indexed);

      for (const barcode of item.barcodes ?? []) {
        const clean = barcode.trim();
        if (clean) this.byBarcode.set(clean, indexed);
      }
    }
  }

  get size(): number {
    return this.items.length;
  }

  byCode(code: string): CatalogItem | undefined {
    return this.byItemCode.get(code);
  }

  lookupBarcode(barcode: string): IndexedItem | undefined {
    return this.byBarcode.get(barcode.trim());
  }

  /**
   * Everything worth scoring for this line: exact skeleton matches, anything at
   * the same price, and near-misses that share a first consonant.
   */
  candidates(parsed: ParsedLine, price?: number): IndexedItem[] {
    const found = new Set<IndexedItem>();

    for (const item of this.byKey.get(parsed.key) ?? []) found.add(item);

    if (price !== undefined) {
      for (const item of this.byPrice.get(round(price)) ?? []) found.add(item);
    }

    if (parsed.key) {
      // Only scan skeletons of a comparable length — a brand cannot gain or lose
      // half its consonants in transliteration.
      const tolerance = Math.max(1, Math.floor(parsed.key.length * 0.34));
      for (const item of this.byInitial.get(parsed.key[0]) ?? []) {
        if (Math.abs(item.parsed.key.length - parsed.key.length) <= tolerance) found.add(item);
      }
    }

    return [...found];
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function round(price: number): number {
  return Math.round(price * 100) / 100;
}

function pricesAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= PRICE_TOLERANCE;
}

/**
 * Compare two sets of numbers pulled off the same kind of field.
 *
 * Silence on either side is not disagreement — most supplier lines state fewer
 * numbers than the catalogue does. Only two populated sets that share nothing
 * count as a conflict.
 */
function compareNumbers(a: number[], b: number[]): 'agree' | 'conflict' | 'unknown' {
  if (!a.length || !b.length) return 'unknown';
  return a.some((value) => b.includes(value)) ? 'agree' : 'conflict';
}

/**
 * Weights, gathered here because they are the one thing worth tuning against
 * real invoices. They were fitted to the 49 transcribed lines, and the shape
 * matters more than the exact values:
 *
 *   An exact brand outranks any amount of partial agreement, so it is a flat
 *   award rather than a multiple of similarity. Price is the strongest
 *   secondary signal but a weak veto, because suppliers really do raise prices
 *   mid-week and annotate the line "سعر جديد". Strength is the opposite — a
 *   wrong dose is a wrong product, so it is the heaviest penalty in the table.
 */
const WEIGHTS = {
  brandExact: 0.75,
  brandPartial: 0.7,
  priceAgrees: 0.25,
  priceDiffers: -0.1,
  strengthAgrees: 0.05,
  strengthDiffers: -0.45,
  formAgrees: 0.12,
  formDiffers: -0.22,
  packAgrees: 0.05,
  packDiffers: -0.08,
} as const;

function scoreCandidate(
  parsed: ParsedLine,
  line: SupplierLine,
  candidate: IndexedItem,
): Candidate {
  const reasons: MatchReason[] = [];
  const similarity = phraseSimilarity(parsed.key, candidate.parsed.key);
  const exactBrand = similarity >= 0.999;

  reasons.push(
    exactBrand
      ? { code: 'phonetic-exact' }
      : { code: 'phonetic-close', detail: `${Math.round(similarity * 100)}% brand match` },
  );

  let score = exactBrand ? WEIGHTS.brandExact : similarity * WEIGHTS.brandPartial;

  const offerPrice = line.price ?? parsed.priceHint;
  if (offerPrice === undefined) {
    reasons.push({ code: 'price-missing' });
  } else if (pricesAgree(offerPrice, candidate.item.price)) {
    score += WEIGHTS.priceAgrees;
    reasons.push({ code: 'price-agrees', detail: `${offerPrice} EGP` });
  } else {
    score += WEIGHTS.priceDiffers;
    reasons.push({
      code: 'price-differs',
      detail: `catalogue ${candidate.item.price} vs offer ${offerPrice}`,
    });
  }

  const strength = compareNumbers(parsed.strengths, candidate.parsed.strengths);
  if (strength === 'conflict') {
    // A different dose is a different product, whatever the name suggests.
    score += WEIGHTS.strengthDiffers;
    reasons.push({
      code: 'strength-differs',
      detail: `${parsed.strengths.join('/')} vs ${candidate.parsed.strengths.join('/')}`,
    });
  } else if (strength === 'agree') {
    score += WEIGHTS.strengthAgrees;
    reasons.push({ code: 'strength-agrees', detail: parsed.strengths.join('/') });
  }

  if (parsed.form && candidate.parsed.form) {
    const same = parsed.form === candidate.parsed.form;
    score += same ? WEIGHTS.formAgrees : WEIGHTS.formDiffers;
    if (!same) {
      reasons.push({ code: 'form-differs', detail: `${parsed.form} vs ${candidate.parsed.form}` });
    }
  }

  // Pack sizes, strip counts and volumes. Individually weak — a supplier writing
  // "٣شريط" against a catalogue "TAB/3" is agreement, and neither states it
  // reliably — but they are what separates HERO BABY 1 from HERO BABY 2, and
  // KEPRADIL 500 XR from KEPRADIL XR 750, where everything else is identical.
  for (const pair of [
    [parsed.looseNumbers, candidate.parsed.looseNumbers],
    [parsed.volumes, candidate.parsed.volumes],
  ] as const) {
    const verdict = compareNumbers(pair[0], pair[1]);
    if (verdict === 'agree') score += WEIGHTS.packAgrees;
    else if (verdict === 'conflict') score += WEIGHTS.packDiffers;
  }

  return { item: candidate.item, score: clamp(score), brandSimilarity: similarity, reasons };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function has(reasons: MatchReason[], code: MatchReason['code']): boolean {
  return reasons.some((r) => r.code === code);
}

export interface MatchOptions {
  /** Confirmed spellings, keyed by `${supplier}\u0000${aliasKey}`. */
  aliases?: Map<string, Alias>;
  /**
   * How many runners-up to return. Three is enough for a correction menu;
   * tooling that needs the full shortlist (building test fixtures, explaining a
   * decision) can ask for more.
   */
  keepAlternatives?: number;
}

/**
 * Match one supplier line against the catalogue.
 *
 * Returns the best candidate with a confidence, plus up to three alternatives so
 * the pharmacist can correct a `likely` or `unknown` without searching by hand.
 */
export function matchLine(
  line: SupplierLine,
  index: CatalogIndex,
  options: MatchOptions = {},
): MatchResult {
  const parsed = parseLine(line.raw, line.price);

  // A barcode is unambiguous, so it short-circuits everything else.
  if (line.barcode) {
    const hit = index.lookupBarcode(line.barcode);
    if (hit) {
      return {
        line,
        confidence: 'certain',
        best: { item: hit.item, score: 1, brandSimilarity: 1, reasons: [{ code: 'barcode' }] },
        alternatives: [],
        reasons: [{ code: 'barcode' }],
      };
    }
  }

  // A spelling this supplier has used before, already confirmed by a human.
  const alias = options.aliases?.get(`${line.supplier}\u0000${aliasKey(parsed)}`);
  if (alias) {
    const item = index.byCode(alias.code);
    if (item) {
      const reasons: MatchReason[] = [{ code: 'learned-alias', detail: `confirmed ${alias.confirmedAt}` }];
      return {
        line,
        confidence: 'certain',
        best: { item, score: 1, brandSimilarity: 1, reasons },
        alternatives: [],
        reasons,
      };
    }
  }

  const scored = index
    .candidates(parsed, line.price ?? parsed.priceHint)
    .map((candidate) => scoreCandidate(parsed, line, candidate))
    .filter((candidate) => {
      const floor = has(candidate.reasons, 'price-agrees') ? PRICE_BACKED_FLOOR : CANDIDATE_FLOOR;
      return candidate.brandSimilarity >= floor;
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const reasons: MatchReason[] = [{ code: 'no-candidate' }];
    return { line, confidence: 'unknown', best: null, alternatives: [], reasons };
  }

  const [best, ...rest] = scored;
  const runnerUp = rest[0];
  const reasons = [...best.reasons];

  // A close second means we cannot tell the two apart — that is a question for
  // the pharmacist, not a coin flip.
  const contested = runnerUp !== undefined && best.score - runnerUp.score < RIVAL_MARGIN;
  if (contested) {
    reasons.push({ code: 'rival-candidate', detail: `also matches ${runnerUp.item.name}` });
  }

  const confidence = decide(best, contested);

  return { line, confidence, best, alternatives: rest.slice(0, options.keepAlternatives ?? 3), reasons };
}

function decide(best: Candidate, contested: boolean): Confidence {
  const exactBrand = has(best.reasons, 'phonetic-exact');
  const priceAgrees = has(best.reasons, 'price-agrees');
  const strengthClash = has(best.reasons, 'strength-differs');
  const formClash = has(best.reasons, 'form-differs');

  // Certain means all three signals point the same way and nothing else is close.
  if (exactBrand && priceAgrees && !strengthClash && !formClash && !contested) {
    return 'certain';
  }

  if (best.score >= LIKELY_FLOOR && !strengthClash) {
    return 'likely';
  }

  return 'unknown';
}

/** Match a document's worth of lines. */
export function matchLines(
  lines: SupplierLine[],
  index: CatalogIndex,
  options: MatchOptions = {},
): MatchResult[] {
  return lines.map((line) => matchLine(line, index, options));
}
