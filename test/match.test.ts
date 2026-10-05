import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CatalogIndex, matchLine } from '../src/core/match.ts';
import { parseLine, aliasKey } from '../src/core/tokens.ts';
import type { Alias, CatalogItem, SupplierLine } from '../src/core/types.ts';

interface Fixture extends SupplierLine {
  expectedCode: string;
  expectedName: string;
  /** False where the line is genuinely ambiguous and must stop for a human. */
  expectCertain?: boolean;
  note?: string;
}

const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const catalog = read<CatalogItem[]>('catalog.json');
const { lines } = read<{ lines: Fixture[] }>('invoice-lines.json');
const index = new CatalogIndex(catalog);

describe('matching real invoice lines', () => {
  it.each(lines.map((line) => [line.expectedName, line] as const))(
    'finds %s',
    (_name, line) => {
      const result = matchLine(line, index);
      expect(result.best?.item.code).toBe(line.expectedCode);
    },
  );

  /**
   * The one guarantee the pharmacy is relying on. A `likely` or `unknown` that
   * turns out wrong costs a few seconds of a pharmacist's attention; a `certain`
   * that is wrong goes onto an order unchecked and arrives as the wrong drug.
   */
  it('is never confidently wrong', () => {
    const confidentlyWrong = lines
      .map((line) => ({ line, result: matchLine(line, index) }))
      .filter(({ line, result }) => result.confidence === 'certain' && result.best?.item.code !== line.expectedCode);

    expect(confidentlyWrong.map(({ line }) => line.raw)).toEqual([]);
  });

  it('stops to ask on the lines a pharmacist would question', () => {
    const shouldAsk = lines.filter((line) => line.expectCertain === false);
    // Keep the fixture honest: this assertion is worthless if nothing is marked.
    expect(shouldAsk.length).toBeGreaterThan(5);

    for (const line of shouldAsk) {
      const result = matchLine(line, index);
      expect(result.confidence, `${line.raw} (${line.note ?? ''})`).not.toBe('certain');
    }
  });

  it('matches at least two thirds of lines outright', () => {
    const certain = lines.filter((line) => matchLine(line, index).confidence === 'certain');
    expect(certain.length / lines.length).toBeGreaterThanOrEqual(0.65);
  });
});

describe('refusing to guess', () => {
  /**
   * Brands that do not exist, written the way a supplier would write a real one.
   * A matcher that leans too hard on price will happily attach one of these to
   * whatever item happens to cost the same.
   */
  const inventions: SupplierLine[] = [
    { supplier: 'ABDIN', raw: 'زيبلوركس ٥٠ مجم اقراص', price: 136 },
    { supplier: 'LOTUS', raw: 'فارماتريكس ٢٠٠ مجم كبسول', price: 174 },
    { supplier: 'TARGET', raw: 'كوينتافيل شراب ١٠٠ مل', price: 54 },
    { supplier: 'HUWAIDY', raw: 'برولاستين فوار', price: 38 },
  ];

  it.each(inventions.map((line) => [line.raw, line] as const))(
    'never claims certainty about %s',
    (_raw, line) => {
      expect(matchLine(line, index).confidence).not.toBe('certain');
    },
  );

  it('returns nothing rather than something for a line with no brand at all', () => {
    const result = matchLine({ supplier: 'ABDIN', raw: '٢٥٠ ج', price: 250 }, index);
    expect(result.confidence).toBe('unknown');
  });
});

describe('learning a spelling', () => {
  const line: SupplierLine = { supplier: 'ABDIN', raw: 'زانسيستوب ٨٠مجم ١٤٧ج', price: 147 };

  it('is unsure before anyone confirms it', () => {
    // XANTHISTOP loses its "th" in transliteration, so the skeletons disagree.
    expect(matchLine(line, index).confidence).not.toBe('certain');
  });

  it('is certain once a pharmacist has confirmed it', () => {
    const alias: Alias = {
      supplier: line.supplier,
      key: aliasKey(parseLine(line.raw, line.price)),
      code: '31169',
      confirmedAt: '2026-10-01',
    };
    const aliases = new Map([[`${alias.supplier}\u0000${alias.key}`, alias]]);

    const result = matchLine(line, index, { aliases });
    expect(result.confidence).toBe('certain');
    expect(result.best?.item.code).toBe('31169');
  });

  it('does not let one supplier confirm a spelling on another supplier behalf', () => {
    const alias: Alias = {
      supplier: 'LOTUS',
      key: aliasKey(parseLine(line.raw, line.price)),
      code: '31169',
      confirmedAt: '2026-10-01',
    };
    const aliases = new Map([[`${alias.supplier}\u0000${alias.key}`, alias]]);

    // Same wording, different supplier: suppliers abbreviate differently, so a
    // confirmation is only worth what it was confirmed against.
    expect(matchLine(line, index, { aliases }).confidence).not.toBe('certain');
  });

  it('does not treat a confirmation of one strength as covering another', () => {
    const confirmed = parseLine('ميلجا ٤ شريط عادى', 108);
    const different = parseLine('ميلجا ماكس ٣٠ قرص', 295);
    expect(aliasKey(confirmed)).not.toBe(aliasKey(different));
  });
});
