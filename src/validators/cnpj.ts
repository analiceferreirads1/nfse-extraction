export type CnpjError =
  | "REQUIRED"
  | "INVALID_FORMAT"
  | "INVALID_LENGTH"
  | "INVALID_CHECK_DIGITS";

export interface CnpjValidationResult {
  cnpj: string;
  valid: boolean;
  error: CnpjError | null;
  message: string;
}

const CNPJ_LENGTH = 14;
const DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Remove pontos, barras, hífens e espaços; converte letras para maiúsculas. */
export function normalizeCnpj(input: string | null | undefined): string {
  if (input == null) return "";
  return input.replace(/[./\-\s]/g, "").toUpperCase();
}

/** Valor oficial do caractere no cálculo do DV: código ASCII - 48. */
function charValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

function computeCheckDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += charValue(base[i]!) * weights[i]!;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function fail(cnpj: string, error: CnpjError, message: string): CnpjValidationResult {
  return { cnpj, valid: false, error, message };
}

export function validateCnpj(input: string | null | undefined): CnpjValidationResult {
  const cnpj = normalizeCnpj(input);

  if (cnpj === "") {
    return fail(cnpj, "REQUIRED", "CNPJ é obrigatório.");
  }
  if (!/^[A-Z0-9]+$/.test(cnpj)) {
    return fail(cnpj, "INVALID_FORMAT", "CNPJ contém caracteres não permitidos.");
  }
  if (cnpj.length !== CNPJ_LENGTH) {
    return fail(cnpj, "INVALID_LENGTH", `CNPJ deve ter ${CNPJ_LENGTH} caracteres.`);
  }
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) {
    return fail(cnpj, "INVALID_FORMAT", "Os dígitos verificadores do CNPJ devem ser numéricos.");
  }
  if (/^(.)\1+$/.test(cnpj)) {
    return fail(cnpj, "INVALID_FORMAT", "CNPJ não pode ter todos os caracteres iguais.");
  }

  const dv1 = computeCheckDigit(cnpj, DV1_WEIGHTS);
  const dv2 = computeCheckDigit(cnpj.slice(0, 12) + dv1, DV2_WEIGHTS);
  if (cnpj.slice(12) !== `${dv1}${dv2}`) {
    return fail(cnpj, "INVALID_CHECK_DIGITS", "Dígitos verificadores do CNPJ não conferem.");
  }

  return { cnpj, valid: true, error: null, message: "CNPJ válido." };
}
