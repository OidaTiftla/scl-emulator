import { describe, expect, it } from "vitest";

import {
  SclEmulatorBuildError,
  SclEmulatorRuntimeError,
  createPlcState,
  executeSclProgram,
  parseScl,
} from "../../src/index.js";
import { emulatorDbConfig } from "../fixtures/dbDefinitions/emulator.js";

const PROGRAM_ROOT = "ProgramState";
const db = (segment: string) => `${PROGRAM_ROOT}.${segment}`;

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
      optimizedDataBlocks: emulatorDbConfig,
    });

    const result = executeSclProgram(ast, state, {
      trace: true,
      symbols: {
        toggleFlag: db("toggleFlag"),
      },
    });

    const toggleValue = state.readBool(db("toggleFlag"));
    expect(toggleValue.ok).toBe(true);
    expect(toggleValue.ok && toggleValue.value).toBe(true);

    const flagValue = state.readBool("M0.0");
    expect(flagValue.ok).toBe(true);
    expect(flagValue.ok && flagValue.value).toBe(true);

    expect(result.trace).toBeDefined();
    expect(result.trace?.length).toBe(2);
    expect(result.trace?.[0]?.effects[0]?.address).toBe(db("toggleFlag"));
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
      optimizedDataBlocks: emulatorDbConfig,
    });

    const result = executeSclProgram(ast, state, {
      symbols: {
        count: db("count"),
      },
    });

    expect(result.snapshot.dbSymbols[db("count")]).toBeDefined();
    const countValue = state.readInt(db("count"));
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
      optimizedDataBlocks: emulatorDbConfig,
    });

    executeSclProgram(ast, state, {
      symbols: {
        index: db("index"),
        total: db("total"),
      },
    });

    const indexValue = state.readInt(db("index"));
    expect(indexValue.ok && indexValue.value).toBe(6);

    const totalValue = state.readInt(db("total"));
    expect(totalValue.ok && totalValue.value).toBe(6);
  });

  it("supports EXIT inside FOR loops", () => {
    const source = `
      FUNCTION_BLOCK ForExit
      VAR
        index : INT;
        total : INT;
      END_VAR
      BEGIN
        total := 0;
        FOR index := 0 TO 5 DO
          IF index >= 3 THEN
            EXIT;
          END_IF;
          total := total + index;
        END_FOR;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      optimizedDataBlocks: emulatorDbConfig,
    });

    executeSclProgram(ast, state, {
      symbols: {
        index: db("index"),
        total: db("total"),
      },
    });

    const indexValue = state.readInt(db("index"));
    expect(indexValue.ok && indexValue.value).toBe(3);

    const totalValue = state.readInt(db("total"));
    expect(totalValue.ok && totalValue.value).toBe(3);
  });

  it("supports CONTINUE inside FOR loops", () => {
    const source = `
      FUNCTION_BLOCK ForContinue
      VAR
        index : INT;
        total : INT;
      END_VAR
      BEGIN
        total := 0;
        FOR index := 0 TO 5 DO
          IF (index MOD 2) = 0 THEN
            CONTINUE;
          END_IF;
          total := total + index;
        END_FOR;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      optimizedDataBlocks: emulatorDbConfig,
    });

    executeSclProgram(ast, state, {
      symbols: {
        index: db("index"),
        total: db("total"),
      },
    });

    const indexValue = state.readInt(db("index"));
    expect(indexValue.ok && indexValue.value).toBe(6);

    const totalValue = state.readInt(db("total"));
    expect(totalValue.ok && totalValue.value).toBe(15);
  });

  it("supports CASE selectors", () => {
    const source = `
      FUNCTION_BLOCK Switch
      VAR
        mode : INT;
      END_VAR
      BEGIN
        CASE mode OF
          0: QB0 := 1;
          1: QB0 := 2;
        ELSE
          QB0 := 3;
        END_CASE;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      outputs: { size: 1 },
      optimizedDataBlocks: emulatorDbConfig,
    });

    expect(state.writeInt(db("mode"), 1).ok).toBe(true);

    executeSclProgram(ast, state, {
      symbols: {
        mode: db("mode"),
      },
    });

    const output = state.readByte("QB0");
    expect(output.ok && output.value).toBe(2);
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
        optimizedDataBlocks: emulatorDbConfig,
      });
      expect(state.writeInt(db("mode"), modeValue).ok).toBe(true);

      executeSclProgram(ast, state, {
        symbols: {
          mode: db("mode"),
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

  it("supports EXIT and CONTINUE inside WHILE loops", () => {
    const source = `
      FUNCTION_BLOCK WhileControl
      VAR
        idx : INT;
        hits : INT;
      END_VAR
      BEGIN
        WHILE idx < 10 DO
          idx := idx + 1;
          IF idx < 4 THEN
            CONTINUE;
          END_IF;
          hits := hits + 1;
          IF hits >= 2 THEN
            EXIT;
          END_IF;
        END_WHILE;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({
      optimizedDataBlocks: emulatorDbConfig,
    });

    executeSclProgram(ast, state, {
      symbols: {
        idx: db("idx"),
        hits: db("hits"),
      },
    });

    const idxValue = state.readInt(db("idx"));
    expect(idxValue.ok && idxValue.value).toBe(5);

    const hitsValue = state.readInt(db("hits"));
    expect(hitsValue.ok && hitsValue.value).toBe(2);
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
      optimizedDataBlocks: emulatorDbConfig,
    });

    expect(() =>
      executeSclProgram(ast, state, {
        symbols: {
          flag: db("flag"),
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
      optimizedDataBlocks: emulatorDbConfig,
    });

    expect(() =>
      executeSclProgram(ast, state, {
        symbols: {
          flag: db("flag"),
        },
      })
    ).toThrow(SclEmulatorBuildError);
  });

  it("throws a runtime error when EXIT is used outside a loop", () => {
    const source = `
      FUNCTION_BLOCK InvalidExit
      BEGIN
        EXIT;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const state = createPlcState({ optimizedDataBlocks: emulatorDbConfig });

    expect(() =>
      executeSclProgram(ast, state, {
        symbols: {},
      })
    ).toThrow(SclEmulatorRuntimeError);
  });
});
