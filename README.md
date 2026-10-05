# Pharmacy order optimiser

Every morning the pharmacy's system produces a list of what needs reordering.
Six wholesalers then quote a discount on each item, by WhatsApp message, photo,
PDF or spreadsheet, in Arabic or English, with no two of them spelling a drug the
same way. Someone has to collect those quotes into one grid, pick a supplier per
line, and send each supplier their share of the order. It takes about an hour a
day, and it is the same hour every day.

This repository automates the grid.

## Where it stands

The matching engine works and is measured. Nothing else is built yet.

| Part | State |
| --- | --- |
| Arabic ↔ English drug matching | Working, measured against real invoices |
| Formulary / request spreadsheet import | Working |
| Reading offers from photos, PDFs and WhatsApp text | Not started |
| Comparison grid and supplier split | Not started |
| Web app (phone and desktop) | Not started |
| Invoice checking against what was quoted | Not started |

## The matching problem

A wholesaler sends `موفلوكس ٤٠٠مجم ١٨٤ج`. The pharmacy's catalogue calls it
`MOFLOX 400 10TAB/2`. It also stocks `MOXIFLOX 400 TAB/2`, four pounds apart.
Picking the wrong one puts the wrong antibiotic on an order.

Arabic spellings of brand names are transliterations, so rather than translating
we reduce both sides to a consonant skeleton and compare those — `ترتيكو` and
`TRITTICO` both become `TRTK`. Three independent signals then decide the match:
the brand, the public price both sides print, and the strength. One alone is
never enough. The details, and the cases they fail on, are in
[`src/core/phonetic.ts`](src/core/phonetic.ts) and
[`src/core/match.ts`](src/core/match.ts).

Every line comes back as one of three verdicts:

| | Meaning | What happens |
| --- | --- | --- |
| 🟢 certain | Confirmed spelling, or barcode, or brand *and* price *and* strength all agree with no close rival | Flows into the order |
| 🟠 likely | Best guess, but something is off — price moved, a word is missing, two items fit | Pharmacist confirms |
| 🔴 unknown | No candidate, or two that cannot be told apart | Handled by hand |

Confirming a 🟠 or 🔴 teaches the system that supplier's spelling, and it reads
🟢 from then on. So the first week is slow and after that it is not.

## Measured accuracy

Against the pharmacy's real catalogue of 25,937 items and 49 lines transcribed
from five delivery notes dated 2026-10-01:

```
correct first     49  (100.0%)
green / certain   33  (67.3%) — 0 wrong
orange / likely   13  (26.5%)
red / unknown      3  (6.1%)
```

The number that matters is the `0 wrong`. A wrong 🟠 costs a few seconds of
attention; a wrong 🟢 arrives as the wrong drug, because nobody checked it.

Read these figures with their limits in mind. Forty-nine lines is a small
sample, the weights in `match.ts` were fitted to it, and the lines were
transcribed by hand rather than read off a photo — so this measures the matcher,
not yet the whole pipeline. Treat 100% as "no known failures", not as a promise.

## Running it

```sh
npm install
npm test            # unit tests, against a committed fixture
npm run typecheck
```

To measure against the full catalogue you need a real export, which is not in
this repository:

```sh
node --experimental-strip-types scripts/evaluate-matching.mjs path/to/formulary.xlsx
```

## What is in the repository, and what is not

`data/private/` is ignored by git. Real exports carry stock levels, supplier
discounts, cost prices and account balances, and none of that belongs here.

`test/fixtures/` holds two files so the tests can run without them:

- `invoice-lines.json` — 49 supplier lines transcribed from real delivery notes,
  with the item each one refers to. Line items only; no balances, addresses,
  phone numbers or pharmacy identifiers.
- `catalog.json` — 1,848 catalogue entries, each a product name and its public
  selling price. These are the items the matcher had to choose between, kept so
  the hard cases are reproducible. Public prices are printed on the box.

If even that is more than the pharmacy wants committed, the fixture can be
replaced with obfuscated names; say so and it will be.
