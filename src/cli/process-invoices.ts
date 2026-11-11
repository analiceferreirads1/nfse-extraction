import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGeminiClient } from "../ai/gemini-client.js";
import { buildApprovedCsv, buildReviewCsv } from "../output/csv.js";
import { runFolderName } from "../output/run-folder.js";
import { type ProcessedInvoice, processFolder } from "../pipeline/process-invoice.js";

/**
 * Uso: npm run process -- <pasta-com-pdfs>
 *
 * Grava output/AAAA-MM-DD_HHMMSS/aprovadas.csv e revisao.csv. Cada execução
 * cria uma subpasta nova; execuções anteriores nunca são apagadas nem
 * sobrescritas. A cascata chama a API real do Gemini (GEMINI_API_KEY no .env)
 * só quando a linha de base deixa campo em branco.
 */

const OUTPUT_DIR = fileURLToPath(new URL("../../output/", import.meta.url));

const isErrno = (err: unknown, code: string) =>
  err instanceof Error && (err as NodeJS.ErrnoException).code === code;

/** Cria a subpasta da execução; se o nome já existir, tenta _2, _3… sem tocar na existente. */
async function createRunDir(now: Date): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const base = runFolderName(now);
  for (let n = 1; ; n++) {
    const dir = join(OUTPUT_DIR, n === 1 ? base : `${base}_${n}`);
    try {
      await mkdir(dir);
      return dir;
    } catch (err) {
      if (!isErrno(err, "EEXIST")) throw err;
    }
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function printSummary(results: readonly ProcessedInvoice[], runDir: string): void {
  const approved = results.filter((r) => r.status === "approved").length;
  const reasons = new Map<string, number>();
  for (const r of results) for (const reason of r.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);

  console.log(`\nNotas processadas: ${results.length}`);
  console.log(`Aprovadas: ${approved}`);
  console.log(`Revisão: ${results.length - approved}`);
  for (const [reason, count] of reasons) console.log(`  - ${reason}: ${count}`);
  console.log(`\nArquivos gravados em: ${runDir}`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: npm run process -- <pasta-com-pdfs>");
    process.exitCode = 1;
    return;
  }
  const inputDir = resolve(arg);
  if (!(await isDirectory(inputDir))) {
    console.error(`Pasta não encontrada: ${inputDir}`);
    process.exitCode = 1;
    return;
  }

  const results = await processFolder(inputDir, { client: createGeminiClient() });
  if (results.length === 0) console.warn("Aviso: nenhum PDF encontrado na pasta.");

  const runDir = await createRunDir(new Date());
  // "wx": falha em vez de sobrescrever.
  await writeFile(join(runDir, "aprovadas.csv"), buildApprovedCsv(results.filter((r) => r.status === "approved")), {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(join(runDir, "revisao.csv"), buildReviewCsv(results.filter((r) => r.status === "review")), {
    encoding: "utf8",
    flag: "wx",
  });

  printSummary(results, runDir);
}

try {
  await main();
} catch (err) {
  console.error("Processamento interrompido:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
