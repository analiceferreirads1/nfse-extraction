import { describe, expect, it, vi } from "vitest";
import {
  classifyField,
  compareInvoice,
  evaluateGate,
  evaluateInvoice,
  type FieldName,
  type FieldStatus,
  type InvoiceResult,
  normalizeText,
  summarize,
} from "../../src/eval/compare.js";
import type { ExtractedFields } from "../../src/extraction/types.js";

const EXPECTED: ExtractedFields = {
  providerCnpj: "12345678000195",
  providerName: "Alfa Consultoria Ficticia Ltda",
  invoiceNumber: "1024",
  issueDate: "2026-10-15",
  amount: 8500,
  description: "Consultoria em processos financeiros - outubro/2026",
};

const ALL_CORRECT: Record<FieldName, FieldStatus> = {
  providerCnpj: "correct",
  providerName: "correct",
  invoiceNumber: "correct",
  issueDate: "correct",
  amount: "correct",
  description: "correct",
};

function result(id: string, overrides: Partial<Record<FieldName, FieldStatus>> = {}): InvoiceResult {
  return { id, expected: EXPECTED, actual: EXPECTED, error: null, statuses: { ...ALL_CORRECT, ...overrides } };
}

describe("normalizeText", () => {
  it("remove espaços nas pontas, colapsa espaços/quebras e ignora maiúsculas", () => {
    expect(normalizeText("  Alfa   CONSULTORIA\n\tLtda ")).toBe("alfa consultoria ltda");
  });

  it("mantém acentos", () => {
    expect(normalizeText("Serviços")).not.toBe(normalizeText("Servicos"));
  });
});

describe("classifyField", () => {
  it.each([
    ["providerCnpj", "12345678000195", "12345678000195", "correct"],
    ["providerCnpj", "12345678000195", "12345678000196", "wrong"],
    ["providerCnpj", "12345678000195", null, "missing"],
    ["invoiceNumber", "1024", "1024", "correct"],
    ["invoiceNumber", "1024", "01024", "wrong"],
    ["issueDate", "2026-10-15", "2026-10-15", "correct"],
    ["issueDate", "2026-10-15", "2026-10-16", "wrong"],
    ["issueDate", "2026-10-15", null, "missing"],
  ] as const)("%s: esperado %j, obtido %j → %s", (field, expected, actual, status) => {
    expect(classifyField(field, expected, actual)).toBe(status);
  });

  it("igualdade exata não normaliza espaços nem caixa", () => {
    expect(classifyField("invoiceNumber", "1024", " 1024")).toBe("wrong");
    expect(classifyField("providerCnpj", "ab", "AB")).toBe("wrong");
  });

  describe("amount em centavos", () => {
    it("0.1 + 0.2 é igual a 0.3", () => {
      expect(0.1 + 0.2).not.toBe(0.3);
      expect(classifyField("amount", 0.3, 0.1 + 0.2)).toBe("correct");
    });

    it("um centavo de diferença é wrong", () => {
      expect(classifyField("amount", 8500, 8500.01)).toBe("wrong");
    });

    it("null é missing", () => {
      expect(classifyField("amount", 8500, null)).toBe("missing");
    });
  });

  describe("providerName e description normalizados", () => {
    it.each(["providerName", "description"] as const)("%s: espaços e caixa não importam", (field) => {
      expect(classifyField(field, "Alfa Consultoria Ltda", "  ALFA  consultoria\nltda ")).toBe("correct");
    });

    it.each(["providerName", "description"] as const)("%s: acento diferente é wrong", (field) => {
      expect(classifyField(field, "Serviços Fictícios", "Servicos Ficticios")).toBe("wrong");
    });

    it("texto diferente é wrong e null é missing", () => {
      expect(classifyField("description", "Consultoria", "Suporte")).toBe("wrong");
      expect(classifyField("providerName", "Alfa", null)).toBe("missing");
    });
  });

  it("esperado null: obtido null é correct, obtido com valor é wrong", () => {
    expect(classifyField("description", null, null)).toBe("correct");
    expect(classifyField("description", null, "algo")).toBe("wrong");
  });
});

describe("compareInvoice", () => {
  it("classifica cada campo", () => {
    const actual: ExtractedFields = { ...EXPECTED, amount: null, providerName: "Outra Ltda" };
    expect(compareInvoice(EXPECTED, actual)).toEqual({
      ...ALL_CORRECT,
      amount: "missing",
      providerName: "wrong",
    });
  });

  it("sem extração, todos os campos são missing", () => {
    expect(Object.values(compareInvoice(EXPECTED, null))).toEqual(Array(6).fill("missing"));
  });
});

describe("evaluateInvoice", () => {
  it("erro na leitura do PDF: todos missing e o extrator não é chamado", async () => {
    const extractor = vi.fn(() => EXPECTED);
    const res = await evaluateInvoice("n1", EXPECTED, { text: "", error: "INVALID_PDF" }, extractor);
    expect(extractor).not.toHaveBeenCalled();
    expect(res.error).toBe("INVALID_PDF");
    expect(Object.values(res.statuses)).toEqual(Array(6).fill("missing"));
  });

  it("aplica o extrator recebido (síncrono ou assíncrono) ao texto do PDF", async () => {
    const sync = vi.fn(() => EXPECTED);
    const asyncExtractor = vi.fn(async () => ({ ...EXPECTED, amount: 1 }));

    const a = await evaluateInvoice("n1", EXPECTED, { text: "texto", error: null }, sync);
    const b = await evaluateInvoice("n2", EXPECTED, { text: "texto", error: null }, asyncExtractor);

    expect(sync).toHaveBeenCalledWith("texto");
    expect(a.statuses).toEqual(ALL_CORRECT);
    expect(b.statuses).toEqual({ ...ALL_CORRECT, amount: "wrong" });
  });
});

describe("summarize", () => {
  it("conta status por campo, acurácia geral, wrongs e erros de PDF", () => {
    const wrong: InvoiceResult = {
      ...result("n2", { description: "wrong" }),
      actual: { ...EXPECTED, description: "Outra coisa" },
    };
    const pdfError: InvoiceResult = {
      id: "n3",
      expected: EXPECTED,
      actual: null,
      error: "NO_TEXT",
      statuses: compareInvoice(EXPECTED, null),
    };

    const summary = summarize([result("n1"), wrong, pdfError]);

    expect(summary.invoiceCount).toBe(3);
    expect(summary.fields.description).toEqual({ correct: 1, missing: 1, wrong: 1, total: 3 });
    expect(summary.fields.amount).toEqual({ correct: 2, missing: 1, wrong: 0, total: 3 });
    expect(summary.overallAccuracy).toBeCloseTo(11 / 18);
    expect(summary.wrongs).toEqual([
      { id: "n2", field: "description", expected: EXPECTED.description, actual: "Outra coisa" },
    ]);
    expect(summary.pdfErrors).toEqual([{ id: "n3", error: "NO_TEXT" }]);
  });
});

describe("evaluateGate", () => {
  /** 50 notas (300 campos), com `bad` campos de description incorretos a partir da primeira. */
  function fiftyInvoices(bad: number, status: FieldStatus = "missing"): InvoiceResult[] {
    return Array.from({ length: 50 }, (_, i) => result(`n${i}`, i < bad ? { description: status } : {}));
  }

  it("passa com tudo correto", () => {
    expect(evaluateGate(summarize([result("n1")]))).toEqual({ passed: true, failures: [] });
  });

  it("falha com um wrong em amount, mesmo com acurácia alta", () => {
    const gate = evaluateGate(summarize([...fiftyInvoices(0), result("x", { amount: "wrong" })]));
    expect(gate).toEqual({ passed: false, failures: ["WRONG_AMOUNT"] });
  });

  it("falha com um wrong em providerCnpj, mesmo com acurácia alta", () => {
    const gate = evaluateGate(summarize([...fiftyInvoices(0), result("x", { providerCnpj: "wrong" })]));
    expect(gate).toEqual({ passed: false, failures: ["WRONG_CNPJ"] });
  });

  it("missing em amount ou providerCnpj não reprova sozinho", () => {
    const gate = evaluateGate(summarize([...fiftyInvoices(0), result("x", { amount: "missing", providerCnpj: "missing" })]));
    expect(gate.passed).toBe(true);
  });

  it("exatamente 98% passa", () => {
    // 6 erros em 300 campos = 98%
    const summary = summarize(fiftyInvoices(6));
    expect(summary.overallAccuracy).toBe(0.98);
    expect(evaluateGate(summary).passed).toBe(true);
  });

  it("abaixo de 98% falha", () => {
    // 7 erros em 300 campos ≈ 97,7%
    expect(evaluateGate(summarize(fiftyInvoices(7, "wrong")))).toEqual({ passed: false, failures: ["LOW_ACCURACY"] });
  });

  it("dataset vazio falha", () => {
    expect(evaluateGate(summarize([]))).toEqual({ passed: false, failures: ["EMPTY_DATASET"] });
  });
});
