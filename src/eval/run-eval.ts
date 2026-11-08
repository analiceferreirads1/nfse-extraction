import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFieldsBaseline } from "../extraction/baseline-extractor.js";
import { extractPdfText } from "../extraction/pdf-to-text.js";
import type { ExtractedFields } from "../extraction/types.js";
import {
  ACCURACY_THRESHOLD,
  type EvalSummary,
  evaluateGate,
  evaluateInvoice,
  type Extractor,
  FIELD_NAMES,
  type GateResult,
  type InvoiceResult,
  summarize,
} from "./compare.js";

/**
 * Executa a eval sobre datasets/nfse: para cada <id>.expected.json, extrai o
 * texto de <id>.pdf e aplica o extrator. Imprime o relatório e define o exit
 * code pelo gate (0 = passou, 1 = falhou ou erro).
 */

const DATASET_DIR = fileURLToPath(new URL("../../datasets/nfse/", import.meta.url));
const EXPECTED_SUFFIX = ".expected.json";

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

async function runEval(datasetDir: string, extractor: Extractor): Promise<InvoiceResult[]> {
  const files = await readdir(datasetDir);
  const ids = files.filter((f) => f.endsWith(EXPECTED_SUFFIX)).map((f) => f.slice(0, -EXPECTED_SUFFIX.length)).sort();

  for (const pdf of files.filter((f) => f.endsWith(".pdf"))) {
    if (!ids.includes(pdf.slice(0, -".pdf".length))) console.warn(`Aviso: ${pdf} sem gabarito, ignorado.`);
  }

  const results: InvoiceResult[] = [];
  for (const id of ids) {
    const expected = parseExpected(id, await readFile(join(datasetDir, `${id}${EXPECTED_SUFFIX}`), "utf8"));
    const pdf = await extractPdfText(join(datasetDir, `${id}.pdf`));
    results.push(await evaluateInvoice(id, expected, pdf, extractor));
  }
  return results;
}

const pct = (n: number, total: number) => (total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`);
const show = (v: unknown) => (v === null ? "null" : JSON.stringify(v));

function printReport(summary: EvalSummary, gate: GateResult): void {
  console.log(`\nEval do extrator — ${summary.invoiceCount} nota(s)\n`);

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

  console.log(gate.passed ? "\nGATE: PASSOU" : `\nGATE: FALHOU — ${gate.failures.join(", ")}`);
}

try {
  const summary = summarize(await runEval(DATASET_DIR, extractFieldsBaseline));
  const gate = evaluateGate(summary);
  printReport(summary, gate);
  process.exitCode = gate.passed ? 0 : 1;
} catch (err) {
  console.error("Eval interrompida:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
