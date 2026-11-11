import { describe, expect, it } from "vitest";
import { runFolderName } from "../../src/output/run-folder.js";

describe("runFolderName", () => {
  it("gera AAAA-MM-DD_HHMMSS em hora local, com zeros à esquerda", () => {
    expect(runFolderName(new Date(2026, 10, 9, 7, 5, 3))).toBe("2026-11-09_070503");
  });

  it("usa 24 horas", () => {
    expect(runFolderName(new Date(2026, 0, 1, 23, 59, 59))).toBe("2026-01-01_235959");
  });
});
