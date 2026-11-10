import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGeminiClient } from "../ai/gemini-client.js";
import { extractPdfText, type PdfTextResult } from "../extraction/pdf-to-text.js";
import type { ExtractedFields } from "../extraction/types.js";
import {
  ACCURACY_THRESHOLD,
  type EvalSummary,
  evaluateGate,
  evaluateInvoice,
  FIELD_NAMES,
  type FieldStatus,
  type GateResult,
  type InvoiceResult,
  summarize,
} from "./compare.js";
import { type AiUsage, buildEvalExtractors, type EvalExtractorName } from "./extractors.js";

/**
 * Executa a eval sobre datasets/nfse: para cada <id>.expected.json, extrai o
 * texto de <id>.pdf e aplica os três extratores (linha de base, IA sozinha e
 * cascata) sobre o mesmo texto. Imprime a comparação e define o exit code pelo
 * gate da cascata (0 = passou, 1 = falhou ou erro).
 *
 * Os extratores com IA chamam a API real do Gemini (GEMINI_API_KEY no .env).
 */

const DATASET_DIR = fileURLToPath(new URL("../../datasets/nfse/", import.meta.url));
const EXPECTED_SUFFIX = ".expected.json";
/** Extrator julgado pelo gate. */
const GATED: EvalExtractorName = "cascade";

interface DatasetInvoice {
  id: string;
  expected: ExtractedFields;
  pdf: PdfTextResult;
}

interface ExtractorRun {
  name: EvalExtractorName;
  summary: EvalSummary;
  gate: GateResult;
  usage: AiUsage;
}

/** Valida a forma do gabarito; gabarito malformado é bug do dataset e interrompe a eval. */
function parseExpected(id: string, raw: string): ExtractedFields {
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null) throw new Error(`Gabarito inválido (${id}): não é objeto`);
  const record = data as Record<string, unknown>;
  for (const field of FIELD_NAMES) {
    const value = record[field];
    const expectedType = field === "amount" ? "number" : "string";
    if (value !== null && typeof value !== expectedType) {
      throw new Error(`Gabarito inválido (${id}): campo ${field} deve ser ${expectedType} ou null`);
    }
  }
  return record as unknown as ExtractedFields;
}

/** Lê gabaritos e textos dos PDFs uma única vez, para os três extratores verem a mesma entrada. */
async function loadDataset(datasetDir: string): Promise<DatasetInvoice[]> {
  const files = await readdir(datasetDir);
  const ids = files.filter((f) => f.endsWith(EXPECTED_SUFFIX)).map((f) => f.slice(0, -EXPECTED_SUFFIX.length)).sort();

  for (const pdf of files.filter((f) => f.endsWith(".pdf"))) {
    if (!ids.includes(pdf.slice(0, -".pdf".length))) console.warn(`Aviso: ${pdf} sem gabarito, ignorado.`);
  }

  const invoices: DatasetInvoice[] = [];
  for (const id of ids) {
    const expected = parseExpected(id, await readFile(join(datasetDir, `${id}${EXPECTED_SUFFIX}`), "utf8"));
    const pdf = await extractPdfText(join(datasetDir, `${id}.pdf`));
    invoices.push({ id, expected, pdf });
  }
  return invoices;
}

async function runAll(invoices: readonly DatasetInvoice[]): Promise<ExtractorRun[]> {
  const extractors = buildEvalExtractors((logger) => createGeminiClient({ logger }));

  const runs: ExtractorRun[] = [];
  for (const extractor of extractors) {
    const results: InvoiceResult[] = [];
    for (const { id, expected, pdf } of invoices) {
      results.push(await evaluateInvoice(id, expected, pdf, extractor.extract));
    }
    const summary = summarize(results);
    runs.push({ name: extractor.name, summary, gate: evaluateGate(summary), usage: extractor.usage() });
  }
  return runs;
}

const pct = (n: number, total: number) => (total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`);
const show = (v: unknown) => (v === null ? "null" : JSON.stringify(v));

function totalOf(summary: EvalSummary, status: FieldStatus): number {
  return FIELD_NAMES.reduce((sum, field) => sum + summary.fields[field][status], 0);
}

function printComparison(runs: readonly ExtractorRun[]): void {
  console.log(`\nEval dos extratores — ${runs[0]?.summary.invoiceCount ?? 0} nota(s)\n`);

  console.table(
    runs.map(({ name, summary, gate, usage }) => ({
      extrator: name,
      acuracia: `${(summary.overallAccuracy * 100).toFixed(1)}%`,
      correct: totalOf(summary, "correct"),
      missing: totalOf(summary, "missing"),
      wrong: totalOf(summary, "wrong"),
      tokens: usage.totalTokens,
      chamadasIA: usage.calls,
      falhasIA: usage.failedInvoices,
      gate: gate.passed ? "passou" : gate.failures.join(", "),
    })),
  );
  console.log("chamadasIA = requisições ao Gemini (inclui retries); falhasIA = notas em que a IA falhou.");

  for (const { name, usage } of runs) {
    if (usage.failedInvoices === 0) continue;
    const codes = Object.entries(usage.failureCodes).map(([code, count]) => `${code}×${count}`);
    console.log(`Falhas da IA (${name}): ${codes.join(", ")}`);
  }
}

function printDetail({ name, summary, gate }: ExtractorRun): void {
  console.log(`\nDetalhe por campo — ${name}`);

  const rows = FIELD_NAMES.map((field) => {
    const s = summary.fields[field];
    return {
      campo: field,
      correct: `${s.correct} (${pct(s.correct, s.total)})`,
      missing: `${s.missing} (${pct(s.missing, s.total)})`,
      wrong: `${s.wrong} (${pct(s.wrong, s.total)})`,
    };
  });
  console.table(rows);

  console.log(`Acurácia geral: ${(summary.overallAccuracy * 100).toFixed(1)}% (mínimo ${ACCURACY_THRESHOLD * 100}%)`);

  if (summary.pdfErrors.length > 0) {
    console.log("\nNotas com erro na leitura do PDF (todos os campos contam como missing):");
    for (const { id, error } of summary.pdfErrors) console.log(`  - ${id}: ${error}`);
  }

  console.log(`\nCampos errados (wrong): ${summary.wrongs.length}`);
  for (const w of summary.wrongs) {
    console.log(`  - ${w.id} | ${w.field} | esperado ${show(w.expected)} | obtido ${show(w.actual)}`);
  }

  console.log(gate.passed ? `\nGATE (${name}): PASSOU` : `\nGATE (${name}): FALHOU — ${gate.failures.join(", ")}`);
}

try {
  const runs = await runAll(await loadDataset(DATASET_DIR));
  const gated = runs.find((run) => run.name === GATED);
  if (gated === undefined) throw new Error(`Extrator ${GATED} não foi avaliado`);

  printComparison(runs);
  printDetail(gated);
  process.exitCode = gated.gate.passed ? 0 : 1;
} catch (err) {
  console.error("Eval interrompida:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
