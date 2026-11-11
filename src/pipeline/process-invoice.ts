import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { GeminiClient } from "../ai/gemini-client.js";
import { extractFieldsCascade } from "../extraction/cascade-extractor.js";
import { extractPdfText, type PdfTextError } from "../extraction/pdf-to-text.js";
import type { ExtractedFields } from "../extraction/types.js";
import { decideInvoice, type FieldName, type InvoiceStatus, type ReviewReason } from "../validators/invoice-decision.js";

/**
 * Processa uma NFS-e em PDF: texto → cascata → decisão. Nunca lança por causa
 * de um arquivo: qualquer problema vira revisão com código, e o lote continua.
 */

export type ProcessReason = ReviewReason | PdfTextError | "UNEXPECTED_ERROR";

export interface ProcessedInvoice {
  /** Nome do arquivo, sem a pasta. */
  file: string;
  status: InvoiceStatus;
  problemFields: FieldName[];
  reasons: ProcessReason[];
  fields: ExtractedFields;
}

export interface ProcessDeps {
  client: GeminiClient;
  /** Injetável para testes. */
  today?: Date;
}

const ALL_FIELDS: FieldName[] = [
  "providerCnpj",
  "providerName",
  "invoiceNumber",
  "issueDate",
  "amount",
  "description",
];

const ALL_NULL: ExtractedFields = {
  providerCnpj: null,
  providerName: null,
  invoiceNumber: null,
  issueDate: null,
  amount: null,
  description: null,
};

function unreadable(file: string, reason: ProcessReason): ProcessedInvoice {
  return { file, status: "review", problemFields: [...ALL_FIELDS], reasons: [reason], fields: { ...ALL_NULL } };
}

export async function processInvoice(filePath: string, deps: ProcessDeps): Promise<ProcessedInvoice> {
  const file = basename(filePath);
  try {
    const pdf = await extractPdfText(filePath);
    if (pdf.error !== null) return unreadable(file, pdf.error);

    const cascade = await extractFieldsCascade(pdf.text, deps.client);
    const decision = decideInvoice(cascade, deps.today);
    return { file, ...decision };
  } catch {
    // Mensagem do erro não é exposta: pode conter caminho ou dados do arquivo.
    return unreadable(file, "UNEXPECTED_ERROR");
  }
}

/** PDFs da pasta (sem subpastas), em ordem alfabética, um de cada vez. */
export async function processFolder(dir: string, deps: ProcessDeps): Promise<ProcessedInvoice[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const pdfs = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => entry.name)
    .sort();

  const results: ProcessedInvoice[] = [];
  for (const name of pdfs) results.push(await processInvoice(join(dir, name), deps));
  return results;
}
