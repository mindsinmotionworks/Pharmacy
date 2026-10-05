/**
 * Reading the pharmacy's own exports.
 *
 * PharmaFly writes its spreadsheets with Arabic headers, and which columns
 * appear depends on which report was run. So rather than trusting positions, we
 * find each column by its header text and accept the several spellings the
 * system uses.
 *
 * Nothing here guesses. A sheet missing the columns we need raises, because a
 * silently half-read catalogue would poison every match downstream.
 */

import ExcelJS from 'exceljs';
import type { CatalogItem } from '../core/types.ts';

/** Header spellings that identify each column we care about. */
const HEADERS = {
  code: ['كود', 'الكود', 'code'],
  name: ['اسم الصنف', 'الاسم', 'اسم', 'name', 'item'],
  price: ['سعر البيع', 'السعر', 'price'],
  barcode: ['الباركود الدولى', 'الباركود', 'باركود', 'barcode'],
  category: ['التصنيف الاساسي', 'category'],
  subCategory: ['التصنيف الفرعي', 'subcategory'],
} as const;

type ColumnName = keyof typeof HEADERS;

function normaliseHeader(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Locate each known column in the header row. Returns 1-based column numbers. */
function mapColumns(headerRow: ExcelJS.Row): Partial<Record<ColumnName, number>> {
  const found: Partial<Record<ColumnName, number>> = {};

  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const header = normaliseHeader(cell.value);
    for (const [name, spellings] of Object.entries(HEADERS) as [ColumnName, readonly string[]][]) {
      // First match wins: PharmaFly repeats some headers in trailing blank columns.
      if (found[name] === undefined && spellings.some((s) => s === header)) {
        found[name] = columnNumber;
      }
    }
  });

  return found;
}

function cellText(row: ExcelJS.Row, column: number | undefined): string {
  if (column === undefined) return '';
  const value = row.getCell(column).value;
  if (value === null || value === undefined) return '';
  // Formula cells arrive as { formula, result }; we want what the user sees.
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '').trim();
  return String(value).trim();
}

function cellNumber(row: ExcelJS.Row, column: number | undefined): number | undefined {
  const text = cellText(row, column);
  if (!text) return undefined;
  // Arabic exports sometimes carry a thousands separator or a trailing mark.
  const parsed = Number(text.replace(/[,\s‏‎]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ImportResult {
  items: CatalogItem[];
  /** Rows we could not read, with the reason — surfaced to the user, never hidden. */
  skipped: { row: number; reason: string }[];
}

/**
 * Read a formulary export into catalogue items.
 *
 * Items priced at zero are kept: the pharmacy uses zero as a placeholder for
 * products it has not priced yet, and dropping them would make those lines
 * unmatchable rather than merely uncertain.
 */
export async function importFormulary(filePath: string): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`${filePath}: the workbook has no sheets`);

  const columns = mapColumns(sheet.getRow(1));
  const missing = (['code', 'name', 'price'] as const).filter((c) => columns[c] === undefined);
  if (missing.length) {
    throw new Error(
      `${filePath}: could not find the ${missing.join(', ')} column(s). ` +
        `Expected a header row naming them, e.g. ${missing.map((m) => HEADERS[m][0]).join(', ')}.`,
    );
  }

  const items: CatalogItem[] = [];
  const skipped: ImportResult['skipped'] = [];
  const seen = new Set<string>();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const code = cellText(row, columns.code);
    const name = cellText(row, columns.name);
    const price = cellNumber(row, columns.price);

    if (!code || !name) {
      // Blank spacer rows are normal in these exports; only report real losses.
      if (code || name || price !== undefined) {
        skipped.push({ row: rowNumber, reason: 'missing code or name' });
      }
      return;
    }

    if (price === undefined) {
      skipped.push({ row: rowNumber, reason: `unreadable price for ${name}` });
      return;
    }

    if (seen.has(code)) {
      skipped.push({ row: rowNumber, reason: `duplicate code ${code} (${name})` });
      return;
    }
    seen.add(code);

    const barcodes = cellText(row, columns.barcode)
      .split(',')
      .map((b) => b.replace(/[‏‎\s]/g, ''))
      .filter(Boolean);

    items.push({
      code,
      name,
      price,
      ...(barcodes.length ? { barcodes } : {}),
      ...(columns.category ? { category: cellText(row, columns.category) } : {}),
      ...(columns.subCategory ? { subCategory: cellText(row, columns.subCategory) } : {}),
    });
  });

  return { items, skipped };
}
