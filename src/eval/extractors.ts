import type { GeminiCallLog, GeminiClient } from "../ai/gemini-client.js";
import { extractFieldsAi } from "../extraction/ai-extractor.js";
import { extractFieldsBaseline } from "../extraction/baseline-extractor.js";
import { type AiFailureCode, aiFailureCode, extractFieldsCascade } from "../extraction/cascade-extractor.js";
import type { ExtractedFields } from "../extraction/types.js";
import type { Extractor } from "./compare.js";

/**
 * Os três extratores comparados pela eval, instrumentados para medir o uso da
 * IA. Sem I/O próprio: quem chama fornece a fábrica do cliente Gemini.
 */

export interface AiUsage {
  /** Requisições enviadas ao Gemini: cada tentativa conta, inclusive retries. */
  calls: number;
  /** Notas em que a extração por IA terminou em falha. */
  failedInvoices: number;
  /** Quantas notas falharam por código (ex.: { RATE_LIMITED: 2 }). */
  failureCodes: Partial<Record<AiFailureCode, number>>;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type EvalExtractorName = "baseline" | "ai" | "cascade";

export interface EvalExtractor {
  name: EvalExtractorName;
  extract: Extractor;
  /** Uso acumulado da IA até o momento. */
  usage(): AiUsage;
}

export type GeminiClientFactory = (logger: (entry: GeminiCallLog) => void) => GeminiClient;

const ALL_NULL: ExtractedFields = {
  providerCnpj: null,
  providerName: null,
  invoiceNumber: null,
  issueDate: null,
  amount: null,
  description: null,
};

function emptyUsage(): AiUsage {
  return { calls: 0, failedInvoices: 0, failureCodes: {}, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
}

/** Acumula chamadas e tokens pelo logger do cliente; falhas são registradas por nota. */
function createTracker(makeClient: GeminiClientFactory) {
  const usage = emptyUsage();
  const client = makeClient((entry) => {
    usage.calls += 1;
    usage.promptTokens += entry.promptTokens ?? 0;
    usage.outputTokens += entry.outputTokens ?? 0;
    usage.totalTokens += entry.totalTokens ?? 0;
  });
  return {
    client,
    recordFailure(code: AiFailureCode): void {
      usage.failedInvoices += 1;
      usage.failureCodes[code] = (usage.failureCodes[code] ?? 0) + 1;
    },
    usage: (): AiUsage => ({ ...usage, failureCodes: { ...usage.failureCodes } }),
  };
}

/** Cada extrator com IA recebe um cliente próprio, para o uso não se misturar. */
export function buildEvalExtractors(makeClient: GeminiClientFactory): EvalExtractor[] {
  const ai = createTracker(makeClient);
  const cascade = createTracker(makeClient);

  return [
    { name: "baseline", extract: extractFieldsBaseline, usage: emptyUsage },
    {
      name: "ai",
      // Falha da IA não interrompe a eval: a nota fica com todos os campos missing.
      async extract(text) {
        try {
          return await extractFieldsAi(text, ai.client);
        } catch (err) {
          ai.recordFailure(aiFailureCode(err));
          return { ...ALL_NULL };
        }
      },
      usage: ai.usage,
    },
    {
      name: "cascade",
      async extract(text) {
        const result = await extractFieldsCascade(text, cascade.client);
        if (result.aiFailure !== null) cascade.recordFailure(result.aiFailure);
        return result.fields;
      },
      usage: cascade.usage,
    },
  ];
}
