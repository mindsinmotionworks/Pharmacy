/**
 * Measures the matcher against the real catalogue and the transcribed invoices.
 *
 *   node --experimental-strip-types scripts/evaluate-matching.mjs <formulary.xlsx>
 *
 * Reports two numbers that mean different things:
 *
 *   accuracy   how often the right item is ranked first. This is the ceiling on
 *              how much work the pharmacist avoids.
 *   safety     how often a `certain` verdict was actually right. This one must
 *              be 100%: a confident wrong answer is the only failure that costs
 *              real money, because nobody checks it.
 *
 * Passing `--fixture` also writes the privacy-safe catalogue slice the unit
 * tests run against.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { importFormulary } from '../src/importers/formulary.ts';
import { CatalogIndex, matchLine } from '../src/core/match.ts';
import { parseLine } from '../src/core/tokens.ts';

const [formularyPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const writeFixture = process.argv.includes('--fixture');

if (!formularyPath) {
  console.error('usage: evaluate-matching.mjs <formulary.xlsx> [--fixture]');
  process.exit(1);
}

const { lines } = JSON.parse(await readFile(new URL('../test/fixtures/invoice-lines.json', import.meta.url), 'utf8'));
const { items, skipped } = await importFormulary(formularyPath);

console.log(`catalogue: ${items.length} items (${skipped.length} rows skipped)`);

const index = new CatalogIndex(items);
const results = lines.map((line) => ({ line, result: matchLine(line, index, { keepAlternatives: 80 }) }));

let rankedFirst = 0;
let certainCorrect = 0;
let certainWrong = 0;
const tiers = { certain: 0, likely: 0, unknown: 0 };
const failures = [];

for (const { line, result } of results) {
  const correct = result.best?.item.code === line.expectedCode;
  tiers[result.confidence]++;

  if (correct) rankedFirst++;
  else failures.push({ line, result });

  if (result.confidence === 'certain') {
    if (correct) certainCorrect++;
    else certainWrong++;
  }
}

const pct = (n) => `${((n / lines.length) * 100).toFixed(1)}%`;

console.log(`
lines tested      ${lines.length}
correct first     ${rankedFirst}  (${pct(rankedFirst)})
green / certain   ${tiers.certain}  (${pct(tiers.certain)}) — ${certainWrong} wrong
orange / likely   ${tiers.likely}  (${pct(tiers.likely)})
red / unknown     ${tiers.unknown}  (${pct(tiers.unknown)})`);

if (failures.length) {
  console.log('\nwrong or missing:');
  for (const { line, result } of failures) {
    const got = result.best ? `${result.best.item.name} @ ${result.best.item.price}` : '(nothing)';
    console.log(`  ${line.raw}`);
    console.log(`    want ${line.expectedName}`);
    console.log(`    got  ${got}  [${result.confidence}]`);
  }
}

if (certainWrong > 0) {
  console.error(`\nFAIL: ${certainWrong} line(s) were confidently wrong.`);
  process.exitCode = 1;
}

if (writeFixture) {
  // A hard-negatives fixture: for each line, the items the matcher actually had
  // to rule out, plus everything sharing a price with it. Selecting by "same
  // first sound" instead would pull in most of the catalogue, which would mean
  // committing the pharmacy's entire product list to git to test 49 lines.
  const keep = new Map();

  for (const { line, result } of results) {
    const expected = items.find((i) => i.code === line.expectedCode);
    if (expected) keep.set(expected.code, expected);
    for (const candidate of [result.best, ...result.alternatives].filter(Boolean)) {
      keep.set(candidate.item.code, candidate.item);
    }
  }

  const slice = [...keep.values()];

  const missing = lines.map((l) => l.expectedCode).filter((code) => !keep.has(code));
  if (missing.length) throw new Error(`fixture would omit expected items: ${missing.join(', ')}`);

  const path = new URL('../test/fixtures/catalog.json', import.meta.url);
  await writeFile(
    path,
    `${JSON.stringify(
      slice.map(({ code, name, price }) => ({ code, name, price })),
      null,
      0,
    )}\n`,
  );
  console.log(`\nfixture: ${slice.length} items written to test/fixtures/catalog.json`);
}
