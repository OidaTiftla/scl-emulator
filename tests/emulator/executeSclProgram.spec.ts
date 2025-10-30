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

  it("executes FOR loops with explicit step increments", () => {
    const source = `
      FUNCTION_BLOCK ForLoop
      VAR
        index : INT;
        total : INT;
      END_VAR
      BEGIN
        total := 0;
        FOR index := 0 TO 4 BY 2 DO
          total := total + index;
        END_FOR;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      dataBlocks: [{ id: 1, size: 8 }],
    });

    executeSclProgram(ast, state, {
      symbols: {
        index: "DB1.DBW0",
        total: "DB1.DBW2",
      },
    });

    const indexValue = state.readInt("DB1.DBW0");
    expect(indexValue.ok && indexValue.value).toBe(6);

    const totalValue = state.readInt("DB1.DBW2");
    expect(totalValue.ok && totalValue.value).toBe(6);
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

  it("supports CASE selector ranges", () => {
    const source = `
      FUNCTION_BLOCK RangeSwitch
      VAR
        mode : INT;
      END_VAR
      BEGIN
        CASE mode OF
          0..5: QB0 := 1;
          6, 8..10: QB0 := 2;
        ELSE
          QB0 := 3;
        END_CASE;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);

    const runWithMode = (modeValue: number) => {
      const state = createPlcState({
        outputs: { size: 1 },
        dataBlocks: [{ id: 1, size: 4 }],
      });
      const writeResult = state.writeInt("DB1.DBW0", modeValue);
      expect(writeResult.ok).toBe(true);

      executeSclProgram(ast, state, {
        symbols: {
          mode: "DB1.DBW0",
        },
      });

      const output = state.readByte("QB0");
      expect(output.ok).toBe(true);
      return output.ok ? output.value : undefined;
    };

    expect(runWithMode(3)).toBe(1);
    expect(runWithMode(9)).toBe(2);
    expect(runWithMode(7)).toBe(3);
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
        flag : BOOL;
      END_VAR
      BEGIN
        REPEAT
          flag := NOT flag;
        UNTIL flag
        END_REPEAT;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      dataBlocks: [{ id: 1, size: 8 }],
    });

    expect(() =>
      executeSclProgram(ast, state, {
        symbols: {
          flag: "DB1.DBX0.0",
        },
      })
    ).toThrow(SclEmulatorBuildError);
  });
});
