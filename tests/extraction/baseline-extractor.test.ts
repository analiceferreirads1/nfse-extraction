import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractFieldsBaseline,
  parseBrDate,
  parseBrlAmount,
} from "../../src/extraction/baseline-extractor.js";
import { extractPdfText } from "../../src/extraction/pdf-to-text.js";
import type { ExtractedFields } from "../../src/extraction/types.js";

const datasetPath = (name: string) =>
  fileURLToPath(new URL(`../../datasets/nfse/${name}`, import.meta.url));

const ALL_NULL: ExtractedFields = {
  providerCnpj: null,
  providerName: null,
  invoiceNumber: null,
  issueDate: null,
  amount: null,
  description: null,
};

describe("extractFieldsBaseline", () => {
  it("extrai os 6 campos do PDF da NFS-e 001 igual ao esperado", async () => {
    const { text, error } = await extractPdfText(datasetPath("nfse-001.pdf"));
    expect(error).toBeNull();

    const expected = JSON.parse(await readFile(datasetPath("nfse-001.expected.json"), "utf8"));
    expect(extractFieldsBaseline(text)).toEqual(expected);
  });

  // Documenta a fragilidade da linha de base: rótulos diferentes não são reconhecidos
  // e os campos afetados ficam null. Comportamento esperado, não bug.
  it("deixa null os campos cujos rótulos mudaram de layout", () => {
    const text = [
      "Número da nota: 2048",
      "Emitida em - 20/10/2026",
      "Razão social: Beta Servicos Ficticios Ltda",
      "CNPJ do prestador - 12.345.678/0001-95",
      "Discriminação dos serviços",
      "Suporte técnico mensal",
      "Valor total da nota",
      "R$ 1.200,00",
    ].join("\n");

    expect(extractFieldsBaseline(text)).toEqual({
      providerCnpj: null,
      providerName: "Beta Servicos Ficticios Ltda",
      invoiceNumber: "2048",
      issueDate: null,
      amount: 1200,
      description: "Suporte técnico mensal",
    });
  });

  it("retorna tudo null para texto vazio", () => {
    expect(extractFieldsBaseline("")).toEqual(ALL_NULL);
  });

  it("deixa CNPJ null quando o rótulo aparece mais de uma vez (ambíguo)", () => {
    const text = "CNPJ: 12.345.678/0001-95\nCNPJ: 12.ABC.345/01DE-35";
    expect(extractFieldsBaseline(text).providerCnpj).toBeNull();
  });
});

describe("parseBrlAmount", () => {
  it("converte valor com milhar e centavos", () => {
    expect(parseBrlAmount("R$ 1.234.567,89")).toBe(1234567.89);
    expect(parseBrlAmount("R$ 8.500,00")).toBe(8500);
  });

  it("retorna null para formato fora do padrão brasileiro", () => {
    expect(parseBrlAmount("R$ 8,500.00")).toBeNull();
    expect(parseBrlAmount("R$ 8500")).toBeNull();
    expect(parseBrlAmount(null)).toBeNull();
  });
});

describe("parseBrDate", () => {
  it("converte DD/MM/AAAA para AAAA-MM-DD", () => {
    expect(parseBrDate("15/10/2026")).toBe("2026-10-15");
  });

  it("retorna null para data inexistente ou formato inválido", () => {
    expect(parseBrDate("31/02/2026")).toBeNull();
    expect(parseBrDate("2026-10-15")).toBeNull();
    expect(parseBrDate(null)).toBeNull();
  });
});
