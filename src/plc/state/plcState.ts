import { parseBitAddress, parseByteAddress, inspectAddress } from "./address.js";
import type { ParsedAddress } from "./address.js";
import { DbArea } from "./areas/dbArea.js";
import { WordArea } from "./areas/wordArea.js";
import {
  PlcErrorCode,
  createError,
  fail,
  ok,
} from "./types.js";
import type {
  PlcAreaChangeListener,
  PlcDiffEntry,
  PlcRegionDescriptor,
  PlcResult,
  PlcSnapshot,
  PlcState,
  PlcStateChange,
  PlcStateChangeListener,
  PlcStateConfig,
  PlcStateDiff,
  PlcStringReadOptions,
  PlcStringWriteOptions,
  PlcVoidResult,
} from "./types.js";

function regionKey(region: PlcRegionDescriptor): string {
  return region.area === "DB" ? `DB:${region.dbNumber}` : region.area;
}

function computeDiffEntries(
  baseOffset: number,
  before: Uint8Array,
  after: Uint8Array
): PlcDiffEntry[] {
  const result: PlcDiffEntry[] = [];
  const max = Math.max(before.length, after.length);
  for (let index = 0; index < max; index += 1) {
    const previous = before[index] ?? 0;
    const current = after[index] ?? 0;
    if (previous !== current) {
      result.push({ offset: baseOffset + index, previous, current });
    }
  }
  return result;
}

function isPlcResult<T>(value: unknown): value is PlcResult<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

export class PlcStateImpl implements PlcState {
  private readonly inputs?: WordArea;

  private readonly outputs?: WordArea;

  private readonly flags?: WordArea;

  private readonly dataBlocks: DbArea;

  private readonly stateListeners = new Set<PlcStateChangeListener>();

  private readonly areaListeners = new Map<string, Set<PlcAreaChangeListener>>();

  constructor(config: PlcStateConfig) {
    this.inputs = config.inputs
      ? new WordArea(config.inputs.size, "Inputs (I)")
      : undefined;
    this.outputs = config.outputs
      ? new WordArea(config.outputs.size, "Outputs (Q)")
      : undefined;
    this.flags = config.flags
      ? new WordArea(config.flags.size, "Flags (M)")
      : undefined;
    this.dataBlocks = new DbArea(config.dataBlocks ?? []);
  }

  readBool(address: string) {
    return this.readWith(address, () => parseBitAddress(address), (area, descriptor) =>
      area.readBit(descriptor.byteOffset, descriptor.bitOffset ?? 0)
    );
  }

  writeBool(address: string, value: boolean) {
    if (typeof value !== "boolean") {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "BOOL write requires a boolean value",
          address,
          { value }
        )
      );
    }
    return this.writeBoolInternal(address, value, true);
  }

  readByte(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 1 }), (area, descriptor) =>
      area.readUInt8(descriptor.byteOffset)
    );
  }

  writeByte(address: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "BYTE values must be integers between 0 and 255",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 1, undefined, (area, descriptor) => {
      area.writeUInt8(descriptor.byteOffset, value);
    });
  }

  readSInt(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 1 }), (area, descriptor) =>
      area.readInt8(descriptor.byteOffset)
    );
  }

  writeSInt(address: string, value: number) {
    if (!Number.isInteger(value) || value < -128 || value > 127) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "SINT values must be integers between -128 and 127",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 1, undefined, (area, descriptor) => {
      area.writeInt8(descriptor.byteOffset, value);
    });
  }

  readWord(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 2, alignment: 2 }), (area, descriptor) =>
      area.readUInt16(descriptor.byteOffset)
    );
  }

  writeWord(address: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "WORD values must be integers between 0 and 65535",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 2, 2, (area, descriptor) => {
      area.writeUInt16(descriptor.byteOffset, value);
    });
  }

  readInt(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 2, alignment: 2 }), (area, descriptor) =>
      area.readInt16(descriptor.byteOffset)
    );
  }

  writeInt(address: string, value: number) {
    if (!Number.isInteger(value) || value < -32768 || value > 32767) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "INT values must be integers between -32768 and 32767",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 2, 2, (area, descriptor) => {
      area.writeInt16(descriptor.byteOffset, value);
    });
  }

  readDWord(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 4, alignment: 4 }), (area, descriptor) =>
      area.readUInt32(descriptor.byteOffset)
    );
  }

  writeDWord(address: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "DWORD values must be integers between 0 and 4294967295",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 4, 4, (area, descriptor) => {
      area.writeUInt32(descriptor.byteOffset, value);
    });
  }

  readDInt(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 4, alignment: 4 }), (area, descriptor) =>
      area.readInt32(descriptor.byteOffset)
    );
  }

  writeDInt(address: string, value: number) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "DINT values must be integers between -2147483648 and 2147483647",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 4, 4, (area, descriptor) => {
      area.writeInt32(descriptor.byteOffset, value);
    });
  }

  readLint(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 8, alignment: 8 }), (area, descriptor) =>
      area.readBigInt64(descriptor.byteOffset)
    );
  }

  writeLint(address: string, value: bigint) {
    if (typeof value !== "bigint") {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "LINT values must be provided as bigint",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 8, 8, (area, descriptor) => {
      area.writeBigInt64(descriptor.byteOffset, value);
    });
  }

  readReal(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 4, alignment: 4 }), (area, descriptor) =>
      area.readFloat32(descriptor.byteOffset)
    );
  }

  writeReal(address: string, value: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "REAL values must be finite numbers",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 4, 4, (area, descriptor) => {
      area.writeFloat32(descriptor.byteOffset, value);
    });
  }

  readLReal(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 8, alignment: 8 }), (area, descriptor) =>
      area.readFloat64(descriptor.byteOffset)
    );
  }

  writeLReal(address: string, value: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "LREAL values must be finite numbers",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 8, 8, (area, descriptor) => {
      area.writeFloat64(descriptor.byteOffset, value);
    });
  }

  readTime(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 4, alignment: 4 }), (area, descriptor) =>
      area.readInt32(descriptor.byteOffset)
    );
  }

  writeTime(address: string, value: number) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "TIME values must fit in a signed 32-bit integer (milliseconds)",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 4, 4, (area, descriptor) => {
      area.writeInt32(descriptor.byteOffset, value);
    });
  }

  readDate(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 2, alignment: 2 }), (area, descriptor) =>
      area.readUInt16(descriptor.byteOffset)
    );
  }

  writeDate(address: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "DATE values must be integers between 0 and 65535",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 2, 2, (area, descriptor) => {
      area.writeUInt16(descriptor.byteOffset, value);
    });
  }

  readTod(address: string) {
    return this.readWith(address, () => parseByteAddress(address, { byteLength: 4, alignment: 4 }), (area, descriptor) =>
      area.readUInt32(descriptor.byteOffset)
    );
  }

  writeTod(address: string, value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "TOD values must be integers between 0 and 4294967295",
          address,
          { value }
        )
      );
    }
    return this.writeNumeric(address, 4, 4, (area, descriptor) => {
      area.writeUInt32(descriptor.byteOffset, value);
    });
  }

  readString(address: string, options?: PlcStringReadOptions) {
    const descriptorResult = inspectAddress(address);
    if (!descriptorResult.ok) {
      return descriptorResult;
    }
    const descriptor = descriptorResult.value;
    if (descriptor.bitOffset !== undefined && descriptor.bitOffset !== 0) {
      return fail(
        createError(
          PlcErrorCode.AlignmentError,
          "STRING address must reference the first bit of a byte (bit offset 0)",
          address,
          { bitOffset: descriptor.bitOffset }
        )
      );
    }
    const areaResult = this.resolveArea(descriptor.region);
    if (!areaResult.ok) {
      return areaResult;
    }
    const area = areaResult.value;
    const offset = descriptor.byteOffset;
    const available = area.byteLength - offset;
    if (available < 2) {
      return fail(
        createError(
          PlcErrorCode.OutOfRange,
          "Not enough space to read STRING metadata",
          address,
          { available }
        )
      );
    }

    try {
      const header = area.readBytes(offset, 2);
      const definedMax = header[0];
      const declaredLength = header[1];
      const allowedMax = Math.min(options?.maxLength ?? 254, 254);
      const maxLength = Math.min(definedMax || allowedMax, allowedMax, Math.max(available - 2, 0));
      if (declaredLength > maxLength) {
        return fail(
          createError(
            PlcErrorCode.OutOfRange,
            "Declared STRING length exceeds configured maximum",
            address,
            { declaredLength, maxLength }
          )
        );
      }
      const payload = area.readBytes(offset + 2, declaredLength);
      const decoder = new TextDecoder();
      return ok(decoder.decode(payload));
    } catch (error) {
      return this.handleRangeError(address, error);
    }
  }

  writeString(address: string, value: string, options?: PlcStringWriteOptions) {
    if (typeof value !== "string") {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          "STRING writes require a string value",
          address,
          { value }
        )
      );
    }
    return this.writeStringInternal(address, value, options, true);
  }

  snapshot(): PlcSnapshot {
    return {
      inputs: this.inputs?.snapshot() ?? [],
      outputs: this.outputs?.snapshot() ?? [],
      flags: this.flags?.snapshot() ?? [],
      dataBlocks: this.dataBlocks.snapshot(),
    };
  }

  onStateChange(listener: PlcStateChangeListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onAreaChange(region: PlcRegionDescriptor, listener: PlcAreaChangeListener): () => void {
    const key = regionKey(region);
    const listeners = this.areaListeners.get(key) ?? new Set<PlcAreaChangeListener>();
    if (!this.areaListeners.has(key)) {
      this.areaListeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.areaListeners.delete(key);
      }
    };
  }

  private readWith<T>(
    address: string,
    parser: () => PlcResult<ParsedAddress>,
    reader: (area: WordArea, descriptor: ParsedAddress) => T
  ): PlcResult<T> {
    const descriptorResult = parser();
    if (!descriptorResult.ok) {
      return descriptorResult;
    }
    const descriptor = descriptorResult.value;
    const areaResult = this.resolveArea(descriptor.region);
    if (!areaResult.ok) {
      return areaResult;
    }
    const area = areaResult.value;
    try {
      const value = reader(area, descriptor);
      return ok(value);
    } catch (error) {
      return this.handleRangeError(address, error);
    }
  }

  private writeBoolInternal(address: string, value: boolean, notify: boolean): PlcVoidResult {
    return this.writeWith(
      address,
      () => parseBitAddress(address),
      1,
      (area, descriptor) => {
        area.writeBit(descriptor.byteOffset, descriptor.bitOffset ?? 0, value);
      },
      notify
    );
  }

  private writeNumeric(
    address: string,
    byteLength: number,
    alignment: number | undefined,
    mutator: (area: WordArea, descriptor: ParsedAddress) => void
  ): PlcVoidResult {
    return this.writeWith(
      address,
      () => parseByteAddress(address, { byteLength, alignment }),
      byteLength,
      mutator,
      true
    );
  }

  private writeWith(
    address: string,
    parser: () => PlcResult<ParsedAddress>,
    byteLength: number,
    mutator: (area: WordArea, descriptor: ParsedAddress) => PlcVoidResult | void,
    notify: boolean
  ): PlcVoidResult {
    const descriptorResult = parser();
    if (!descriptorResult.ok) {
      return descriptorResult;
    }
    const descriptor = descriptorResult.value;
    const areaResult = this.resolveArea(descriptor.region);
    if (!areaResult.ok) {
      return areaResult;
    }
    const area = areaResult.value;
    try {
      const before = area.readBytes(descriptor.byteOffset, byteLength);
      const outcome = mutator(area, descriptor);
      if (isPlcResult<void>(outcome) && !outcome.ok) {
        return outcome;
      }
      const after = area.readBytes(descriptor.byteOffset, byteLength);
      const diff = computeDiffEntries(descriptor.byteOffset, before, after);
      if (notify && diff.length > 0) {
        this.dispatchChange(descriptor.region, diff);
      }
      return ok(undefined);
    } catch (error) {
      return this.handleRangeError(address, error);
    }
  }

  private writeStringInternal(
    address: string,
    value: string,
    options: PlcStringWriteOptions | undefined,
    notify: boolean
  ): PlcVoidResult {
    const descriptorResult = inspectAddress(address);
    if (!descriptorResult.ok) {
      return descriptorResult;
    }
    const descriptor = descriptorResult.value;
    if (descriptor.bitOffset !== undefined && descriptor.bitOffset !== 0) {
      return fail(
        createError(
          PlcErrorCode.AlignmentError,
          "STRING address must reference the first bit of a byte (bit offset 0)",
          address,
          { bitOffset: descriptor.bitOffset }
        )
      );
    }
    const areaResult = this.resolveArea(descriptor.region);
    if (!areaResult.ok) {
      return areaResult;
    }
    const area = areaResult.value;
    const offset = descriptor.byteOffset;
    const available = area.byteLength - offset;
    if (available < 2) {
      return fail(
        createError(
          PlcErrorCode.OutOfRange,
          "Not enough space to write STRING metadata",
          address,
          { available }
        )
      );
    }

    const maxAllowed = Math.min(options?.maxLength ?? 254, 254);
    const payloadBudget = Math.max(Math.min(available - 2, maxAllowed), 0);
    const before = area.readBytes(offset, 2 + payloadBudget);
    const declaredMax = before[0] || payloadBudget;
    const effectiveMax = Math.min(declaredMax || payloadBudget, payloadBudget);

    const encoder = new TextEncoder();
    const encoded = encoder.encode(value);
    let writeLength = encoded.length;
    if (writeLength > effectiveMax) {
      if (options?.truncate) {
        writeLength = effectiveMax;
      } else {
        return fail(
          createError(
            PlcErrorCode.OutOfRange,
            "STRING value exceeds available capacity",
            address,
            { valueLength: encoded.length, capacity: effectiveMax }
          )
        );
      }
    }

    const after = before.slice();
    const maxLengthByte = effectiveMax;
    after[0] = maxLengthByte;
    after[1] = writeLength;
    after.fill(0, 2);
    after.set(encoded.subarray(0, writeLength), 2);

    area.writeBytes(offset, after);

    const diff = computeDiffEntries(offset, before, after);
    if (notify && diff.length > 0) {
      this.dispatchChange(descriptor.region, diff);
    }

    return ok(undefined);
  }

  private resolveArea(region: PlcRegionDescriptor): PlcResult<WordArea> {
    if (region.area === "DB") {
      const block = this.dataBlocks.getBlock(region.dbNumber);
      if (!block) {
        return fail(
          createError(
            PlcErrorCode.UnknownDataBlock,
            `Data block DB${region.dbNumber} is not configured`,
            undefined,
            { dbNumber: region.dbNumber }
          )
        );
      }
      return ok(block);
    }

    switch (region.area) {
      case "I":
        if (!this.inputs) {
          return fail(
            createError(
              PlcErrorCode.UninitializedArea,
              "Input area (I) is not configured"
            )
          );
        }
        return ok(this.inputs);
      case "Q":
        if (!this.outputs) {
          return fail(
            createError(
              PlcErrorCode.UninitializedArea,
              "Output area (Q) is not configured"
            )
          );
        }
        return ok(this.outputs);
      case "M":
        if (!this.flags) {
          return fail(
            createError(
              PlcErrorCode.UninitializedArea,
              "Flag area (M) is not configured"
            )
          );
        }
        return ok(this.flags);
      default:
        return fail(
          createError(PlcErrorCode.InvalidAddress, "Unsupported memory area")
        );
    }
  }

  private handleRangeError(address: string, error: unknown): PlcResult<never> {
    if (error instanceof RangeError) {
      return fail(createError(PlcErrorCode.OutOfRange, error.message, address));
    }
    throw error;
  }

  private dispatchChange(region: PlcRegionDescriptor, diff: PlcDiffEntry[]): void {
    const payload: PlcStateChange = { region, diff };
    for (const listener of this.stateListeners) {
      listener(payload);
    }
    const scoped = this.areaListeners.get(regionKey(region));
    if (scoped) {
      for (const listener of scoped) {
        listener(diff);
      }
    }
  }
}

/**
 * Create a new PLC memory state using the provided area configuration.
 * The returned object exposes typed accessors and subscription utilities.
 */
export function createPlcState(config: PlcStateConfig): PlcState {
  return new PlcStateImpl(config);
}

/**
 * Capture a JSON-serializable snapshot of the given PLC state.
 */
export function snapshotState(state: PlcState): PlcSnapshot {
  return state.snapshot();
}

/**
 * Compute a byte-level diff between two PLC snapshots, grouped by area.
 */
export function diffStates(previous: PlcSnapshot, next: PlcSnapshot): PlcStateDiff {
  const inputs = computeDiffEntries(0, Uint8Array.from(previous.inputs), Uint8Array.from(next.inputs));
  const outputs = computeDiffEntries(0, Uint8Array.from(previous.outputs), Uint8Array.from(next.outputs));
  const flags = computeDiffEntries(0, Uint8Array.from(previous.flags), Uint8Array.from(next.flags));

  const blockDiffs: Record<number, PlcDiffEntry[]> = {};
  const blockIds = new Set<number>([...Object.keys(previous.dataBlocks).map(Number), ...Object.keys(next.dataBlocks).map(Number)]);
  for (const blockId of blockIds) {
    const before = Uint8Array.from(previous.dataBlocks[blockId] ?? []);
    const after = Uint8Array.from(next.dataBlocks[blockId] ?? []);
    const diff = computeDiffEntries(0, before, after);
    if (diff.length > 0) {
      blockDiffs[blockId] = diff;
    }
  }

  return { inputs, outputs, flags, dataBlocks: blockDiffs };
}
