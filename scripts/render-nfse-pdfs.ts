import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

/**
 * Gera datasets/nfse/<id>.pdf a partir de <id>.html usando o Chrome instalado
 * (mesmo motor que imprimiu a nfse-001). Só renderiza PDFs ausentes; use
 * --force para refazer todos. Caminho do Chrome via CHROME_PATH.
 *
 * Uso: npm run dataset:pdf [-- --force]
 */

const DATASET_DIR = fileURLToPath(new URL("../datasets/nfse/", import.meta.url));
const DEFAULT_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
/** Fixture original, impressa à mão; nunca sobrescrever. */
const PROTECTED = new Set(["nfse-001"]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const files = await readdir(DATASET_DIR);
  const ids = files.filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -".html".length)).sort();

  const pending: string[] = [];
  for (const id of ids) {
    if (PROTECTED.has(id)) continue;
    if (force || !(await exists(join(DATASET_DIR, `${id}.pdf`)))) pending.push(id);
  }
  if (pending.length === 0) {
    console.log("Nenhum PDF a gerar.");
    return;
  }

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? DEFAULT_CHROME });
  try {
    const page = await browser.newPage();
    for (const id of pending) {
      await page.goto(pathToFileURL(join(DATASET_DIR, `${id}.html`)).href, { waitUntil: "load", timeout: 30_000 });
      await page.pdf({
        path: join(DATASET_DIR, `${id}.pdf`),
        format: "A4",
        displayHeaderFooter: false,
        printBackground: true,
        margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
      });
      console.log(`Gerado: ${id}.pdf`);
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (err) {
  console.error("Falha ao gerar PDFs:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
