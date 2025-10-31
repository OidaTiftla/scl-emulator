import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  SclEmulatorBuildError,
  executeStandaloneScl,
  prepareStandaloneProgram,
} from "../../src/index.js";

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/standalone");

function loadFixture(relativePath: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, relativePath), "utf8");
}

describe("executeStandaloneScl", () => {
  it("executes arithmetic loops with trace emission", () => {
    const source = loadFixture("sumOddNumbers.scl");

    const result = executeStandaloneScl(source, { trace: true });

    expect(result.variables.index).toBe(8);
    expect(result.variables.total).toBe(16);
    expect(result.trace).toBeDefined();
    expect(result.trace && result.trace.length).toBeGreaterThan(0);
  });

  it("handles Siemens scalar types", () => {
    const source = loadFixture("typeMix.scl");

    const result = executeStandaloneScl(source);

    expect(result.variables.counter).toBe(6);
    expect(result.variables.precise).toBeCloseTo(1.75);
    expect(result.variables.longCount).toBe(15);
    expect(result.variables.ready).toBe(true);
    expect(result.variables.name).toBe("ALPHA");
  });

  it("rejects references to undeclared variables", () => {
    const source = `
VAR
  total : INT;
END_VAR

total := missing + 1;
`;

    expect(() => executeStandaloneScl(source)).toThrow(SclEmulatorBuildError);
  });

  it("rejects direct PLC I/O addresses", () => {
    const source = `
VAR
  index : INT;
END_VAR

index := 0;
MB0 := index;
`;

    expect(() => executeStandaloneScl(source)).toThrow(SclEmulatorBuildError);
  });
});

describe("prepareStandaloneProgram", () => {
  it("wraps snippets into an executable block", () => {
    const source = `
VAR
  counter : INT;
END_VAR

counter := 5;
`;
    const prepared = prepareStandaloneProgram(source);
    expect(prepared.wrappedSource).toContain("FUNCTION_BLOCK __Standalone");
    expect(prepared.variables).toHaveLength(1);
  });
});
