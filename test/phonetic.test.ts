import { describe, expect, it } from 'vitest';
import { normaliseDigits, phoneticKey, phraseSimilarity } from '../src/core/phonetic.ts';

describe('normaliseDigits', () => {
  it('converts Arabic-Indic digits so prices compare equal', () => {
    expect(normaliseDigits('١٨٤')).toBe('184');
    expect(normaliseDigits('٢٫٥')).toBe('2.5');
  });

  it('leaves Latin digits and letters alone', () => {
    expect(normaliseDigits('NEXIUM 40')).toBe('NEXIUM 40');
  });
});

describe('phoneticKey', () => {
  // Each pair is a real supplier spelling against the catalogue's own wording.
  const sameBrand: [string, string][] = [
    ['ترتيكو', 'TRITTICO'],
    ['نيزابكس', 'NIZAPEX'],
    ['ميمكسا', 'MEMEXA'],
    ['سترينجازول', 'STRINGAZOLE'],
    ['كالسيترون', 'CALCITRON'],
    ['بمبيزان', 'PUMPIZAN'],
    ['تكنوسبيرون', 'TECHNOSPIRON'],
    ['فيكسوليتك', 'VICKSOLYTIC'],
    ['يوروسولفين', 'UROSOLVINE'],
    ['اوبونوف', 'OPONOV'],
    ['نازونيكس', 'NASONEX'],
    ['دابابليكس', 'DAPABLIX'],
    ['ستيديفيوتال', 'STEADYFUTAL'],
    ['توسيستوب', 'TUSSISTOP'],
  ];

  it.each(sameBrand)('reads %s and %s as the same brand', (arabic, latin) => {
    expect(phoneticKey(arabic)).toBe(phoneticKey(latin));
  });

  it('keeps MOFLOX and MOXIFLOX apart', () => {
    // The pharmacy stocks both, four pounds apart. Collapsing them would put the
    // wrong antibiotic on an order.
    expect(phoneticKey('MOFLOX')).not.toBe(phoneticKey('MOXIFLOX'));
    expect(phoneticKey('موفلوكس')).toBe(phoneticKey('MOFLOX'));
  });

  it('keeps brands apart that differ only in a middle consonant', () => {
    expect(phoneticKey('CALDIN')).not.toBe(phoneticKey('CALCIUM'));
    expect(phoneticKey('MILGA')).not.toBe(phoneticKey('MALOX'));
  });

  it('resolves a soft C to S and a hard C to K', () => {
    expect(phoneticKey('CALCITRON')).toBe('KLSTRN');
    expect(phoneticKey('OSTEOCARE')).toBe('STKR');
  });
});

describe('phraseSimilarity', () => {
  it('scores an exact skeleton at 1', () => {
    expect(phraseSimilarity('TRTK', 'TRTK')).toBe(1);
  });

  it('rewards containment but never as highly as an exact match', () => {
    // WELLMAN ORIGINAL inside WELLMAN ORIGINAL MEN.
    const score = phraseSimilarity('LMNRGNL', 'LMNRGNLMN');
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(0.999);
  });

  it('discounts containment when most of the name is unexplained', () => {
    // BETADINE inside BETADINE SKIN CLEANSER: the leftover words are the point.
    const vague = phraseSimilarity('BTDN', 'BTDNSKNKLNSR');
    const tight = phraseSimilarity('LMNRGNL', 'LMNRGNLMN');
    expect(vague).toBeLessThan(tight);
  });

  it('ignores containment for skeletons too short to mean anything', () => {
    expect(phraseSimilarity('HR', 'HRBB')).toBeLessThan(0.85);
  });
});
