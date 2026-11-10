import { describe, expect, it, vi } from "vitest";
import { GeminiError, type GeminiClient } from "../../src/ai/gemini-client.js";
import { extractFieldsCascade } from "../../src/extraction/cascade-extractor.js";
import type { ExtractedFields } from "../../src/extraction/types.js";

const LINES = {
  invoiceNumber: "Número da nota: 1024",
  issueDate: "Data de emissão: 15/10/2026",
  providerName: "Razão social: Alfa Consultoria Ficticia Ltda",
  providerCnpj: "CNPJ: 12.345.678/0001-95",
  description: "Discriminação dos serviços\nConsultoria em processos financeiros",
  amount: "Valor total da nota\nR$ 8.500,00",
};

/** Texto no layout da linha de base, sem as linhas dos campos em `omit`. */
function nfseText(omit: (keyof typeof LINES)[] = []): string {
  return Object.entries(LINES)
    .filter(([field]) => !omit.includes(field as keyof typeof LINES))
    .map(([, line]) => line)
    .join("\n");
}

const BASELINE: ExtractedFields = {
  providerCnpj: "12345678000195",
  providerName: "Alfa Consultoria Ficticia Ltda",
  invoiceNumber: "1024",
  issueDate: "2026-10-15",
  amount: 8500,
  description: "Consultoria em processos financeiros",
};

/** Resposta da IA com valores diferentes dos da linha de base em todos os campos. */
const AI_ANSWER = {
  providerCnpj: "11.222.333/0001-81",
  providerName: "Beta Servicos Ficticios Ltda",
  invoiceNumber: "2048",
  issueDate: "2026-11-01",
  amount: 1200.5,
  description: "Suporte técnico mensal",
};

function fakeClient(responseText: string) {
  const generate = vi.fn<GeminiClient["generate"]>(async () => ({
    text: responseText,
    usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 },
  }));
  return { generate };
}

const answering = (fields: Record<string, unknown>) => fakeClient(JSON.stringify(fields));

function failingClient(error: unknown) {
  const generate = vi.fn<GeminiClient["generate"]>(async () => {
    throw error;
  });
  return { generate };
}

describe("extractFieldsCascade", () => {
  it("não chama a IA quando a linha de base preenche os 6 campos", async () => {
    const client = answering(AI_ANSWER);

    await expect(extractFieldsCascade(nfseText(), client)).resolves.toEqual({
      fields: BASELINE,
      aiFailure: null,
    });
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("chama a IA uma vez e preenche só o campo null, sem sobrescrever a linha de base", async () => {
    const client = answering(AI_ANSWER);

    await expect(extractFieldsCascade(nfseText(["amount"]), client)).resolves.toEqual({
      fields: { ...BASELINE, amount: 1200.5 },
      aiFailure: null,
    });
    expect(client.generate).toHaveBeenCalledTimes(1);
  });

  it("preenche vários campos null de uma vez", async () => {
    const client = answering(AI_ANSWER);

    const result = await extractFieldsCascade(nfseText(["providerCnpj", "description"]), client);

    expect(result.fields).toEqual({
      ...BASELINE,
      providerCnpj: "11222333000181",
      description: "Suporte técnico mensal",
    });
  });

  it("mantém null o campo que a IA também não encontrou", async () => {
    const client = answering({ ...AI_ANSWER, amount: null });

    await expect(extractFieldsCascade(nfseText(["amount"]), client)).resolves.toEqual({
      fields: { ...BASELINE, amount: null },
      aiFailure: null,
    });
  });

  it("mantém null o campo que a IA devolveu inválido", async () => {
    const client = answering({ ...AI_ANSWER, providerCnpj: "11.222.333/0001-82" });

    const result = await extractFieldsCascade(nfseText(["providerCnpj"]), client);

    expect(result).toEqual({ fields: { ...BASELINE, providerCnpj: null }, aiFailure: null });
  });

  it.each([
    ["erro do Gemini", new GeminiError("SERVER_ERROR", 503), "SERVER_ERROR"],
    ["limite de taxa", new GeminiError("RATE_LIMITED", 429), "RATE_LIMITED"],
    ["erro inesperado", new Error("boom"), "UNEXPECTED_ERROR"],
  ])("com %s, mantém a linha de base e marca a falha sem lançar", async (_name, error, code) => {
    const client = failingClient(error);

    await expect(extractFieldsCascade(nfseText(["amount"]), client)).resolves.toEqual({
      fields: { ...BASELINE, amount: null },
      aiFailure: code,
    });
    expect(client.generate).toHaveBeenCalledTimes(1);
  });

  it("marca INVALID_RESPONSE quando a IA responde algo que não é JSON", async () => {
    const client = fakeClient("desculpe, não consegui");

    await expect(extractFieldsCascade(nfseText(["issueDate"]), client)).resolves.toEqual({
      fields: { ...BASELINE, issueDate: null },
      aiFailure: "INVALID_RESPONSE",
    });
  });
});
