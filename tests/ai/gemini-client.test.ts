import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGeminiClient,
  type GeminiCallLog,
  type GeminiRequest,
  type GeminiResponse,
  type GeminiTransport,
} from "../../src/ai/gemini-client.js";

const REQUEST: GeminiRequest = {
  systemInstruction: "instrução de teste",
  prompt: "texto de teste",
  responseSchema: { type: "object" },
};

const OK: GeminiResponse = {
  text: '{"ok":true}',
  usage: { promptTokens: 120, outputTokens: 30, totalTokens: 150 },
};

/** Erro no formato do SDK: um Error com `status` HTTP numérico. */
function httpError(status: number): Error {
  return Object.assign(new Error(`http ${status}`), { status });
}

/** Gemini falso: cada item da fila é a resposta (ou o erro) de uma tentativa. */
function setup(queue: Array<GeminiResponse | Error>) {
  const transport = vi.fn<GeminiTransport>(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("fila do Gemini falso esgotada");
    if (next instanceof Error) throw next;
    return next;
  });
  const waits: number[] = [];
  const logs: GeminiCallLog[] = [];
  const client = createGeminiClient({
    transport,
    model: "modelo-falso",
    sleep: async (ms) => {
      waits.push(ms);
    },
    logger: (entry) => {
      logs.push(entry);
    },
  });
  return { client, transport, waits, logs };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createGeminiClient", () => {
  it("devolve a resposta e registra os tokens da chamada", async () => {
    const { client, transport, waits, logs } = setup([OK]);

    await expect(client.generate(REQUEST)).resolves.toEqual(OK);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(REQUEST, "modelo-falso");
    expect(waits).toEqual([]);
    expect(logs).toEqual([
      {
        event: "gemini_call",
        model: "modelo-falso",
        attempt: 1,
        status: "ok",
        promptTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
      },
    ]);
  });

  it("tenta de novo após 429 e devolve o sucesso seguinte", async () => {
    const { client, transport, waits, logs } = setup([httpError(429), OK]);

    await expect(client.generate(REQUEST)).resolves.toEqual(OK);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1000]);
    expect(logs.map((l) => [l.attempt, l.status, l.totalTokens])).toEqual([
      [1, "RATE_LIMITED", null],
      [2, "ok", 150],
    ]);
  });

  it("desiste após 3 falhas seguidas de servidor, com espera crescente", async () => {
    const { client, transport, waits, logs } = setup([
      httpError(503),
      httpError(500),
      httpError(503),
      OK, // não pode ser alcançado
    ]);

    await expect(client.generate(REQUEST)).rejects.toMatchObject({
      code: "SERVER_ERROR",
      status: 503,
      attempts: 3,
    });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 2000]);
    expect(logs).toHaveLength(3);
  });

  it.each([400, 401, 403, 404])("não repete erro %i", async (status) => {
    const { client, transport, waits } = setup([httpError(status), OK]);

    await expect(client.generate(REQUEST)).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      status,
      attempts: 1,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("não repete erro sem status HTTP", async () => {
    const { client, transport } = setup([new Error("falha de rede simulada"), OK]);

    await expect(client.generate(REQUEST)).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      status: null,
      attempts: 1,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("falha com MISSING_API_KEY, sem rede e sem retry, quando a chave não está no ambiente", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const logs: GeminiCallLog[] = [];
    // Sem transport injetado: usa o real, que deve parar antes de acionar o SDK.
    const client = createGeminiClient({ logger: (entry) => logs.push(entry) });

    await expect(client.generate(REQUEST)).rejects.toMatchObject({
      code: "MISSING_API_KEY",
      attempts: 1,
    });
    expect(logs).toHaveLength(1);
  });

  it("não expõe a chave em logs nem no erro", async () => {
    const fakeKey = "chave-ficticia-somente-para-teste";
    vi.stubEnv("GEMINI_API_KEY", fakeKey);
    const { client, logs } = setup([httpError(429), httpError(400)]);

    const error: unknown = await client.generate(REQUEST).catch((e: unknown) => e);

    expect(JSON.stringify(logs)).not.toContain(fakeKey);
    expect(String(error)).not.toContain(fakeKey);
    expect(JSON.stringify(error)).not.toContain(fakeKey);
  });
});
