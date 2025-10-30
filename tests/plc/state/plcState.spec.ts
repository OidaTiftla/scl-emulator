import { describe, expect, it, vi } from "vitest";
import {
  PlcErrorCode,
  createPlcState,
  diffStates,
  snapshotState,
} from "../../../src/plc/state/index.js";

describe("createPlcState", () => {
  it("reads and writes BOOL values with range validation", () => {
    const plc = createPlcState({ inputs: { size: 2 } });

    const initial = plc.readBool("I0.0");
    expect(initial.ok).toBe(true);
    expect(initial.ok && initial.value).toBe(false);

    const writeResult = plc.writeBool("I0.0", true);
    expect(writeResult.ok).toBe(true);

    const readBack = plc.readBool("I0.0");
    expect(readBack.ok).toBe(true);
    expect(readBack.ok && readBack.value).toBe(true);

    const invalid = plc.writeBool("I0.0", "yes" as unknown as boolean);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe(PlcErrorCode.TypeMismatch);
    }
  });

  it("supports REAL round-trips in data blocks using DBX addressing", () => {
    const plc = createPlcState({ dataBlocks: [{ id: 1, size: 16 }] });
    const write = plc.writeReal("DB1.DBX0.0", 12.5);
    expect(write.ok).toBe(true);

    const read = plc.readReal("DB1.DBX0.0");
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toBeCloseTo(12.5, 5);
  });

  it("fails when addressing an unknown data block", () => {
    const plc = createPlcState({ dataBlocks: [{ id: 1, size: 4 }] });
    const result = plc.readReal("DB2.DBD0");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PlcErrorCode.UnknownDataBlock);
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

  it("emits change events for state and area subscriptions", () => {
    const plc = createPlcState({ inputs: { size: 1 } });
    const allListener = vi.fn();
    const areaListener = vi.fn();

    plc.onStateChange(allListener);
    plc.onAreaChange({ area: "I" }, areaListener);

    plc.writeBool("I0.0", true);

    expect(allListener).toHaveBeenCalledTimes(1);
    expect(areaListener).toHaveBeenCalledTimes(1);

    const change = allListener.mock.calls[0][0];
    expect(change.region).toEqual({ area: "I" });
    expect(change.diff).toEqual([
      { offset: 0, previous: 0, current: 1 },
    ]);
  });

  it("returns STRING payloads with Siemens metadata", () => {
    const plc = createPlcState({ dataBlocks: [{ id: 7, size: 64 }] });

    const write = plc.writeString("DB7.DBB0", "HELLO", { maxLength: 16 });
    expect(write.ok).toBe(true);

    const read = plc.readString("DB7.DBB0");
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toBe("HELLO");

    const tooLarge = plc.writeString("DB7.DBB0", "THIS STRING IS TOO LONG", {
      maxLength: 8,
    });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect(tooLarge.error.code).toBe(PlcErrorCode.OutOfRange);
    }
  });

  it("captures and diffs snapshots", () => {
    const plc = createPlcState({ inputs: { size: 1 }, dataBlocks: [{ id: 1, size: 8 }] });

    const before = snapshotState(plc);
    plc.writeBool("I0.0", true);
    plc.writeDInt("DB1.DBD0", 1234);
    const after = snapshotState(plc);

    const diff = diffStates(before, after);
    expect(diff.inputs).toEqual([{ offset: 0, previous: 0, current: 1 }]);
    expect(diff.dataBlocks[1]).toEqual([
      { offset: 0, previous: 0, current: 210 },
      { offset: 1, previous: 0, current: 4 },
    ]);
  });

  it("keeps bit and word views in sync for marker area", () => {
    const plc = createPlcState({ flags: { size: 4 } });

    const bitWrite = plc.writeBool("M0.1", true);
    expect(bitWrite.ok).toBe(true);

    const wordRead = plc.readWord("MW0");
    expect(wordRead.ok).toBe(true);
    expect(wordRead.ok && wordRead.value).toBe(2);

    const wordWrite = plc.writeWord("MW0", 5);
    expect(wordWrite.ok).toBe(true);

    const bitRead = plc.readBool("M0.0");
    expect(bitRead.ok).toBe(true);
    expect(bitRead.ok && bitRead.value).toBe(true);

    const bitReadTwo = plc.readBool("M0.2");
    expect(bitReadTwo.ok).toBe(true);
    expect(bitReadTwo.ok && bitReadTwo.value).toBe(true);
  });

  it("keeps bit and word views in sync for data blocks", () => {
    const plc = createPlcState({ dataBlocks: [{ id: 3, size: 16 }] });

    expect(plc.writeBool("DB3.DBX0.3", true).ok).toBe(true);

    const word = plc.readWord("DB3.DBW0");
    expect(word.ok).toBe(true);
    expect(word.ok && word.value).toBe(8);

    expect(plc.writeWord("DB3.DBW0", 0).ok).toBe(true);
    const bit = plc.readBool("DB3.DBX0.3");
    expect(bit.ok).toBe(true);
    expect(bit.ok && bit.value).toBe(false);
  });
});
