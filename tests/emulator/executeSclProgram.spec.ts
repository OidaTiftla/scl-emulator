import { describe, expect, it } from "vitest";

import {
  SclEmulatorBuildError,
  SclEmulatorRuntimeError,
  createPlcState,
  executeSclProgram,
  parseScl,
} from "../../src/index.js";

describe("executeSclProgram", () => {
  it("executes assignments and boolean logic against PLC flags", () => {
    const source = `
      FUNCTION_BLOCK Toggle
      VAR
        toggleFlag : BOOL;
      END_VAR
      BEGIN
        toggleFlag := NOT toggleFlag;
        M0.0 := toggleFlag;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      flags: { size: 1 },
      dataBlocks: [{ id: 1, size: 1 }],
    });

    const result = executeSclProgram(ast, state, {
      trace: true,
      symbols: {
        toggleFlag: "DB1.DBX0.0",
      },
    });

    const toggleValue = state.readBool("DB1.DBX0.0");
    expect(toggleValue.ok).toBe(true);
    expect(toggleValue.ok && toggleValue.value).toBe(true);

    const flagValue = state.readBool("M0.0");
    expect(flagValue.ok).toBe(true);
    expect(flagValue.ok && flagValue.value).toBe(true);

    expect(result.trace).toBeDefined();
    expect(result.trace?.length).toBe(2);
    expect(result.trace?.[0]?.effects[0]?.address).toBe("DB1.DBX0.0");
    expect(result.trace?.[1]?.effects[0]?.address).toBe("M0.0");
  });

  it("evaluates WHILE loops and updates INT variables mapped to a data block", () => {
    const source = `
      FUNCTION_BLOCK Counter
      VAR
        count : INT := 0;
      END_VAR
      BEGIN
        WHILE count < 3 DO
          count := count + 1;
        END_WHILE;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      dataBlocks: [{ id: 1, size: 8 }],
    });

    const result = executeSclProgram(ast, state, {
      symbols: {
        count: "DB1.DBW0",
      },
    });

    expect(result.snapshot.dataBlocks[1]?.[0]).toBeDefined();
    const countValue = state.readInt("DB1.DBW0");
    expect(countValue.ok && countValue.value).toBe(3);
  });

  it("executes CASE selectors with ELSE branch to drive outputs", () => {
    const source = `
      FUNCTION_BLOCK ModeSwitcher
      VAR
        mode : INT;
      END_VAR
      BEGIN
        CASE mode OF
          0: QB0 := 0;
          1: QB0 := 1;
        ELSE
          QB0 := 255;
        END_CASE;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      outputs: { size: 1 },
      dataBlocks: [{ id: 1, size: 8 }],
    });

    // Seed the mode variable to branch into selector "1".
    state.writeInt("DB1.DBW0", 1);

    executeSclProgram(ast, state, {
      symbols: {
        mode: "DB1.DBW0",
      },
    });

    const output = state.readByte("QB0");
    expect(output.ok && output.value).toBe(1);
  });

  it("enforces loop iteration guard", () => {
    const source = `
      FUNCTION_BLOCK Infinite
      VAR
        flag : BOOL;
      END_VAR
      BEGIN
        WHILE TRUE DO
          flag := NOT flag;
        END_WHILE;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      dataBlocks: [{ id: 1, size: 1 }],
    });

    expect(() =>
      executeSclProgram(ast, state, {
        symbols: {
          flag: "DB1.DBX0.0",
        },
        maxLoopIterations: 5,
      })
    ).toThrow(SclEmulatorRuntimeError);
  });

  it("throws a descriptive build error for unsupported statements", () => {
    const source = `
      FUNCTION_BLOCK Unsupported
      VAR
        count : INT;
      END_VAR
      BEGIN
        FOR count := 0 TO 3 DO
          count := count + 1;
        END_FOR;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      dataBlocks: [{ id: 1, size: 8 }],
    });

    expect(() =>
      executeSclProgram(ast, state, {
        symbols: {
          count: "DB1.DBW0",
        },
      })
    ).toThrow(SclEmulatorBuildError);
  });
});
