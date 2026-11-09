import type { ExtractedFields } from "../extraction/types.js";

export type InvoiceError = "INVALID_AMOUNT" | "FUTURE_DATE" | "INVALID_DATE";

export interface InvoiceValidationResult {
  valid: boolean;
  errors: InvoiceError[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valor deve ser número finito maior que zero. */
export function validateAmount(amount: number | null | undefined): InvoiceError | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return "INVALID_AMOUNT";
  }
  return null;
}

/** Data de hoje no fuso local, formato AAAA-MM-DD. */
function toLocalIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Data de emissão deve estar em AAAA-MM-DD, existir no calendário e não ser futura.
 * Hoje é aceito. `today` é injetável para testes.
 */
export function validateIssueDate(
  issueDate: string | null | undefined,
  today: Date = new Date(),
): InvoiceError | null {
  if (issueDate == null) return "INVALID_DATE";
  const match = ISO_DATE.exec(issueDate);
  if (!match) return "INVALID_DATE";
  const [, y, m, d] = match;
  if (!isRealDate(Number(y), Number(m), Number(d))) return "INVALID_DATE";
  // Comparação lexicográfica é válida no formato AAAA-MM-DD.
  if (issueDate > toLocalIsoDate(today)) return "FUTURE_DATE";
  return null;
}

export function validateInvoice(
  fields: Pick<ExtractedFields, "amount" | "issueDate">,
  today: Date = new Date(),
): InvoiceValidationResult {
  const errors = [validateAmount(fields.amount), validateIssueDate(fields.issueDate, today)].filter(
    (e): e is InvoiceError => e !== null,
  );
  return { valid: errors.length === 0, errors };
}
