import { describe, expect, it } from "vitest";
import type { CascadeResult } from "../../src/extraction/cascade-extractor.js";
import type { ExtractedFields } from "../../src/extraction/types.js";
import { decideInvoice } from "../../src/validators/invoice-decision.js";

const TODAY = new Date(2026, 10, 9); // 2026-11-09, fuso local

/** NFS-e fictícia com todos os campos válidos. */
const VALID: ExtractedFields = {
  providerCnpj: "12345678000195",
  providerName: "Alfa Consultoria Ficticia Ltda",
  invoiceNumber: "1024",
  issueDate: "2026-10-15",
  amount: 8500,
  description: "Consultoria em processos financeiros",
};

function cascade(
  overrides: Partial<ExtractedFields> = {},
  aiFailure: CascadeResult["aiFailure"] = null,
): CascadeResult {
  return { fields: { ...VALID, ...overrides }, aiFailure };
}

describe("decideInvoice", () => {
  it("aprova nota com todos os campos válidos e sem falha da IA", () => {
    expect(decideInvoice(cascade(), TODAY)).toEqual({
      status: "approved",
      problemFields: [],
      reasons: [],
      fields: VALID,
    });
  });

  it("manda para revisão com MISSING_FIELD quando há campo null", () => {
    const result = cascade({ description: null });

    expect(decideInvoice(result, TODAY)).toEqual({
      status: "review",
      problemFields: ["description"],
      reasons: ["MISSING_FIELD"],
      fields: result.fields,
    });
  });

  it("manda para revisão com AI_FAILED quando a IA falhou", () => {
    expect(decideInvoice(cascade({}, "SERVER_ERROR"), TODAY)).toEqual({
      status: "review",
      problemFields: [],
      reasons: ["AI_FAILED"],
      fields: VALID,
    });
  });

  it("manda para revisão com INVALID_CNPJ quando o CNPJ não confere", () => {
    const result = cascade({ providerCnpj: "12345678000196" });

    expect(decideInvoice(result, TODAY)).toMatchObject({
      status: "review",
      problemFields: ["providerCnpj"],
      reasons: ["INVALID_CNPJ"],
    });
  });

  it("manda para revisão com INVALID_AMOUNT quando o valor não é positivo", () => {
    expect(decideInvoice(cascade({ amount: 0 }), TODAY)).toMatchObject({
      status: "review",
      problemFields: ["amount"],
      reasons: ["INVALID_AMOUNT"],
    });
  });

  it("manda para revisão com INVALID_DATE quando a data não existe", () => {
    expect(decideInvoice(cascade({ issueDate: "2026-02-30" }), TODAY)).toMatchObject({
      status: "review",
      problemFields: ["issueDate"],
      reasons: ["INVALID_DATE"],
    });
  });

  it("manda para revisão com FUTURE_DATE quando a data é futura", () => {
    expect(decideInvoice(cascade({ issueDate: "2026-12-01" }), TODAY)).toMatchObject({
      status: "review",
      problemFields: ["issueDate"],
      reasons: ["FUTURE_DATE"],
    });
  });

  it("campo null gera só MISSING_FIELD, sem INVALID_* do mesmo campo", () => {
    const result = cascade({ providerCnpj: null, amount: null, issueDate: null });

    expect(decideInvoice(result, TODAY)).toMatchObject({
      status: "review",
      problemFields: ["providerCnpj", "issueDate", "amount"],
      reasons: ["MISSING_FIELD"],
    });
  });

  it("acumula vários motivos sem duplicar", () => {
    const result = cascade(
      { providerName: null, invoiceNumber: null, providerCnpj: "12345678000196", amount: -1 },
      "RATE_LIMITED",
    );

    expect(decideInvoice(result, TODAY)).toMatchObject({
      status: "review",
      problemFields: ["providerCnpj", "providerName", "invoiceNumber", "amount"],
      reasons: ["MISSING_FIELD", "AI_FAILED", "INVALID_CNPJ", "INVALID_AMOUNT"],
    });
  });
});
