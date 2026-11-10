import { GoogleGenAI } from "@google/genai";

/**
 * Único ponto do projeto que conhece o Gemini. O resto do código depende só de
 * `GeminiClient`, e os testes injetam um `transport` falso: a API real nunca é
 * chamada fora do transport padrão.
 */

export interface GeminiRequest {
  systemInstruction: string;
  prompt: string;
  /** JSON Schema da resposta esperada. */
  responseSchema: object;
}

export interface GeminiUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface GeminiResponse {
  text: string;
  usage: GeminiUsage;
}

/** Uma chamada crua ao modelo, sem retry. Falhas HTTP devem lançar erro com `status` numérico. */
export type GeminiTransport = (request: GeminiRequest, model: string) => Promise<GeminiResponse>;

export type GeminiErrorCode =
  | "MISSING_API_KEY"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "REQUEST_FAILED"
  | "EMPTY_RESPONSE";

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly status: number | null;
  /** Quantas tentativas foram feitas até este erro ser lançado. */
  attempts = 1;

  constructor(code: GeminiErrorCode, status: number | null = null, cause?: unknown) {
    // Mensagem própria e genérica: a mensagem bruta do SDK fica só em `cause`.
    super(`Chamada ao Gemini falhou (${code}).`, { cause });
    this.name = "GeminiError";
    this.code = code;
    this.status = status;
  }
}

export interface GeminiCallLog extends GeminiUsage {
  event: "gemini_call";
  model: string;
  attempt: number;
  status: "ok" | GeminiErrorCode;
}

export interface GeminiClientOptions {
  transport?: GeminiTransport;
  sleep?: (ms: number) => Promise<void>;
  logger?: (entry: GeminiCallLog) => void;
  model?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export interface GeminiClient {
  generate(request: GeminiRequest): Promise<GeminiResponse>;
}

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const NO_USAGE: GeminiUsage = { promptTokens: null, outputTokens: null, totalTokens: null };

const RETRYABLE: ReadonlySet<GeminiErrorCode> = new Set(["RATE_LIMITED", "SERVER_ERROR"]);

/** Transport real, via SDK oficial. A chave é lida do ambiente só aqui e nunca é registrada. */
const sdkTransport: GeminiTransport = async (request, model) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("MISSING_API_KEY");

  // Sem `retryOptions`: o SDK não repete por conta própria; o retry é o deste arquivo.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
  const response = await ai.models.generateContent({
    model,
    contents: request.prompt,
    config: {
      systemInstruction: request.systemInstruction,
      temperature: 0,
      responseMimeType: "application/json",
      responseJsonSchema: request.responseSchema,
    },
  });

  const text = response.text;
  if (!text) throw new GeminiError("EMPTY_RESPONSE");

  const usage = response.usageMetadata;
  return {
    text,
    usage: {
      promptTokens: usage?.promptTokenCount ?? null,
      outputTokens: usage?.candidatesTokenCount ?? null,
      totalTokens: usage?.totalTokenCount ?? null,
    },
  };
};

/** Converte qualquer falha do transport em GeminiError, classificando pelo status HTTP. */
function toGeminiError(err: unknown): GeminiError {
  if (err instanceof GeminiError) return err;

  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return new GeminiError("REQUEST_FAILED", null, err);
  if (status === 429) return new GeminiError("RATE_LIMITED", status, err);
  if (status >= 500 && status <= 599) return new GeminiError("SERVER_ERROR", status, err);
  return new GeminiError("REQUEST_FAILED", status, err);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultLogger = (entry: GeminiCallLog) => console.log(JSON.stringify(entry));

/**
 * Cria o cliente com retry: 429 e 5xx são repetidos com espera crescente
 * (baseDelayMs, 2×, 4×…) até `maxAttempts` tentativas no total; qualquer outro
 * erro falha na hora. Cada tentativa gera uma linha de log com os tokens.
 */
export function createGeminiClient(options: GeminiClientOptions = {}): GeminiClient {
  const transport = options.transport ?? sdkTransport;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? defaultLogger;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  return {
    async generate(request) {
      const model = options.model ?? (process.env.GEMINI_MODEL || DEFAULT_MODEL);

      for (let attempt = 1; ; attempt++) {
        try {
          const response = await transport(request, model);
          logger({ event: "gemini_call", model, attempt, status: "ok", ...response.usage });
          return response;
        } catch (err) {
          const error = toGeminiError(err);
          error.attempts = attempt;
          logger({ event: "gemini_call", model, attempt, status: error.code, ...NO_USAGE });

          if (!RETRYABLE.has(error.code) || attempt >= maxAttempts) throw error;
          await sleep(baseDelayMs * 2 ** (attempt - 1));
        }
      }
    },
  };
}
