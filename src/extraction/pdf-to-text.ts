import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export type PdfTextError = "FILE_NOT_FOUND" | "INVALID_PDF" | "NO_TEXT";

export interface PdfTextResult {
  text: string;
  error: PdfTextError | null;
}

function fail(error: PdfTextError): PdfTextResult {
  return { text: "", error };
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Extrai o texto de todas as páginas de um PDF, juntas num único texto.
 * Arquivo inexistente, não-PDF ou sem texto extraível devolvem código de erro
 * em vez de lançar exceção. Outros erros de I/O (ex.: permissão) são relançados.
 */
export async function extractPdfText(filePath: string): Promise<PdfTextResult> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (err) {
    if (isNotFound(err)) return fail("FILE_NOT_FOUND");
    throw err;
  }

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch {
    return fail("INVALID_PDF");
  }

  // A liberação de recursos fica fora dos catch acima: uma falha nela é bug
  // de ambiente/código e não deve ser mascarada como INVALID_PDF.
  let text: string;
  try {
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch {
    return fail("INVALID_PDF");
  } finally {
    await pdf.loadingTask.destroy();
  }

  if (text.trim() === "") return fail("NO_TEXT");
  return { text, error: null };
}
