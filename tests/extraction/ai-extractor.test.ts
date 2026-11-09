import { describe, expect, it, vi } from "vitest";
import { GeminiError, type GeminiClient, type GeminiRequest } from "../../src/ai/gemini-client.js";
import { extractFieldsAi } from "../../src/extraction/ai-extractor.js";
import type { ExtractedFields } from "../../src/extraction/types.js";

const NFSE_TEXT = "Número da nota: 2048\nRazão social: Beta Servicos Ficticios Ltda";

const VALID = {
  providerCnpj: "12.345.678/0001-95",
  providerName: "Beta Servicos Ficticios Ltda",
  invoiceNumber: "2048",
  issueDate: "2026-10-15",
  amount: 1200.5,
  description: "Suporte técnico mensal",
};

const EXPECTED: ExtractedFields = { ...VALID, providerCnpj: "12345678000195" };

/** Gemini falso: devolve sempre o texto dado como resposta do modelo. */
function fakeClient(responseText: string) {
  const generate = vi.fn<GeminiClient["generate"]>(async () => ({
    text: responseText,
    usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 },
  }));
  return { generate };
}

const answering = (fields: Record<string, unknown>) => fakeClient(JSON.stringify(fields));

describe("extractFieldsAi", () => {
  it("devolve os 6 campos de uma resposta válida, com CNPJ normalizado", async () => {
    const client = answering(VALID);

    await expect(extractFieldsAi(NFSE_TEXT, client)).resolves.toEqual(EXPECTED);

    expect(client.generate).toHaveBeenCalledTimes(1);
    const request = client.generate.mock.calls[0]![0] satisfies GeminiRequest;
    expect(request.prompt).toContain(NFSE_TEXT);
  });

  it("mantém null o campo que o modelo marcou como incerto", async () => {
    const client = answering({ ...VALID, amount: null, providerCnpj: null });

    await expect(extractFieldsAi(NFSE_TEXT, client)).resolves.toEqual({
      ...EXPECTED,
      amount: null,
      providerCnpj: null,
    });
  });

  it("anula campo ausente da resposta e descarta campo extra", async () => {
    const { description: _omitted, ...withoutDescription } = VALID;
    const client = answering({ ...withoutDescription, extra: "ignorado" });

    await expect(extractFieldsAi(NFSE_TEXT, client)).resolves.toEqual({
      ...EXPECTED,
      description: null,
    });
  });

  it.each<[string, Record<string, unknown>, keyof ExtractedFields]>([
    ["CNPJ com dígito verificador errado", { providerCnpj: "12.345.678/0001-96" }, "providerCnpj"],
    ["CNPJ que não é string", { providerCnpj: 12345678000195 }, "providerCnpj"],
    ["valor como string", { amount: "1200,50" }, "amount"],
    ["valor zero", { amount: 0 }, "amount"],
    ["valor negativo", { amount: -10 }, "amount"],
    ["data inexistente", { issueDate: "2026-02-31" }, "issueDate"],
    ["data fora do formato AAAA-MM-DD", { issueDate: "15/10/2026" }, "issueDate"],
    ["texto só com espaços", { providerName: "   " }, "providerName"],
    ["número da nota como número", { invoiceNumber: 2048 }, "invoiceNumber"],
  ])("anula %s e preserva os demais campos", async (_name, override, field) => {
    const client = answering({ ...VALID, ...override });

    await expect(extractFieldsAi(NFSE_TEXT, client)).resolves.toEqual({
      ...EXPECTED,
      [field]: null,
    });
  });

  it.each([
    ["texto que não é JSON", "desculpe, não consegui"],
    ["array", "[]"],
    ["null", "null"],
    ["string JSON", '"2048"'],
  ])("falha com INVALID_RESPONSE quando a resposta é %s", async (_name, responseText) => {
    await expect(extractFieldsAi(NFSE_TEXT, fakeClient(responseText))).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("devolve tudo null para texto vazio, sem chamar o modelo", async () => {
    const client = answering(VALID);

    await expect(extractFieldsAi("  \n ", client)).resolves.toEqual({
      providerCnpj: null,
      providerName: null,
      invoiceNumber: null,
      issueDate: null,
      amount: null,
      description: null,
    });
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("repassa o erro do cliente sem alterar", async () => {
    const client = {
      generate: vi.fn<GeminiClient["generate"]>(async () => {
        throw new GeminiError("SERVER_ERROR", 503);
      }),
    };

    await expect(extractFieldsAi(NFSE_TEXT, client)).rejects.toMatchObject({
      code: "SERVER_ERROR",
      status: 503,
    });
  });
});
