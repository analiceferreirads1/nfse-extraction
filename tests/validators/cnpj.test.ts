import { describe, expect, it } from "vitest";
import { normalizeCnpj, validateCnpj } from "../../src/validators/cnpj.js";

describe("normalizeCnpj", () => {
  it("remove pontos, barras, hífens e espaços", () => {
    expect(normalizeCnpj(" 12.345.678/0001-95 ")).toBe("12345678000195");
    expect(normalizeCnpj("12 345 678 0001 95")).toBe("12345678000195");
  });

  it("converte letras para maiúsculas", () => {
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("retorna string vazia para null e undefined", () => {
    expect(normalizeCnpj(null)).toBe("");
    expect(normalizeCnpj(undefined)).toBe("");
  });
});

describe("validateCnpj", () => {
  function expectResult(
    input: string | null | undefined,
    expected: { cnpj: string; valid: boolean; error: string | null },
  ) {
    const result = validateCnpj(input);
    expect(result).toMatchObject(expected);
    expect(result.message).not.toBe("");
  }

  it("aceita CNPJ numérico válido com máscara", () => {
    expectResult("12.345.678/0001-95", { cnpj: "12345678000195", valid: true, error: null });
  });

  it("aceita CNPJ numérico válido sem máscara", () => {
    expectResult("12345678000195", { cnpj: "12345678000195", valid: true, error: null });
  });

  it("aceita CNPJ alfanumérico válido", () => {
    expectResult("12.ABC.345/01DE-35", { cnpj: "12ABC34501DE35", valid: true, error: null });
  });

  it("aceita CNPJ alfanumérico válido em minúsculas", () => {
    expectResult("12.abc.345/01de-35", { cnpj: "12ABC34501DE35", valid: true, error: null });
  });

  it("rejeita dígito verificador errado", () => {
    expectResult("12.345.678/0001-96", {
      cnpj: "12345678000196",
      valid: false,
      error: "INVALID_CHECK_DIGITS",
    });
    expectResult("12.ABC.345/01DE-36", {
      cnpj: "12ABC34501DE36",
      valid: false,
      error: "INVALID_CHECK_DIGITS",
    });
  });

  it("rejeita CNPJ com todos os caracteres iguais", () => {
    expectResult("00.000.000/0000-00", { cnpj: "00000000000000", valid: false, error: "INVALID_FORMAT" });
    expectResult("11111111111111", { cnpj: "11111111111111", valid: false, error: "INVALID_FORMAT" });
    expectResult("AAAAAAAAAAAAAA", { cnpj: "AAAAAAAAAAAAAA", valid: false, error: "INVALID_FORMAT" });
  });

  it("rejeita tamanho errado", () => {
    expectResult("1234567800019", { cnpj: "1234567800019", valid: false, error: "INVALID_LENGTH" });
    expectResult("123456780001955", { cnpj: "123456780001955", valid: false, error: "INVALID_LENGTH" });
  });

  it("rejeita caractere proibido", () => {
    expectResult("12.345.678/0001-9@", { cnpj: "1234567800019@", valid: false, error: "INVALID_FORMAT" });
    expectResult("12.ÇBC.345/01DE-35", { cnpj: "12ÇBC34501DE35", valid: false, error: "INVALID_FORMAT" });
  });

  it("rejeita letra nas posições dos dígitos verificadores", () => {
    expectResult("12ABC34501DE3A", { cnpj: "12ABC34501DE3A", valid: false, error: "INVALID_FORMAT" });
  });

  it("rejeita vazio", () => {
    expectResult("", { cnpj: "", valid: false, error: "REQUIRED" });
    expectResult("   ", { cnpj: "", valid: false, error: "REQUIRED" });
  });

  it("rejeita null e undefined", () => {
    expectResult(null, { cnpj: "", valid: false, error: "REQUIRED" });
    expectResult(undefined, { cnpj: "", valid: false, error: "REQUIRED" });
  });
});
