import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError, type GeminiClient } from "../../src/ai/gemini-client.js";
import { processFolder, processInvoice } from "../../src/pipeline/process-invoice.js";

const DATASET = fileURLToPath(new URL("../../datasets/nfse/", import.meta.url));
const TODAY = new Date(2026, 10, 10);

/** Cliente que nunca deveria ser usado: se a IA for chamada, o teste vê. */
function unusedClient() {
  return {
    generate: vi.fn<GeminiClient["generate"]>(async () => {
      throw new GeminiError("REQUEST_FAILED");
    }),
  };
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "nfse-process-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("processInvoice", () => {
  it("aprova NFS-e fictícia resolvida pela linha de base, sem chamar a IA", async () => {
    const client = unusedClient();
    const result = await processInvoice(join(DATASET, "nfse-001.pdf"), { client, today: TODAY });

    expect(client.generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      file: "nfse-001.pdf",
      status: "approved",
      problemFields: [],
      reasons: [],
      fields: { providerCnpj: "12345678000195", invoiceNumber: "1024", amount: 8500 },
    });
  });

  it("manda para revisão com FILE_NOT_FOUND quando o arquivo não existe", async () => {
    const client = unusedClient();
    const result = await processInvoice(join(tmp, "nao-existe.pdf"), { client, today: TODAY });

    expect(result.status).toBe("review");
    expect(result.reasons).toEqual(["FILE_NOT_FOUND"]);
    expect(result.problemFields).toHaveLength(6);
    expect(Object.values(result.fields).every((v) => v === null)).toBe(true);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("manda para revisão com INVALID_PDF quando o arquivo não é PDF", async () => {
    const path = join(tmp, "falso.pdf");
    await writeFile(path, "isto não é um PDF");

    const result = await processInvoice(path, { client: unusedClient(), today: TODAY });

    expect(result.reasons).toEqual(["INVALID_PDF"]);
  });
});

describe("processFolder", () => {
  it("processa só os .pdf da pasta, em ordem alfabética", async () => {
    await copyFile(join(DATASET, "nfse-002.pdf"), join(tmp, "b.pdf"));
    await copyFile(join(DATASET, "nfse-001.pdf"), join(tmp, "a.PDF"));
    await writeFile(join(tmp, "notas.txt"), "ignorar");

    const results = await processFolder(tmp, { client: unusedClient(), today: TODAY });

    expect(results.map((r) => r.file)).toEqual(["a.PDF", "b.pdf"]);
  });
});
