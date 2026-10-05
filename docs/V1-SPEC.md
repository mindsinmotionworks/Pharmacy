# V1 — what we are building

Agreed in conversation, October 2026. Open questions are marked **TBC** and need
an answer from the pharmacy before the affected part is built.

## The job today

The pharmacy's system (PharmaFly) exports a daily list of what needs reordering.
Six wholesalers quote a discount per item: **Huwaidy, Urgent, Abdin, Lotus,
Khalijia, Target**. Quotes arrive as WhatsApp text, photographs, PDFs and
spreadsheets, in Arabic or English, each supplier spelling drugs its own way.

Someone transcribes all of it into one grid, picks a supplier per line, sends
each supplier their share, and later checks the delivery against what was
quoted. About an hour, every day.

The transcription is the hour. Choosing the winner, once the grid exists, is
quick. So the grid is what V1 automates.

## What the sample files showed

Five delivery notes from 2026-10-01, against the same day's purchasing sheet:

**The cheapest quote does not always win.** Diamicron was bought from Abdin at
31% when Lotus offered 32%; Monomak from Abdin at 26% when Khalijia offered 27%.
Abdin supplied 25 of the items across two invoices. The pharmacy appears to give
up roughly a point to keep an order whole — so the optimiser needs a *stickiness*
threshold, not a pure per-line minimum. Left as a setting. **TBC: is Abdin the
default supplier, and what gap justifies splitting a line off?**

**Invoices do not always match the quote.** Three of 49 lines differed:

| Item | Quoted | Invoiced |
| --- | --- | --- |
| Milga Max (Target) | 20% | 16% |
| Allerban (Huwaidy) | 34% | 30% |
| Kepradil XR 750 (Huwaidy) | 28% at 172.50 | 27% at 231 |

Nobody is checking these by hand. Catching them is probably worth more per month
than the hour the grid saves.

**Prices are a second identifier.** Almost every supplier line prints the public
price — `١٨٤ ج` — and so does the catalogue. That independent signal is what
makes the matcher safe.

**Supplier balances are printed on every invoice.** Abdin ~38.7k, Huwaidy ~19k.
Free to track once invoices are being read.

## Scope

### In

1. **Import the catalogue** from a PharmaFly formulary export. *Built.*
2. **Import the daily request** from the same system. *Built.*
3. **Read offers** from photo, PDF, spreadsheet or pasted WhatsApp text, and
   match each line to a catalogue item with a 🟢/🟠/🔴 verdict. *Matching built;
   document reading not started.*
4. **Comparison grid** in the layout the pharmacy already uses — one column per
   supplier — filled in automatically, best offer highlighted.
5. **Supplier split** honouring the stickiness setting, with the saving against
   single-supplier ordering shown.
6. **One order per supplier**, as a WhatsApp message and a spreadsheet.
7. **Invoice check**: photograph the delivery note, and the app flags any
   discount, price or quantity that differs from what was quoted.

### Out, for now

- **Automatic WhatsApp intake.** Possible through the official WhatsApp Business
  API, but it needs Meta business verification against the pharmacy's number.
  Unofficial bridges risk the number being banned, so they are not an option.
  V1 takes a forwarded file or pasted text.
- Price and discount history per item.
- Supplier balances and credit limits.
- Suggested order quantities from stock and sales figures.
- Bonus deals ("10 + 2 free"). The data model carries `bonusQuantity` from the
  start so they can be stored; the comparison maths waits until we know how
  common they are. **TBC: how often do suppliers quote bonuses rather than a
  plain discount?**

## Shape

A web app on one link, usable on a phone (added to the home screen) and on a
desktop. Bilingual Arabic/English. Used by the pharmacist and by staff, so it
needs accounts and a record of who confirmed what.

- Code in this repository.
- Hosting on Cloudflare Pages.
- Database and file storage on Supabase.
- Document reading through the Claude API, which handles both scripts.
- Spreadsheets parsed directly, with no model involved — there is nothing to
  misread.

Hosting fits inside free tiers. Document reading should run from a few dollars to
about $20 a month at 10–20 documents a day; to be measured rather than trusted.

### The iPhone constraint

The pharmacist uses an iPhone. iOS Safari does not support Web Share Target, so
a web app cannot appear in WhatsApp's share sheet the way it can on Android.
Practical routes, in order of preference:

1. Save the image from WhatsApp and upload it in the app — two taps.
2. Copy the message text and paste it in.
3. Forward to a dedicated mailbox the app watches. Costs nothing on the phone.

A native iOS app with a share extension would remove the step. Not worth it for
V1.

## The accuracy rule

No reader, model or OCR, is perfect. The commitment is narrower and testable:
**the app never guesses silently.** Only 🟢 reaches an order untouched, and 🟢
requires either a human-confirmed spelling, a barcode, or agreement on brand,
price and strength at once with no close rival.

Measured on the sample: 67% 🟢 with zero wrong, 27% 🟠, 6% 🔴. Every confirmation
is remembered per supplier, so the 🟠 share falls as the pharmacy uses it.

The honest caveat: that is 49 hand-transcribed lines, and the scoring weights
were fitted to them. It measures the matcher, not the whole pipeline. Real offer
documents are needed to measure the reading step, which is where the remaining
risk sits.

## Next

1. **Real offer documents** — 3–5 as they actually arrive (WhatsApp text, a
   photo, a spreadsheet), ideally from a day whose request sheet we also have.
   Everything supplied so far has been delivery notes, which show what was
   already bought rather than what was on offer. This is the blocker.
2. Confirm the **TBC** items above.
3. Then: document reading, the grid, the split, and the web app.
