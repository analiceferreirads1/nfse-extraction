import { describe, expect, it } from "vitest";
import {
  validateAmount,
  validateInvoice,
  validateIssueDate,
} from "../../src/validators/invoice.js";

const TODAY = new Date(2026, 10, 9); // 2026-11-09, fuso local

describe("validateAmount", () => {
  it("aceita valor positivo", () => {
    expect(validateAmount(8500)).toBeNull();
    expect(validateAmount(0.01)).toBeNull();
  });

  it("rejeita zero e negativo", () => {
    expect(validateAmount(0)).toBe("INVALID_AMOUNT");
    expect(validateAmount(-1)).toBe("INVALID_AMOUNT");
  });

  it("rejeita NaN e Infinity", () => {
    expect(validateAmount(Number.NaN)).toBe("INVALID_AMOUNT");
    expect(validateAmount(Number.POSITIVE_INFINITY)).toBe("INVALID_AMOUNT");
  });

  it("rejeita null e undefined", () => {
    expect(validateAmount(null)).toBe("INVALID_AMOUNT");
    expect(validateAmount(undefined)).toBe("INVALID_AMOUNT");
  });
});

describe("validateIssueDate", () => {
  it("aceita data passada", () => {
    expect(validateIssueDate("2026-10-15", TODAY)).toBeNull();
  });

  it("aceita a data de hoje", () => {
    expect(validateIssueDate("2026-11-09", TODAY)).toBeNull();
  });

  it("rejeita data futura", () => {
    expect(validateIssueDate("2026-11-10", TODAY)).toBe("FUTURE_DATE");
    expect(validateIssueDate("2027-01-01", TODAY)).toBe("FUTURE_DATE");
  });

  it("rejeita data ausente", () => {
    expect(validateIssueDate(null, TODAY)).toBe("INVALID_DATE");
    expect(validateIssueDate(undefined, TODAY)).toBe("INVALID_DATE");
    expect(validateIssueDate("", TODAY)).toBe("INVALID_DATE");
  });

  it("rejeita formato diferente de AAAA-MM-DD", () => {
    expect(validateIssueDate("15/10/2026", TODAY)).toBe("INVALID_DATE");
    expect(validateIssueDate("2026-10-15T00:00:00", TODAY)).toBe("INVALID_DATE");
  });

  it("rejeita data inexistente no calendário", () => {
    expect(validateIssueDate("2026-02-30", TODAY)).toBe("INVALID_DATE");
    expect(validateIssueDate("2026-13-01", TODAY)).toBe("INVALID_DATE");
  });
});

describe("validateInvoice", () => {
  it("aceita a NFS-e fictícia nfse-001", () => {
    expect(validateInvoice({ amount: 8500.0, issueDate: "2026-10-15" }, TODAY)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("acumula valor inválido e data futura", () => {
    expect(validateInvoice({ amount: 0, issueDate: "2026-12-01" }, TODAY)).toEqual({
      valid: false,
      errors: ["INVALID_AMOUNT", "FUTURE_DATE"],
    });
  });
});
