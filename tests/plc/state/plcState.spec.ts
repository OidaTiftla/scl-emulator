import { describe, expect, it, vi } from "vitest";
import {
  PlcErrorCode,
  createPlcState,
  diffStates,
  snapshotState,
} from "../../../src/plc/state/index.js";
import type {
  PlcResult,
  PlcState,
  PlcVoidResult,
} from "../../../src/plc/state/index.js";
import { integrationDbConfig } from "../../fixtures/dbDefinitions/integration.js";

const INTEGRATION_ROOT = "IntegrationTests";
const symbol = (segment: string) => `${INTEGRATION_ROOT}.${segment}`;

describe("createPlcState", () => {
  function expectVoidOk(result: PlcVoidResult): void {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  }

  it("reads and writes BOOL values with range validation", () => {
    const plc = createPlcState({ inputs: { size: 2 } });

    const initial = plc.readBool("I0.0");
    expect(initial.ok).toBe(true);
    expect(initial.ok && initial.value).toBe(false);

    expectVoidOk(plc.writeBool("I0.0", true));

    const readBack = plc.readBool("I0.0");
    expect(readBack.ok).toBe(true);
    expect(readBack.ok && readBack.value).toBe(true);

    const invalid = plc.writeBool("I0.0", "yes" as unknown as boolean);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe(PlcErrorCode.TypeMismatch);
    }
  });

  it("supports REAL round-trips using symbolic FB paths", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });

    expectVoidOk(plc.writeReal(symbol("realValue"), 12.5));

    const read = plc.readReal(symbol("realValue"));
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toBeCloseTo(12.5, 5);
  });

  it("fails when referencing an unknown FB instance", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });
    const result = plc.readReal("MissingInstance.value");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PlcErrorCode.UnknownFbInstance);
    }
  });

  it("fails when referencing an unknown symbol", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });
    const result = plc.readReal(symbol("missingField"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PlcErrorCode.UnknownSymbol);
      expect(result.error.details).toMatchObject({ fbType: "IntegrationHarness" });
    }
  });

  it("validates alignment for multi-byte operations", () => {
    const plc = createPlcState({ outputs: { size: 8 } });
    const result = plc.writeWord("QB1", 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PlcErrorCode.TypeMismatch);
    }
  });

  it("returns range errors when accessing outside configured memory", () => {
    const plc = createPlcState({ flags: { size: 1 } });
    const result = plc.readBool("M2.0");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PlcErrorCode.OutOfRange);
    }
  });

  it("emits change events for DB symbol updates", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });
    const allListener = vi.fn();
    const dbListener = vi.fn();

    plc.onStateChange(allListener);
    plc.onAreaChange({ area: "DB", instancePath: INTEGRATION_ROOT }, dbListener);

    expectVoidOk(plc.writeDInt(symbol("dintValue"), 99));

    expect(allListener).toHaveBeenCalledTimes(1);
    expect(dbListener).toHaveBeenCalledTimes(1);

    const change = allListener.mock.calls[0][0];
    expect(change.region).toEqual({ area: "DB", instancePath: INTEGRATION_ROOT });
    expect(change.diff).toEqual([
      { path: symbol("dintValue"), previous: 0, current: 99 },
    ]);
  });

  it("handles STRING payloads for symbolic DB fields", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });

    expectVoidOk(plc.writeString(symbol("stringValue"), "HELLO", { maxLength: 16 }));

    const read = plc.readString(symbol("stringValue"));
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toBe("HELLO");

    const tooLarge = plc.writeString(symbol("stringValue"), "THIS STRING IS TOO LONG", {
      maxLength: 8,
    });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect(tooLarge.error.code).toBe(PlcErrorCode.OutOfRange);
    }
  });

  describe("scalar type round-trips", () => {
    const plcFactory = () => createPlcState({ optimizedDataBlocks: integrationDbConfig });

    const cases: Array<{ name: string; write: (plc: PlcState) => PlcVoidResult; read: (plc: PlcState) => PlcResult<unknown>; assert: (value: unknown) => void; }> = [
      {
        name: "BOOL",
        write: (plc) => plc.writeBool(symbol("boolValue"), true),
        read: (plc) => plc.readBool(symbol("boolValue")),
        assert: (value) => expect(value).toBe(true),
      },
      {
        name: "BYTE",
        write: (plc) => plc.writeByte(symbol("byteValue"), 0xab),
        read: (plc) => plc.readByte(symbol("byteValue")),
        assert: (value) => expect(value).toBe(0xab),
      },
      {
        name: "SINT",
        write: (plc) => plc.writeSInt(symbol("sintValue"), -42),
        read: (plc) => plc.readSInt(symbol("sintValue")),
        assert: (value) => expect(value).toBe(-42),
      },
      {
        name: "WORD",
        write: (plc) => plc.writeWord(symbol("wordValue"), 0x1234),
        read: (plc) => plc.readWord(symbol("wordValue")),
        assert: (value) => expect(value).toBe(0x1234),
      },
      {
        name: "INT",
        write: (plc) => plc.writeInt(symbol("intValue"), -1234),
        read: (plc) => plc.readInt(symbol("intValue")),
        assert: (value) => expect(value).toBe(-1234),
      },
      {
        name: "DWORD",
        write: (plc) => plc.writeDWord(symbol("dwordValue"), 0x89abcdef),
        read: (plc) => plc.readDWord(symbol("dwordValue")),
        assert: (value) => expect(value).toBe(0x89abcdef),
      },
      {
        name: "DINT",
        write: (plc) => plc.writeDInt(symbol("dintValue"), -20202020),
        read: (plc) => plc.readDInt(symbol("dintValue")),
        assert: (value) => expect(value).toBe(-20202020),
      },
      {
        name: "LINT",
        write: (plc) => plc.writeLint(symbol("lintValue"), 1234567890123456n),
        read: (plc) => plc.readLint(symbol("lintValue")),
        assert: (value) => expect(value).toBe(1234567890123456n),
      },
      {
        name: "REAL",
        write: (plc) => plc.writeReal(symbol("realValue"), 42.25),
        read: (plc) => plc.readReal(symbol("realValue")),
        assert: (value) => expect(value as number).toBeCloseTo(42.25, 5),
      },
      {
        name: "LREAL",
        write: (plc) => plc.writeLReal(symbol("lrealValue"), 3.141592653589793),
        read: (plc) => plc.readLReal(symbol("lrealValue")),
        assert: (value) => expect(value as number).toBeCloseTo(3.141592653589793, 9),
      },
      {
        name: "TIME",
        write: (plc) => plc.writeTime(symbol("timeValue"), 123456),
        read: (plc) => plc.readTime(symbol("timeValue")),
        assert: (value) => expect(value).toBe(123456),
      },
      {
        name: "DATE",
        write: (plc) => plc.writeDate(symbol("dateValue"), 7300),
        read: (plc) => plc.readDate(symbol("dateValue")),
        assert: (value) => expect(value).toBe(7300),
      },
      {
        name: "TOD",
        write: (plc) => plc.writeTod(symbol("todValue"), 86_400),
        read: (plc) => plc.readTod(symbol("todValue")),
        assert: (value) => expect(value).toBe(86_400),
      },
    ];

    for (const testCase of cases) {
      it(`round-trips ${testCase.name}`, () => {
        const plc = plcFactory();
        expectVoidOk(testCase.write(plc));
        const result = testCase.read(plc);
        expect(result.ok).toBe(true);
        if (result.ok) {
          testCase.assert(result.value);
        }
      });
    }
  });

  it("captures diffs for optimized DB symbols", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });

    const before = snapshotState(plc);
    expectVoidOk(plc.writeInt(symbol("intValue"), 7));
    const after = snapshotState(plc);

    const diff = diffStates(before, after);
    expect(diff.dbSymbols).toEqual([
      { path: symbol("intValue"), previous: 0, current: 7 },
    ]);
  });
});
