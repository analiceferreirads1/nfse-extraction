import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPdfText } from "../../src/extraction/pdf-to-text.js";

const datasetPath = (name: string) =>
  fileURLToPath(new URL(`../../datasets/nfse/${name}`, import.meta.url));

/**
 * Monta um PDF mínimo e válido com uma única página.
 * Sem `content`, a página fica em branco (como um PDF escaneado: sem camada de texto).
 */
function buildMinimalPdf(content?: string): string {
  const pageResources = content ? " /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R" : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]${pageResources} >>`,
  ];
  if (content) {
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

describe("extractPdfText", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nfse-pdf-to-text-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extrai o texto da NFS-e 001", async () => {
    const result = await extractPdfText(datasetPath("nfse-001.pdf"));
    expect(result.error).toBeNull();
    expect(result.text).toContain("12.345.678/0001-95");
    expect(result.text).toContain("R$ 8.500,00");
    expect(result.text).toContain("15/10/2026");
  });

  it("retorna FILE_NOT_FOUND para caminho inexistente", async () => {
    const result = await extractPdfText(join(tempDir, "nao-existe.pdf"));
    expect(result).toEqual({ text: "", error: "FILE_NOT_FOUND" });
  });

  it("retorna INVALID_PDF para arquivo que não é PDF", async () => {
    const result = await extractPdfText(datasetPath("nfse-001.html"));
    expect(result).toEqual({ text: "", error: "INVALID_PDF" });
  });

  it.each([
    ["página em branco (sem camada de texto)", "blank.pdf", undefined],
    ["página só com espaços", "spaces.pdf", "BT /F1 12 Tf 72 720 Td (   ) Tj ET"],
  ])("retorna NO_TEXT para %s", async (_label, fileName, content) => {
    const filePath = join(tempDir, fileName);
    await writeFile(filePath, buildMinimalPdf(content), "latin1");
    const result = await extractPdfText(filePath);
    expect(result).toEqual({ text: "", error: "NO_TEXT" });
  });
});
