/**
 * Pulling the useful parts out of a product line.
 *
 * Supplier lines are dense: "موفلوكس ٤٠٠مجم |١٨٤ ج س.ج" carries a brand, a
 * strength, a public price and a note that the price is new, with no consistent
 * separators. The pharmacy's own catalogue is terser but no tidier:
 * "NEXIUM 40 28TAB/4".
 *
 * We split each line into a brand phrase, the numbers that identify the pack,
 * and the dosage form, because those three answer different questions. The
 * brand says *what* it is, the strength rules out look-alikes at a different
 * dose, and the form catches a cream being offered where tablets were wanted.
 */

import { hasArabic, normaliseArabic, normaliseDigits, phoneticPhrase } from './phonetic.ts';

/** Canonical dosage forms, with the Arabic and English words that signal each. */
const FORM_WORDS: Record<string, string[]> = {
  TAB: ['اقراص', 'قرص', 'أقراص', 'tab', 'tabs', 'tablet', 'tablets', 'ق', 't'],
  CAP: ['كبسول', 'كبسولات', 'cap', 'caps', 'capsule', 'capsules'],
  SYP: ['شراب', 'syp', 'syr', 'syrup', 'susp', 'suspension'],
  CREAM: ['كريم', 'cream', 'cram', 'crm', 'cr'],
  OINT: ['مرهم', 'oint', 'ointment'],
  GEL: ['جيل', 'جل', 'gel'],
  AMP: ['امبول', 'أمبول', 'امبولات', 'amp', 'ampoule', 'ampoules'],
  VIAL: ['فيال', 'فايل', 'vial', 'vails', 'vl'],
  DROPS: ['قطره', 'قطرة', 'نقط', 'drops', 'dps', 'drop'],
  SHAMPOO: ['شامبو', 'shampoo'],
  SPRAY: ['سبراي', 'سبراى', 'بخاخ', 'spray'],
  EFF: ['فوار', 'eff', 'effervescent'],
  SUPP: ['لبوس', 'اقماع', 'supp', 'suppository', 'suppositories'],
  MILK: ['لبن', 'milk'],
  SOAP: ['صابون', 'soap'],
  SOLUTION: ['محلول', 'solution', 'sol'],
  SACHET: ['كيس', 'اكياس', 'sachet', 'sachets', 'كيوس'],
  INHALER: ['بخاخه', 'inhaler', 'inh'],
  LOTION: ['لوشن', 'غسول', 'lotion'],
  OIL: ['زيت', 'oil'],
  POWDER: ['بودره', 'بودرة', 'powder'],
};

/** word -> canonical form, built once. */
const FORM_LOOKUP = new Map<string, string>(
  Object.entries(FORM_WORDS).flatMap(([form, words]) => words.map((w) => [w, form] as const)),
);

/**
 * Words that carry no identifying information. Mostly price annotations the
 * suppliers staple onto names: "سعر جديد" and its abbreviation "س.ج" both mean
 * "new price", and a bare "ج" is the currency.
 */
const NOISE_WORDS = new Set([
  'سعر', 'جديد', 'جديده', 'س.ج', 'سج', 'ج', 'جنيه', 'ج.م', 'عادي', 'عادى',
  'شريط', 'شرايط', 'شريطين', 'علبه', 'علبة', 'عبوه', 'عبوة', 'بديل',
  'new', 'price', 'pack', 'box', 'strip', 'strips',
]);

/**
 * Descriptive words suppliers write in Arabic while the catalogue writes them
 * in English. These are translated, not transliterated: a supplier writing
 * "صابون تراى تكت مطهر" means TRITECT ANTISEPTIC SOAP, and the pharmacy stocks
 * TRITECT ACNE and TRITECT BABY alongside it, so the descriptor is the only
 * thing telling the three apart.
 *
 * Brand names never belong here — those go through transliteration.
 */
const DESCRIPTOR_GLOSSARY: Record<string, string> = {
  مطهر: 'antiseptic',
  للمضغ: 'chewable',
  مضغ: 'chewable',
  اطفال: 'baby',
  للاطفال: 'baby',
  رضع: 'infant',
  عيون: 'eye',
  للعين: 'eye',
  عين: 'eye',
  انف: 'nasal',
  للانف: 'nasal',
  شعر: 'hair',
  للشعر: 'hair',
  بشره: 'skin',
  للبشره: 'skin',
  رجال: 'men',
  سيدات: 'women',
  نساء: 'women',
  فم: 'mouth',
  مسكن: 'relief',
  مستورد: 'imported',
  بلس: 'plus',
  ثلاجه: 'refrigerator',
};

/**
 * Words that cancel the word after them as well as themselves.
 *
 * Reps annotate an offer with what a product replaces: "اوبونوف بديل الفنترن"
 * is OPONOV, sold as a substitute for Ventren. The brand named second is not
 * what is being sold, so carrying it into the key would wreck the match.
 */
const SWALLOWING_WORDS = new Set(['بديل', 'بدل', 'مثل', 'زي', 'substitute', 'alternative']);

/** Units that tell us what a neighbouring number means. */
const STRENGTH_UNITS = new Set(['مجم', 'مج', 'ملجم', 'mg', 'mcg', 'ميكروجرام', 'iu', 'وحده', 'وحدة']);
const VOLUME_UNITS = new Set(['مل', 'ملل', 'ml', 'cc', 'جم', 'جرام', 'gm', 'g', 'gram']);
const CURRENCY_UNITS = new Set(['ج', 'جنيه', 'ج.م', 'egp', 'le']);

export interface ParsedLine {
  /** Brand words, noise and units removed. */
  nameWords: string[];
  /** Consonant skeleton of the brand phrase — the key we match on. */
  key: string;
  /** Doses such as 500 in "500 mg". Empty when the line states none. */
  strengths: number[];
  /** Volumes or weights such as 15 in "15 GM". */
  volumes: number[];
  /** Public price printed inside the name, e.g. 184 in "١٨٤ ج". */
  priceHint?: number;
  /** Canonical dosage form, when one is stated. */
  form?: string;
  /** Numbers with no unit attached — pack counts, strip counts, and noise. */
  looseNumbers: number[];
}

/**
 * Split on whitespace and the punctuation both sides use as separators.
 *
 * "+" is spelled out rather than dropped: the catalogue writes
 * "HEPTA PANTHENOL+CARBAMIDE" where the supplier writes "بانثينول بلس كارباميد",
 * and the glossary turns that بلس into the same "plus". Dropping the symbol
 * instead would leave the supplier holding a word the catalogue had thrown away.
 */
function splitWords(text: string): string[] {
  return normaliseDigits(text)
    .replace(/\+/g, ' plus ')
    .replace(/[|,;:()[\]{}*#"'`&]/g, ' ')
    .replace(/[-_/\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Pull a trailing unit off a number written without a space, so "٤٠٠مجم" and
 * "400mg" both split into ["400", "mg"]. Also handles the reverse, "28TAB".
 */
function splitNumberUnit(word: string): string[] {
  const match = /^(\d+(?:\.\d+)?)(.*)$/.exec(word);
  if (match && match[2]) return [match[1], match[2]];

  const trailing = /^(\D+?)(\d+(?:\.\d+)?)$/.exec(word);
  if (trailing) return [trailing[1], trailing[2]];

  return [word];
}

function isNumber(word: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(word);
}

/**
 * Parse one product name into its parts.
 *
 * `fallbackPrice` lets the caller pass the price from a document's own price
 * column; it is used only to recognise a repeated price inside the name, never
 * to invent one.
 */
export function parseLine(text: string, fallbackPrice?: number): ParsedLine {
  const normalised = hasArabic(text) ? normaliseArabic(text) : normaliseDigits(text);
  const words = splitWords(normalised).flatMap(splitNumberUnit);

  const nameWords: string[] = [];
  const strengths: number[] = [];
  const volumes: number[] = [];
  const looseNumbers: number[] = [];
  let priceHint: number | undefined;
  let form: string | undefined;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase();

    if (isNumber(word)) {
      const value = Number(word);
      // The word after a number names its unit; without one we cannot tell a
      // pack count from a price, so it stays loose.
      const unit = (words[i + 1] ?? '').toLowerCase();

      if (STRENGTH_UNITS.has(unit)) {
        strengths.push(value);
        i++;
      } else if (VOLUME_UNITS.has(unit)) {
        volumes.push(value);
        i++;
      } else if (CURRENCY_UNITS.has(unit)) {
        priceHint ??= value;
        i++;
      } else {
        looseNumbers.push(value);
      }
      continue;
    }

    if (SWALLOWING_WORDS.has(lower)) {
      i++; // drop the brand this product is being offered as a substitute for
      continue;
    }

    const canonicalForm = FORM_LOOKUP.get(lower);
    if (canonicalForm) {
      form ??= canonicalForm;
      continue;
    }

    if (NOISE_WORDS.has(lower)) continue;

    // Translate Arabic descriptors so they key the same as the English the
    // catalogue uses; leave everything else to transliteration.
    nameWords.push(DESCRIPTOR_GLOSSARY[word] ?? word);
  }

  // Suppliers often print the price with no currency word, trusting the reader.
  // Only trust a loose number as the price when the document's own price column
  // agrees with it, which keeps us from reading a pack count as money.
  if (priceHint === undefined && fallbackPrice !== undefined) {
    if (looseNumbers.includes(fallbackPrice)) priceHint = fallbackPrice;
  }

  return {
    nameWords,
    key: phoneticPhrase(nameWords),
    strengths,
    volumes,
    priceHint,
    form,
    looseNumbers,
  };
}

/**
 * Normalised key for an alias lookup. Built from the brand skeleton plus the
 * strength, so confirming "ميلجا" does not silently approve "ميلجا ماكس".
 */
export function aliasKey(parsed: ParsedLine): string {
  const strength = parsed.strengths.length ? `@${[...parsed.strengths].sort((a, b) => a - b).join('/')}` : '';
  return `${parsed.key}${strength}`;
}
