import { fileURLToPath } from "node:url";
import { createGeminiClient, type GeminiCallLog, GeminiError } from "../src/ai/gemini-client.js";
import { AiExtractionError, extractFieldsAi } from "../src/extraction/ai-extractor.js";
import { extractPdfText } from "../src/extraction/pdf-to-text.js";

/**
 * Teste manual do extrator por IA: extrai a nfse-001 com uma chamada real ao
 * Gemini e mostra os 6 campos e os tokens. Requer GEMINI_API_KEY no .env.
 *
 * Uso: npm run try:ai
 */

const PDF_PATH = fileURLToPath(new URL("../datasets/nfse/nfse-001.pdf", import.meta.url));

async function main(): Promise<void> {
  const pdf = await extractPdfText(PDF_PATH);
  if (pdf.error !== null) {
    console.error(`Falha ao ler o PDF: ${pdf.error}`);
    process.exitCode = 1;
    return;
  }

  // Os tokens só saem pelo logger do cliente: guardamos cada tentativa aqui.
  const calls: GeminiCallLog[] = [];
  const client = createGeminiClient({ logger: (entry) => calls.push(entry) });

  try {
    const fields = await extractFieldsAi(pdf.text, client);
    console.log("Campos extraídos (nfse-001):");
    console.table(fields);
  } finally {
    // Mostra o consumo mesmo quando a extração falha depois da chamada.
    console.log("Chamadas ao Gemini:");
    console.table(
      calls.map(({ model, attempt, status, promptTokens, outputTokens, totalTokens }) => ({
        model,
        attempt,
        status,
        promptTokens,
        outputTokens,
        totalTokens,
      })),
    );
  }
}

try {
  await main();
} catch (err) {
  // Só códigos: a mensagem bruta do SDK (em `cause`) não é impressa.
  if (err instanceof GeminiError) {
    console.error(`Falha na chamada ao Gemini: ${err.code} (status ${err.status}, ${err.attempts} tentativa(s))`);
  } else if (err instanceof AiExtractionError) {
    console.error(`Falha na extração por IA: ${err.code}`);
  } else {
    console.error("Falha inesperada:", err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
}
