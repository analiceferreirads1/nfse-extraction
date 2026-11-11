import type { ExtractedFields } from "../extraction/types.js";
import type { FieldName } from "../validators/invoice-decision.js";

/**
 * Formatação de CSV para o Excel em português: `;` entre colunas, vírgula
 * decimal, CRLF e BOM UTF-8 (sem ele o Excel lê os acentos como Latin-1).
 * Funções puras, sem I/O.
 */

const BOM = "﻿";
const SEPARATOR = ";";
const NEWLINE = "\r\n";

/** Primeiros caracteres que o Excel interpreta como fórmula. */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[;"\r\n]/;

/** Nome da coluna de cada campo, também usado na lista de campos com problema. */
export const FIELD_COLUMNS: Readonly<Record<FieldName, string>> = {
  providerCnpj: "cnpj_prestador",
  providerName: "nome_prestador",
  invoiceNumber: "numero",
  issueDate: "data_emissao",
  amount: "valor",
  description: "descricao",
};

const FIELD_ORDER = Object.keys(FIELD_COLUMNS) as FieldName[];

/** Uma célula já formatada; `kind: "number"` dispensa a proteção contra fórmula. */
export type Cell = { kind: "text"; value: string | null } | { kind: "number"; value: string };

const text = (value: string | null): Cell => ({ kind: "text", value });

function renderCell(cell: Cell): string {
  let value = cell.value ?? "";
  // Texto vindo do PDF é não confiável: neutraliza fórmulas (CSV injection).
  if (cell.kind === "text" && FORMULA_START.test(value)) value = `'${value}`;
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [header.join(SEPARATOR), ...rows.map((row) => row.map(renderCell).join(SEPARATOR))];
  return BOM + lines.join(NEWLINE) + NEWLINE;
}

/** 8500 → "8500,00". Sem separador de milhar, para o Excel ler como número. */
export function formatAmount(amount: number | null): Cell {
  if (amount === null) return text(null);
  if (!Number.isFinite(amount)) return text(String(amount));
  return { kind: "number", value: amount.toFixed(2).replace(".", ",") };
}

/** "2026-10-15" → "15/10/2026"; fora do padrão AAAA-MM-DD fica como veio. */
export function formatDate(iso: string | null): Cell {
  const match = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return text(iso);
  const [, year, month, day] = match;
  return text(`${day}/${month}/${year}`);
}

/** 14 dígitos → "12.345.678/0001-95": a máscara impede o Excel de converter em número. */
export function formatCnpj(cnpj: string | null): Cell {
  const match = cnpj === null ? null : /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/.exec(cnpj);
  if (!match) return text(cnpj);
  const [, a, b, c, d, e] = match;
  return text(`${a}.${b}.${c}/${d}-${e}`);
}

function fieldCells(fields: ExtractedFields): Cell[] {
  return [
    formatCnpj(fields.providerCnpj),
    text(fields.providerName),
    text(fields.invoiceNumber),
    formatDate(fields.issueDate),
    formatAmount(fields.amount),
    text(fields.description),
  ];
}

const FIELD_HEADER = FIELD_ORDER.map((field) => FIELD_COLUMNS[field]);

export const APPROVED_HEADER = ["arquivo", ...FIELD_HEADER] as const;
export const REVIEW_HEADER = ["arquivo", "campos_com_problema", "motivos", ...FIELD_HEADER] as const;

export interface ApprovedRow {
  file: string;
  fields: ExtractedFields;
}

export interface ReviewRow extends ApprovedRow {
  problemFields: readonly FieldName[];
  reasons: readonly string[];
}

export function buildApprovedCsv(rows: readonly ApprovedRow[]): string {
  return toCsv(
    APPROVED_HEADER,
    rows.map((row) => [text(row.file), ...fieldCells(row.fields)]),
  );
}

export function buildReviewCsv(rows: readonly ReviewRow[]): string {
  return toCsv(
    REVIEW_HEADER,
    rows.map((row) => [
      text(row.file),
      text(row.problemFields.map((field) => FIELD_COLUMNS[field]).join(", ")),
      text(row.reasons.join(", ")),
      ...fieldCells(row.fields),
    ]),
  );
}
