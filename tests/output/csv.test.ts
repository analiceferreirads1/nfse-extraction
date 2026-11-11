import { describe, expect, it } from "vitest";
import type { ExtractedFields } from "../../src/extraction/types.js";
import {
  buildApprovedCsv,
  buildReviewCsv,
  formatAmount,
  formatCnpj,
  formatDate,
  toCsv,
} from "../../src/output/csv.js";

const BOM = "﻿";

/** NFS-e fictícia. */
const FIELDS: ExtractedFields = {
  providerCnpj: "12345678000195",
  providerName: "Gama Serviços Fictícios Ltda",
  invoiceNumber: "1024",
  issueDate: "2026-10-15",
  amount: 8500,
  description: "Serviços de manutenção preventiva",
};

/** Linhas do CSV sem BOM e sem a linha vazia final. */
function lines(csv: string): string[] {
  return csv.slice(BOM.length).split("\r\n").slice(0, -1);
}

describe("formatAmount", () => {
  it("usa vírgula decimal com duas casas e sem separador de milhar", () => {
    expect(formatAmount(8500).value).toBe("8500,00");
    expect(formatAmount(0.5).value).toBe("0,50");
    expect(formatAmount(1234567.891).value).toBe("1234567,89");
  });

  it("null vira célula vazia", () => {
    expect(formatAmount(null).value).toBeNull();
  });
});

describe("formatDate", () => {
  it("converte AAAA-MM-DD para DD/MM/AAAA", () => {
    expect(formatDate("2026-10-15").value).toBe("15/10/2026");
  });

  it("mantém valor fora do padrão como veio", () => {
    expect(formatDate("15 de outubro").value).toBe("15 de outubro");
    expect(formatDate(null).value).toBeNull();
  });
});

describe("formatCnpj", () => {
  it("aplica a máscara em 14 dígitos", () => {
    expect(formatCnpj("12345678000195").value).toBe("12.345.678/0001-95");
    expect(formatCnpj("01234567000189").value).toBe("01.234.567/0001-89");
  });

  it("mantém valor que não tem 14 dígitos", () => {
    expect(formatCnpj("123").value).toBe("123");
  });
});

describe("toCsv", () => {
  it("começa com BOM, separa com ; e termina linhas com CRLF", () => {
    const csv = toCsv(["a", "b"], [[{ kind: "text", value: "x" }, { kind: "text", value: "y" }]]);
    expect(csv).toBe(`${BOM}a;b\r\nx;y\r\n`);
  });

  it("coloca entre aspas e duplica aspas quando há ; \" ou quebra de linha", () => {
    const csv = toCsv(
      ["c"],
      [
        [{ kind: "text", value: "a;b" }],
        [{ kind: "text", value: 'diz "oi"' }],
        [{ kind: "text", value: "linha1\nlinha2" }],
      ],
    );
    expect(csv).toBe(`${BOM}c\r\n"a;b"\r\n"diz ""oi"""\r\n"linha1\nlinha2"\r\n`);
  });

  it("neutraliza texto que o Excel leria como fórmula", () => {
    const cells = ["=SOMA(A1:A2)", "+1", "-1", "@x"].map((value) => [{ kind: "text" as const, value }]);
    expect(lines(toCsv(["c"], cells)).slice(1)).toEqual(["'=SOMA(A1:A2)", "'+1", "'-1", "'@x"]);
  });

  it("não altera número negativo", () => {
    expect(lines(toCsv(["v"], [[formatAmount(-50)]]))[1]).toBe("-50,00");
  });
});

describe("buildApprovedCsv", () => {
  it("grava arquivo e os 6 campos formatados, com acentos", () => {
    const csv = buildApprovedCsv([{ file: "nota-1.pdf", fields: FIELDS }]);

    expect(csv.startsWith(BOM)).toBe(true);
    expect(lines(csv)).toEqual([
      "arquivo;cnpj_prestador;nome_prestador;numero;data_emissao;valor;descricao",
      "nota-1.pdf;12.345.678/0001-95;Gama Serviços Fictícios Ltda;1024;15/10/2026;8500,00;Serviços de manutenção preventiva",
    ]);
  });

  it("sem notas, grava só o cabeçalho", () => {
    expect(lines(buildApprovedCsv([]))).toHaveLength(1);
  });
});

describe("buildReviewCsv", () => {
  it("grava campos com problema, motivos e os valores já extraídos", () => {
    const csv = buildReviewCsv([
      {
        file: "nota-2.pdf",
        problemFields: ["providerCnpj", "amount"],
        reasons: ["INVALID_CNPJ", "MISSING_FIELD"],
        fields: { ...FIELDS, providerCnpj: "11111111111111", amount: null },
      },
    ]);

    expect(lines(csv)).toEqual([
      "arquivo;campos_com_problema;motivos;cnpj_prestador;nome_prestador;numero;data_emissao;valor;descricao",
      "nota-2.pdf;cnpj_prestador, valor;INVALID_CNPJ, MISSING_FIELD;11.111.111/1111-11;Gama Serviços Fictícios Ltda;1024;15/10/2026;;Serviços de manutenção preventiva",
    ]);
  });
});
