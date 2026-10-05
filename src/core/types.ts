/**
 * Shared vocabulary for the order optimiser.
 *
 * A note on money: every price here is the public selling price printed on the
 * box, in EGP. Discounts are expressed as percentages off that price, because
 * that is how Egyptian wholesalers quote and how the pharmacy's own sheets are
 * written. Net cost per unit is therefore `price * (1 - discount / 100)`.
 */

/** One item as it exists in the pharmacy's own system (the formulary export). */
export interface CatalogItem {
  /** The pharmacy software's internal code. Stable, so it is our primary key. */
  code: string;
  /** Name as the pharmacy writes it — in practice English, occasionally Arabic. */
  name: string;
  /** Public selling price in EGP. */
  price: number;
  /** International barcode(s), when the pharmacy has recorded them. */
  barcodes?: string[];
  category?: string;
  subCategory?: string;
}

/** A single line lifted off a supplier's offer, invoice, or WhatsApp message. */
export interface SupplierLine {
  /** Verbatim text of the line, before any cleaning. Kept for the audit trail. */
  raw: string;
  /** Supplier the line came from, e.g. "ABDIN". */
  supplier: string;
  /** Public price the supplier printed, when the document shows one. */
  price?: number;
  /** Discount percentage off the public price. */
  discount?: number;
  /** Units offered or delivered. */
  quantity?: number;
  /** Free units in a bonus deal, e.g. 2 in a "10 + 2 free" offer. */
  bonusQuantity?: number;
  /** Batch expiry, where the document carries one. */
  expiry?: string;
  barcode?: string;
}

/**
 * How far we trust a match.
 *
 * The rule the pharmacy asked for: nothing but `certain` may flow into an order
 * without a human looking at it. `likely` and `unknown` both stop and ask.
 */
export type Confidence = 'certain' | 'likely' | 'unknown';

/** Why a match landed where it did — shown to the user, so keep it legible. */
export interface MatchReason {
  code:
    | 'learned-alias'
    | 'barcode'
    | 'phonetic-exact'
    | 'phonetic-close'
    | 'price-agrees'
    | 'price-differs'
    | 'price-missing'
    | 'strength-agrees'
    | 'strength-differs'
    | 'form-differs'
    | 'rival-candidate'
    | 'no-candidate';
  /** Human-readable detail, e.g. "catalogue 180 vs offer 184". */
  detail?: string;
}

export interface Candidate {
  item: CatalogItem;
  /** 0..1. Only meaningful for ranking within one line's candidates. */
  score: number;
  /** Brand-name agreement alone, before price and strength are weighed in. */
  brandSimilarity: number;
  reasons: MatchReason[];
}

export interface MatchResult {
  line: SupplierLine;
  confidence: Confidence;
  /** Best candidate, or null when nothing plausible was found. */
  best: Candidate | null;
  /** Runners-up, so the user can pick without searching the whole catalogue. */
  alternatives: Candidate[];
  reasons: MatchReason[];
}

/**
 * A confirmed spelling. Once a human says "this supplier's wording means this
 * item", we never ask again — that is what makes the first week's effort pay off.
 */
export interface Alias {
  supplier: string;
  /** Normalised key of the supplier's wording, not the raw text. */
  key: string;
  code: string;
  confirmedAt: string;
}
