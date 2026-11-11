import type { CascadeResult } from "../extraction/cascade-extractor.js";
import type { ExtractedFields } from "../extraction/types.js";
import { validateCnpj } from "./cnpj.js";
import { validateAmount, validateIssueDate } from "./invoice.js";

export type ReviewReason =
  | "MISSING_FIELD"
  | "AI_FAILED"
  | "INVALID_CNPJ"
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "FUTURE_DATE";

export type InvoiceStatus = "approved" | "review";

export type FieldName = keyof ExtractedFields;

export interface InvoiceDecision {
  status: InvoiceStatus;
  /** Campos com problema, sem duplicatas, na ordem de `ExtractedFields`. */
  problemFields: FieldName[];
  /** Códigos dos motivos de revisão, sem duplicatas. */
  reasons: ReviewReason[];
  /** Valores extraídos pela cascata, sem alteração. */
  fields: ExtractedFields;
}

const FIELD_ORDER: readonly FieldName[] = [
  "providerCnpj",
  "providerName",
  "invoiceNumber",
  "issueDate",
  "amount",
  "description",
];

/**
 * Decide se a extração de uma NFS-e pode ser gravada direto ("approved") ou
 * precisa de revisão humana ("review"). "approved" refere-se só à extração;
 * não é aprovação de pagamento.
 *
 * Campo null gera apenas MISSING_FIELD (não soma INVALID_*). `today` é injetável para testes.
 */
export function decideInvoice(result: CascadeResult, today: Date = new Date()): InvoiceDecision {
  const { fields, aiFailure } = result;
  const problems = new Set<FieldName>();
  const reasons = new Set<ReviewReason>();

  const flag = (reason: ReviewReason, field?: FieldName) => {
    reasons.add(reason);
    if (field) problems.add(field);
  };

  for (const field of FIELD_ORDER) {
    if (fields[field] === null) flag("MISSING_FIELD", field);
  }

  if (aiFailure !== null) flag("AI_FAILED");

  if (fields.providerCnpj !== null && !validateCnpj(fields.providerCnpj).valid) {
    flag("INVALID_CNPJ", "providerCnpj");
  }

  if (fields.amount !== null) {
    const error = validateAmount(fields.amount);
    if (error) flag(error, "amount");
  }

  if (fields.issueDate !== null) {
    const error = validateIssueDate(fields.issueDate, today);
    if (error) flag(error, "issueDate");
  }

  return {
    status: reasons.size === 0 ? "approved" : "review",
    problemFields: FIELD_ORDER.filter((field) => problems.has(field)),
    reasons: [...reasons],
    fields,
  };
}
