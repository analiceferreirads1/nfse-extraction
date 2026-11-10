import { GeminiError, type GeminiClient, type GeminiErrorCode } from "../ai/gemini-client.js";
import { AiExtractionError, type AiExtractionErrorCode, extractFieldsAi } from "./ai-extractor.js";
import { extractFieldsBaseline } from "./baseline-extractor.js";
import type { ExtractedFields } from "./types.js";

export type AiFailureCode = GeminiErrorCode | AiExtractionErrorCode | "UNEXPECTED_ERROR";

export interface CascadeResult {
  fields: ExtractedFields;
  /** null = a IA não foi necessária ou respondeu; código = a IA falhou e ficou só a linha de base. */
  aiFailure: AiFailureCode | null;
}

/** Classifica uma falha da extração por IA pelo código; nunca expõe a mensagem do erro. */
export function aiFailureCode(err: unknown): AiFailureCode {
  if (err instanceof GeminiError || err instanceof AiExtractionError) return err.code;
  return "UNEXPECTED_ERROR";
}

/**
 * Linha de base primeiro; a IA só é chamada se sobrar campo null, e só preenche
 * esses campos: um valor da linha de base nunca é sobrescrito. Falha da IA não
 * interrompe: o resultado da linha de base é mantido e a falha fica em `aiFailure`.
 *
 * Sem `client`, o cliente padrão do extrator por IA é criado apenas se a IA for necessária.
 */
export async function extractFieldsCascade(text: string, client?: GeminiClient): Promise<CascadeResult> {
  const base = extractFieldsBaseline(text);
  if (Object.values(base).every((value) => value !== null)) return { fields: base, aiFailure: null };

  let ai: ExtractedFields;
  try {
    ai = await extractFieldsAi(text, client);
  } catch (err) {
    return { fields: base, aiFailure: aiFailureCode(err) };
  }

  return {
    fields: {
      providerCnpj: base.providerCnpj ?? ai.providerCnpj,
      providerName: base.providerName ?? ai.providerName,
      invoiceNumber: base.invoiceNumber ?? ai.invoiceNumber,
      issueDate: base.issueDate ?? ai.issueDate,
      amount: base.amount ?? ai.amount,
      description: base.description ?? ai.description,
    },
    aiFailure: null,
  };
}
