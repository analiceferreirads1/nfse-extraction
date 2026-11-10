import { describe, expect, it, vi } from "vitest";
import { createGeminiClient, type GeminiTransport } from "../../src/ai/gemini-client.js";
import { buildEvalExtractors, type EvalExtractor, type EvalExtractorName } from "../../src/eval/extractors.js";
import type { ExtractedFields } from "../../src/extraction/types.js";

const COMPLETE_TEXT = [
  "Número da nota: 1024",
  "Data de emissão: 15/10/2026",
  "Razão social: Alfa Consultoria Ficticia Ltda",
  "CNPJ: 12.345.678/0001-95",
  "Discriminação dos serviços",
  "Consultoria em processos financeiros",
  "Valor total da nota",
  "R$ 8.500,00",
].join("\n");

/** Mesmo texto sem o valor: a linha de base deixa `amount` null. */
const TEXT_WITHOUT_AMOUNT = COMPLETE_TEXT.split("\n").slice(0, -2).join("\n");

const BASELINE: ExtractedFields = {
  providerCnpj: "12345678000195",
  providerName: "Alfa Consultoria Ficticia Ltda",
  invoiceNumber: "1024",
  issueDate: "2026-10-15",
  amount: 8500,
  description: "Consultoria em processos financeiros",
};

const AI_ANSWER = JSON.stringify({
  providerCnpj: "12.345.678/0001-95",
  providerName: "Alfa Consultoria Ficticia Ltda",
  invoiceNumber: "1024",
  issueDate: "2026-10-15",
  amount: 990.1,
  description: "Consultoria em processos financeiros",
});

const ZERO_USAGE = { calls: 0, failedInvoices: 0, failureCodes: {}, promptTokens: 0, outputTokens: 0, totalTokens: 0 };

/** Extratores sobre o cliente real com transport falso: a API nunca é chamada. */
function build(transport: GeminiTransport) {
  const spy = vi.fn(transport);
  const extractors = buildEvalExtractors((logger) =>
    createGeminiClient({ transport: spy, logger, sleep: async () => {}, model: "fake-model" }),
  );
  const get = (name: EvalExtractorName): EvalExtractor => extractors.find((e) => e.name === name)!;
  return { extractors, get, transport: spy };
}

const okTransport: GeminiTransport = async () => ({
  text: AI_ANSWER,
  usage: { promptTokens: 100, outputTokens: 20, totalTokens: 120 },
});

describe("buildEvalExtractors", () => {
  it("devolve linha de base, IA e cascata, nessa ordem", () => {
    expect(build(okTransport).extractors.map((e) => e.name)).toEqual(["baseline", "ai", "cascade"]);
  });

  it("baseline não usa a IA", async () => {
    const { get, transport } = build(okTransport);

    // A linha de base é síncrona: `await` aceita os dois casos, como a eval faz.
    expect(await get("baseline").extract(TEXT_WITHOUT_AMOUNT)).toEqual({ ...BASELINE, amount: null });

    expect(transport).not.toHaveBeenCalled();
    expect(get("baseline").usage()).toEqual(ZERO_USAGE);
  });

  it("ai soma chamadas e tokens de cada nota", async () => {
    const { get } = build(okTransport);

    await get("ai").extract(COMPLETE_TEXT);
    await get("ai").extract(TEXT_WITHOUT_AMOUNT);

    expect(get("ai").usage()).toEqual({
      ...ZERO_USAGE,
      calls: 2,
      promptTokens: 200,
      outputTokens: 40,
      totalTokens: 240,
    });
  });

  it("ai: falha vira 6 campos null e é contada por código, sem lançar", async () => {
    const { get } = build(async () => {
      throw Object.assign(new Error("bad request"), { status: 400 });
    });

    const fields = await get("ai").extract(COMPLETE_TEXT);

    expect(Object.values(fields)).toEqual(Array(6).fill(null));
    expect(get("ai").usage()).toEqual({
      ...ZERO_USAGE,
      calls: 1,
      failedInvoices: 1,
      failureCodes: { REQUEST_FAILED: 1 },
    });
  });

  it("retries contam como chamadas, mas a nota falha uma vez só", async () => {
    const { get } = build(async () => {
      throw Object.assign(new Error("unavailable"), { status: 503 });
    });

    await get("ai").extract(COMPLETE_TEXT);

    expect(get("ai").usage()).toMatchObject({ calls: 3, failedInvoices: 1, failureCodes: { SERVER_ERROR: 1 } });
  });

  it("ai: resposta que não é JSON conta como falha mesmo com a chamada ok", async () => {
    const { get } = build(async () => ({
      text: "não sei",
      usage: { promptTokens: 10, outputTokens: null, totalTokens: null },
    }));

    await get("ai").extract(COMPLETE_TEXT);

    expect(get("ai").usage()).toEqual({
      ...ZERO_USAGE,
      calls: 1,
      failedInvoices: 1,
      failureCodes: { INVALID_RESPONSE: 1 },
      promptTokens: 10,
    });
  });

  it("cascade não chama a IA quando a linha de base está completa", async () => {
    const { get, transport } = build(okTransport);

    await expect(get("cascade").extract(COMPLETE_TEXT)).resolves.toEqual(BASELINE);

    expect(transport).not.toHaveBeenCalled();
    expect(get("cascade").usage()).toEqual(ZERO_USAGE);
  });

  it("cascade chama a IA só para a nota com campo null e soma os tokens", async () => {
    const { get } = build(okTransport);

    await get("cascade").extract(COMPLETE_TEXT);
    await expect(get("cascade").extract(TEXT_WITHOUT_AMOUNT)).resolves.toEqual({ ...BASELINE, amount: 990.1 });

    expect(get("cascade").usage()).toEqual({
      ...ZERO_USAGE,
      calls: 1,
      promptTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
  });

  it("cascade: falha da IA mantém a linha de base e é contada", async () => {
    const { get } = build(async () => {
      throw Object.assign(new Error("too many"), { status: 429 });
    });

    await expect(get("cascade").extract(TEXT_WITHOUT_AMOUNT)).resolves.toEqual({ ...BASELINE, amount: null });

    expect(get("cascade").usage()).toMatchObject({ calls: 3, failedInvoices: 1, failureCodes: { RATE_LIMITED: 1 } });
  });

  it("o uso da IA sozinha e o da cascata não se misturam", async () => {
    const { get } = build(okTransport);

    await get("ai").extract(COMPLETE_TEXT);

    expect(get("ai").usage().calls).toBe(1);
    expect(get("cascade").usage().calls).toBe(0);
  });
});
