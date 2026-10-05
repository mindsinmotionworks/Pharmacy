/**
 * Phonetic matching between Arabic and Latin drug names.
 *
 * Egyptian wholesalers write brand names in Arabic letters as a straight
 * transliteration of the Latin brand: TRITTICO becomes ترتيكو, NIZAPEX becomes
 * نيزابكس. So rather than translating, we reduce both sides to the same
 * consonant skeleton and compare those.
 *
 * Three ideas make it work:
 *
 *  1. Vowels are dropped. Arabic rarely writes short vowels at all, so any
 *     vowel we see on the Latin side has no counterpart to match against.
 *  2. Sounds Arabic cannot distinguish are merged. Arabic has no /p/ or /v/,
 *     so PUMPIZAN arrives as بمبيزان — p collapses into b, v into f. Likewise
 *     س and ز are both written for a Latin S, so s and z share a class.
 *  3. Doubled letters collapse. ALLERBAN is written الليربان; whether the
 *     doubling survives transliteration is a coin flip, so neither side keeps it.
 *
 * What comes out is deliberately lossy. MOFLOX (MFLKS) and MOXIFLOX (MKSFLKS)
 * still differ, which matters — the pharmacy stocks both at nearly the same
 * price — but XANTHISTOP (SNTSTB) and its Arabic زانسيستوب (SNSTB) do not line
 * up, because the supplier dropped the "th". Cases like that fall to the price
 * check and, failing that, to the pharmacist. That is the intended behaviour:
 * this function is one signal, never the verdict.
 */

/** Arabic-Indic and Eastern Arabic-Indic digits, in order 0-9. */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Tashkeel (vowel marks), tatweel, and the zero-width joiners scanners insert. */
const ARABIC_DIACRITICS = /[ً-ٰٟـ​-‏‪-‮]/g;

/**
 * Consonant class for each Arabic letter. An empty string means the letter
 * carries no consonant we can rely on: the alef family and ع are vowel carriers,
 * and ة is a grammatical ending that transliterations drop.
 *
 * و and ي are deliberately empty too. Both double as long vowels (NIZAPEX ->
 * نيزابكس uses ي for the "i"), and we cannot tell which role they play without
 * parsing the word. Dropping them costs us the W of WELLMAN, but the Latin side
 * drops its W as well, so the two still meet.
 */
const ARABIC_CONSONANTS: Record<string, string> = {
  ا: '', أ: '', إ: '', آ: '', ء: '', ئ: '', ؤ: '', ى: '', ة: '', ع: '',
  و: '', ي: '',
  ب: 'B', پ: 'B',
  ت: 'T', ط: 'T', ث: 'T',
  ج: 'G', چ: 'G',
  ح: 'H', ه: 'H',
  خ: 'K', ك: 'K', ق: 'K',
  د: 'D', ض: 'D',
  ذ: 'S', ز: 'S', س: 'S', ص: 'S', ش: 'S', ظ: 'S',
  ر: 'R',
  غ: 'G',
  ف: 'F', ڤ: 'F',
  ل: 'L',
  م: 'M',
  ن: 'N',
};

/**
 * Latin letters that survive into the skeleton. Vowels map to nothing; letters
 * Arabic writes with the same character share a class with it.
 */
const LATIN_CONSONANTS: Record<string, string> = {
  A: '', E: '', I: '', O: '', U: '', Y: '', W: '', H: 'H',
  B: 'B', P: 'B',
  T: 'T', D: 'D',
  G: 'G', J: 'G',
  K: 'K', Q: 'K',
  S: 'S', Z: 'S',
  C: 'K', // overridden to S before a front vowel, see below
  R: 'R', L: 'L', M: 'M', N: 'N',
  F: 'F', V: 'F',
  X: 'KS',
};

/** Convert Arabic-Indic digits to ASCII so "١٨٤" and "184" compare equal. */
export function normaliseDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const arabic = ARABIC_DIGITS.indexOf(ch);
    if (arabic >= 0) {
      out += String(arabic);
      continue;
    }
    const extended = EXTENDED_ARABIC_DIGITS.indexOf(ch);
    if (extended >= 0) {
      out += String(extended);
      continue;
    }
    // Arabic decimal separator, used in strengths like ٢٫٥ مجم.
    out += ch === '٫' ? '.' : ch;
  }
  return out;
}

/**
 * Fold the many ways Arabic text encodes the same letter into one spelling, and
 * drop the vowel marks scanners pick up. Does not touch Latin characters.
 */
export function normaliseArabic(text: string): string {
  return normaliseDigits(text)
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function hasArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

/** Collapse runs of the same class: BB -> B, SS -> S. */
function collapseRuns(skeleton: string): string {
  let out = '';
  for (const ch of skeleton) {
    if (ch !== out[out.length - 1]) out += ch;
  }
  return out;
}

function latinSkeleton(word: string): string {
  const upper = word.toUpperCase();
  let out = '';

  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    const next = upper[i + 1];

    // Digraphs Arabic writes as a single letter, so they must reduce to one too.
    if (ch === 'P' && next === 'H') { out += 'F'; i++; continue; }  // PHENYL -> F
    if (ch === 'T' && next === 'H') { out += 'T'; i++; continue; }  // XANTHI -> T
    if (ch === 'C' && next === 'H') { out += 'K'; i++; continue; }  // TECHNO -> K
    if (ch === 'S' && next === 'H') { out += 'S'; i++; continue; }  // SHAMPOO -> S
    if (ch === 'G' && next === 'H') { out += 'G'; i++; continue; }
    if (ch === 'C' && next === 'K') { out += 'K'; i++; continue; }  // VICKS -> K

    // A soft C sounds like S: CALCITRON is كالسيترون, not كالكيترون.
    if (ch === 'C') {
      out += next && 'EIY'.includes(next) ? 'S' : 'K';
      continue;
    }

    out += LATIN_CONSONANTS[ch] ?? '';
  }

  return collapseRuns(out);
}

function arabicSkeleton(word: string): string {
  let out = '';
  for (const ch of normaliseArabic(word)) {
    out += ARABIC_CONSONANTS[ch] ?? '';
  }
  return collapseRuns(out);
}

/**
 * Reduce one word to its consonant skeleton, whichever script it is written in.
 * Returns an empty string for words that carry no consonants at all.
 */
export function phoneticKey(word: string): string {
  const trimmed = word.trim();
  if (!trimmed) return '';
  return hasArabic(trimmed) ? arabicSkeleton(trimmed) : latinSkeleton(trimmed);
}

/**
 * Skeleton of a whole product name, with the word boundaries removed.
 *
 * Suppliers split and join words unpredictably — TRITECT appears as the two
 * words "تراى تكت" — so we compare the run of consonants rather than the words.
 */
export function phoneticPhrase(words: string[]): string {
  return words.map(phoneticKey).join('');
}

/**
 * Levenshtein distance, capped so a hopeless pair costs us nothing to reject.
 * Returns `max + 1` once the true distance is known to exceed `max`.
 */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowBest = current[0];

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (current[j] < rowBest) rowBest = current[j];
    }

    if (rowBest > max) return max + 1;
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

/** Skeleton similarity on 0..1, where 1 means the two skeletons are identical. */
export function phoneticSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const longest = Math.max(a.length, b.length);
  return 1 - editDistance(a, b) / longest;
}

/**
 * Shortest skeleton that still identifies a brand. Below this, a containment
 * hit says almost nothing — three consonants turn up inside half the catalogue.
 */
const MIN_CONTAINMENT_LENGTH = 4;

/**
 * Similarity between two whole product names.
 *
 * Plain edit distance is unfair here, because the two sides rarely carry the
 * same number of words. A supplier writes "ويل مان اوريجينال رجال" where the
 * catalogue says "WELLMAN ORIGINAL" — the extra "رجال" (men) is true but
 * redundant, and penalising it per-character would push a correct match below
 * the threshold.
 *
 * So when one skeleton contains the other outright, we treat that as a strong
 * match and let the amount of unexplained text decide how strong. Everything
 * else falls back to edit distance.
 */
export function phraseSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  if (shorter.length >= MIN_CONTAINMENT_LENGTH && longer.includes(shorter)) {
    // Scaled by how much of the longer name the shorter one explains. Words the
    // supplier never wrote are evidence against a candidate, not a free pass:
    // BETADINE SHAMPOO and BETADINE SKIN CLEANSER both contain "BETADINE", and
    // only the leftovers tell them apart. Caps below the 0.999 that marks an
    // exact brand, so containment alone can never be certain.
    return 0.6 + 0.3 * (shorter.length / longer.length);
  }

  return phoneticSimilarity(a, b);
}
