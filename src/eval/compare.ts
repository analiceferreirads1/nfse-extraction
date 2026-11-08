import type { PdfTextResult } from "../extraction/pdf-to-text.js";
import type { ExtractedFields } from "../extraction/types.js";

/**
 * Lógica pura da eval: compara campos extraídos com o gabarito, agrega
 * contagens e decide o gate. Sem I/O, para ser testável isoladamente.
 */

export type FieldName = keyof ExtractedFields;
export type FieldStatus = "correct" | "missing" | "wrong";

export const FIELD_NAMES: readonly FieldName[] = [
  "providerCnpj",
  "providerName",
  "invoiceNumber",
  "issueDate",
  "amount",
  "description",
];

/** Extrator avaliado. Aceita versão assíncrona para o futuro extrator por IA. */
export type Extractor = (text: string) => ExtractedFields | Promise<ExtractedFields>;

export interface InvoiceResult {
  id: string;
  statuses: Record<FieldName, FieldStatus>;
  expected: ExtractedFields;
  actual: ExtractedFields | null;
  error: string | null;
}

export interface FieldStats {
  correct: number;
  missing: number;
  wrong: number;
  total: number;
}

export interface WrongEntry {
  id: string;
  field: FieldName;
  expected: ExtractedFields[FieldName];
  actual: ExtractedFields[FieldName];
}

export interface EvalSummary {
  invoiceCount: number;
  fields: Record<FieldName, FieldStats>;
  /** Acertos / (notas × campos). Missing conta como erro. 0 se não houver notas. */
  overallAccuracy: number;
  wrongs: WrongEntry[];
  pdfErrors: { id: string; error: string }[];
}

export type GateFailure = "EMPTY_DATASET" | "WRONG_AMOUNT" | "WRONG_CNPJ" | "LOW_ACCURACY";

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
}

export const ACCURACY_THRESHOLD = 0.98;

/** trim, espaços em sequência viram um, sem diferenciar maiúsculas. Acentos são mantidos. */
export function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function classifyField<F extends FieldName>(
  field: F,
  expected: ExtractedFields[F],
  actual: ExtractedFields[F],
): FieldStatus {
  if (actual === null) return expected === null ? "correct" : "missing";
  if (expected === null) return "wrong";

  switch (field) {
    case "amount":
      return toCents(expected as number) === toCents(actual as number) ? "correct" : "wrong";
    case "providerName":
    case "description":
      return normalizeText(expected as string) === normalizeText(actual as string) ? "correct" : "wrong";
    default:
      return expected === actual ? "correct" : "wrong";
  }
}

export function compareInvoice(
  expected: ExtractedFields,
  actual: ExtractedFields | null,
): Record<FieldName, FieldStatus> {
  const statuses = {} as Record<FieldName, FieldStatus>;
  for (const field of FIELD_NAMES) {
    statuses[field] = actual === null ? "missing" : classifyField(field, expected[field], actual[field]);
  }
  return statuses;
}

/** Avalia uma nota a partir do texto já extraído do PDF. Erro de PDF ⇒ todos os campos missing. */
export async function evaluateInvoice(
  id: string,
  expected: ExtractedFields,
  pdf: PdfTextResult,
  extractor: Extractor,
): Promise<InvoiceResult> {
  if (pdf.error !== null) {
    return { id, expected, actual: null, error: pdf.error, statuses: compareInvoice(expected, null) };
  }
  const actual = await extractor(pdf.text);
  return { id, expected, actual, error: null, statuses: compareInvoice(expected, actual) };
}

export function summarize(results: readonly InvoiceResult[]): EvalSummary {
  const fields = {} as Record<FieldName, FieldStats>;
  for (const field of FIELD_NAMES) fields[field] = { correct: 0, missing: 0, wrong: 0, total: 0 };

  const wrongs: WrongEntry[] = [];
  const pdfErrors: { id: string; error: string }[] = [];
  let correctTotal = 0;

  for (const result of results) {
    if (result.error !== null) pdfErrors.push({ id: result.id, error: result.error });
    for (const field of FIELD_NAMES) {
      const status = result.statuses[field];
      fields[field][status] += 1;
      fields[field].total += 1;
      if (status === "correct") correctTotal += 1;
      if (status === "wrong") {
        wrongs.push({
          id: result.id,
          field,
          expected: result.expected[field],
          actual: result.actual?.[field] ?? null,
        });
      }
    }
  }

  const cells = results.length * FIELD_NAMES.length;
  return {
    invoiceCount: results.length,
    fields,
    overallAccuracy: cells === 0 ? 0 : correctTotal / cells,
    wrongs,
    pdfErrors,
  };
}

export function evaluateGate(summary: EvalSummary): GateResult {
  const failures: GateFailure[] = [];
  if (summary.invoiceCount === 0) failures.push("EMPTY_DATASET");
  if (summary.fields.amount.wrong > 0) failures.push("WRONG_AMOUNT");
  if (summary.fields.providerCnpj.wrong > 0) failures.push("WRONG_CNPJ");
  if (summary.invoiceCount > 0 && summary.overallAccuracy < ACCURACY_THRESHOLD) failures.push("LOW_ACCURACY");
  return { passed: failures.length === 0, failures };
}
