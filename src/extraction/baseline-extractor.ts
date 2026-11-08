import { normalizeCnpj } from "../validators/cnpj.js";
import type { ExtractedFields } from "./types.js";

/**
 * Extrator determinístico (sem IA) para o layout atual de NFS-e
 * (ver datasets/nfse/nfse-001.html). Depende dos rótulos exatos: em layouts
 * diferentes os campos afetados ficam null. Essa fragilidade é esperada.
 */

const LABEL = {
  invoiceNumber: "Número da nota:",
  issueDate: "Data de emissão:",
  providerName: "Razão social:",
  providerCnpj: "CNPJ:",
  description: "Discriminação dos serviços",
  amount: "Valor total da nota",
} as const;

/** Todos os rótulos conhecidos, usados para saber onde um bloco de texto termina. */
const KNOWN_LABELS: readonly string[] = [...Object.values(LABEL), "Prestador de serviços"];

/** Retorna o texto após o rótulo, ou null se a linha não começar com ele. */
function restAfterLabel(line: string, label: string): string | null {
  if (!line.startsWith(label)) return null;
  const rest = line.slice(label.length);
  // Evita casar prefixo de palavra maior (ex.: "CNPJ:" é ok, "Valor total da notaX" não).
  if (rest !== "" && !/^[:\s]/.test(rest)) return null;
  return rest.replace(/^:/, "").trim();
}

function isLabelLine(line: string): boolean {
  return KNOWN_LABELS.some((label) => restAfterLabel(line, label) !== null);
}

/** Índice da linha do rótulo; null se ausente ou repetido (ambíguo → revisão humana). */
function findLabelLine(lines: string[], label: string): number | null {
  const matches = lines.flatMap((line, i) => (restAfterLabel(line, label) !== null ? [i] : []));
  return matches.length === 1 ? matches[0]! : null;
}

/** Valor na mesma linha do rótulo; se vazio, a próxima linha não vazia que não seja rótulo. */
function valueAfter(lines: string[], label: string): string | null {
  const index = findLabelLine(lines, label);
  if (index === null) return null;

  const sameLine = restAfterLabel(lines[index]!, label)!;
  if (sameLine !== "") return sameLine;

  const next = lines.slice(index + 1).find((line) => line !== "");
  if (next === undefined || isLabelLine(next)) return null;
  return next;
}

/** Linhas após o rótulo até o próximo rótulo conhecido (ou fim do texto), unidas por espaço. */
function blockAfter(lines: string[], label: string): string | null {
  const index = findLabelLine(lines, label);
  if (index === null) return null;

  const collected: string[] = [];
  const sameLine = restAfterLabel(lines[index]!, label)!;
  if (sameLine !== "") collected.push(sameLine);
  for (const line of lines.slice(index + 1)) {
    if (isLabelLine(line)) break;
    if (line !== "") collected.push(line);
  }
  return collected.length > 0 ? collected.join(" ") : null;
}

/** Converte DD/MM/AAAA em AAAA-MM-DD; formato inválido ou data inexistente → null. */
export function parseBrDate(input: string | null): string | null {
  const match = input?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match as unknown as [string, string, string, string];

  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${yyyy}-${mm}-${dd}`;
}

/** Converte "R$ 1.234,56" em 1234.56; qualquer formato fora do padrão brasileiro → null. */
export function parseBrlAmount(input: string | null): number | null {
  const match = input?.trim().match(/^R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!match) return null;
  const [, integerPart, cents] = match as unknown as [string, string, string];
  return Number(`${integerPart.replace(/\./g, "")}.${cents}`);
}

export function extractFieldsBaseline(text: string): ExtractedFields {
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  const cnpj = normalizeCnpj(valueAfter(lines, LABEL.providerCnpj));

  return {
    providerCnpj: cnpj === "" ? null : cnpj,
    providerName: valueAfter(lines, LABEL.providerName),
    invoiceNumber: valueAfter(lines, LABEL.invoiceNumber),
    issueDate: parseBrDate(valueAfter(lines, LABEL.issueDate)),
    amount: parseBrlAmount(valueAfter(lines, LABEL.amount)),
    description: blockAfter(lines, LABEL.description),
  };
}
