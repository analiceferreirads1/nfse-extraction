import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIELD_NAMES } from "../../src/eval/compare.js";
import { extractPdfText } from "../../src/extraction/pdf-to-text.js";
import { validateCnpj } from "../../src/validators/cnpj.js";
import { validateInvoice } from "../../src/validators/invoice.js";

/** Integridade do dataset: cada gabarito tem HTML e PDF legível, CNPJ válido e campos coerentes. */

const DATASET_DIR = fileURLToPath(new URL("../../datasets/nfse/", import.meta.url));
const SUFFIX = ".expected.json";
const TODAY = new Date(2026, 10, 9); // 2026-11-09, fuso local

const ids = (await readdir(DATASET_DIR))
  .filter((f) => f.endsWith(SUFFIX))
  .map((f) => f.slice(0, -SUFFIX.length))
  .sort();

const readExpected = async (id: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(DATASET_DIR, `${id}${SUFFIX}`), "utf8"));

describe("dataset nfse", () => {
  it("tem 10 notas (nfse-001 a nfse-010)", () => {
    expect(ids).toEqual(Array.from({ length: 10 }, (_, i) => `nfse-${String(i + 1).padStart(3, "0")}`));
  });

  describe.each(ids)("%s", (id) => {
    it("tem HTML e PDF com texto extraível", async () => {
      await expect(access(join(DATASET_DIR, `${id}.html`))).resolves.toBeUndefined();
      const { error } = await extractPdfText(join(DATASET_DIR, `${id}.pdf`));
      expect(error).toBeNull();
    });

    it("tem gabarito completo, com CNPJ válido e valor/data válidos", async () => {
      const expected = await readExpected(id);
      for (const field of FIELD_NAMES) {
        expect(typeof expected[field]).toBe(field === "amount" ? "number" : "string");
      }
      expect(expected.providerCnpj).toMatch(/^\d{14}$/);
      expect(validateCnpj(expected.providerCnpj as string).error).toBeNull();
      expect(
        validateInvoice({ amount: expected.amount as number, issueDate: expected.issueDate as string }, TODAY).errors,
      ).toEqual([]);
    });
  });
});
