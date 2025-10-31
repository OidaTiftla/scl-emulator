import type {
  PlcAreaChangeListener,
  PlcRegionDescriptor,
  PlcSnapshot,
  PlcState,
  PlcStateChange,
  PlcStateChangeListener,
  PlcResult,
  PlcStringReadOptions,
  PlcStringWriteOptions,
  PlcVoidResult,
} from "../plc/state/index.js";
import {
  PlcErrorCode,
  createError,
  fail,
  ok,
  type PlcDbRegionDescriptor,
  type PlcSymbolDiffEntry,
} from "../plc/state/types.js";
import type { SclDataType } from "../emulator/ir/types.js";

interface StandaloneBinding {
  readonly name: string;
  readonly address: string;
  readonly dataType: SclDataType;
  readonly stringLength?: number;
  value: unknown;
}

function defaultValueFor(dataType: SclDataType): unknown {
  switch (dataType) {
    case "BOOL":
      return false;
    case "BYTE":
    case "WORD":
    case "DWORD":
    case "SINT":
    case "INT":
    case "DINT":
    case "REAL":
    case "LREAL":
    case "TIME":
    case "DATE":
    case "TOD":
      return 0;
    case "LINT":
      return 0n;
    case "STRING":
      return "";
    default:
      return 0;
  }
}

function regionKey(region: PlcRegionDescriptor): string {
  if (region.area === "DB") {
    return `DB:${region.instancePath.toLowerCase()}`;
  }
  return region.area;
}

const STANDALONE_REGION: PlcDbRegionDescriptor = {
  area: "DB",
  instancePath: "__Standalone",
};

/**
 * PlcState implementation for standalone SCL execution backed by an in-memory map.
 */
export class StandaloneMemory implements PlcState {
  private readonly bindings = new Map<string, StandaloneBinding>();

  private readonly stateListeners = new Set<PlcStateChangeListener>();

  private readonly areaListeners = new Map<string, Set<PlcAreaChangeListener>>();

  private nextAddressId = 0;

  bindVariable(
    name: string,
    dataType: SclDataType,
    stringLength?: number
  ): string {
    const address = this.allocateAddress();
    if (!this.bindings.has(address)) {
      this.bindings.set(address, {
        name,
        address,
        dataType,
        stringLength,
        value: defaultValueFor(dataType),
      });
    }
    return address;
  }

  private allocateAddress(): string {
    const address = `M${this.nextAddressId}`;
    this.nextAddressId += 1;
    return address;
  }

  getVariables(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const binding of this.bindings.values()) {
      result[binding.name] = binding.value;
    }
    return result;
  }

  readBool(address: string): PlcResult<boolean> {
    return this.readTyped(address, "BOOL");
  }

  writeBool(address: string, value: boolean): PlcVoidResult {
    return this.writeTyped(address, "BOOL", value);
  }

  readByte(address: string): PlcResult<number> {
    return this.readTyped(address, "BYTE");
  }

  writeByte(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "BYTE", value);
  }

  readSInt(address: string): PlcResult<number> {
    return this.readTyped(address, "SINT");
  }

  writeSInt(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "SINT", value);
  }

  readWord(address: string): PlcResult<number> {
    return this.readTyped(address, "WORD");
  }

  writeWord(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "WORD", value);
  }

  readInt(address: string): PlcResult<number> {
    return this.readTyped(address, "INT");
  }

  writeInt(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "INT", value);
  }

  readDWord(address: string): PlcResult<number> {
    return this.readTyped(address, "DWORD");
  }

  writeDWord(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "DWORD", value);
  }

  readDInt(address: string): PlcResult<number> {
    return this.readTyped(address, "DINT");
  }

  writeDInt(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "DINT", value);
  }

  readLint(address: string): PlcResult<bigint> {
    return this.readTyped(address, "LINT");
  }

  writeLint(address: string, value: bigint): PlcVoidResult {
    return this.writeTyped(address, "LINT", value);
  }

  readReal(address: string): PlcResult<number> {
    return this.readTyped(address, "REAL");
  }

  writeReal(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "REAL", value);
  }

  readLReal(address: string): PlcResult<number> {
    return this.readTyped(address, "LREAL");
  }

  writeLReal(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "LREAL", value);
  }

  readTime(address: string): PlcResult<number> {
    return this.readTyped(address, "TIME");
  }

  writeTime(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "TIME", value);
  }

  readDate(address: string): PlcResult<number> {
    return this.readTyped(address, "DATE");
  }

  writeDate(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "DATE", value);
  }

  readTod(address: string): PlcResult<number> {
    return this.readTyped(address, "TOD");
  }

  writeTod(address: string, value: number): PlcVoidResult {
    return this.writeTyped(address, "TOD", value);
  }

  readString(address: string, _options?: PlcStringReadOptions): PlcResult<string> {
    return this.readTyped(address, "STRING");
  }

  writeString(address: string, value: string, options?: PlcStringWriteOptions): PlcVoidResult {
    const bindingResult = this.requireBinding(address, "STRING");
    if (!bindingResult.ok) {
      return bindingResult;
    }
    const binding = bindingResult.value;
    const limit = binding.stringLength ?? options?.maxLength;
    const normalized = limit !== undefined ? value.slice(0, limit) : value;
    return this.commitWrite(binding, normalized);
  }

  snapshot(): PlcSnapshot {
    const dbSymbols: Record<string, unknown> = {};
    for (const binding of this.bindings.values()) {
      dbSymbols[binding.address] = binding.value;
    }
    return {
      inputs: [],
      outputs: [],
      flags: [],
      dbSymbols,
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
    let listeners = this.areaListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.areaListeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      const scoped = this.areaListeners.get(key);
      scoped?.delete(listener);
      if (scoped && scoped.size === 0) {
        this.areaListeners.delete(key);
      }
    };
  }

  private readTyped<T>(address: string, dataType: SclDataType): PlcResult<T> {
    const bindingResult = this.requireBinding(address, dataType);
    if (!bindingResult.ok) {
      return fail(bindingResult.error);
    }
    const binding = bindingResult.value;
    return ok(binding.value as T);
  }

  private writeTyped(address: string, dataType: SclDataType, value: unknown): PlcVoidResult {
    const bindingResult = this.requireBinding(address, dataType);
    if (!bindingResult.ok) {
      return fail(bindingResult.error);
    }
    const binding = bindingResult.value;
    return this.commitWrite(binding, value);
  }

  private requireBinding(
    address: string,
    dataType: SclDataType
  ): PlcResult<StandaloneBinding> {
    const binding = this.bindings.get(address);
    if (!binding) {
      return fail(
        createError(
          PlcErrorCode.InvalidAddress,
          `Address "${address}" is not managed by the standalone runner`,
          address
        )
      );
    }
    if (binding.dataType !== dataType) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          `Expected ${binding.dataType} but received ${dataType}`,
          address
        )
      );
    }
    return ok(binding);
  }

  private commitWrite(binding: StandaloneBinding, value: unknown): PlcVoidResult {
    const previous = binding.value;
    binding.value = value;
    this.dispatchChange(binding, previous, value);
    return ok(undefined);
  }

  private dispatchChange(binding: StandaloneBinding, previous: unknown, current: unknown): void {
    if (Object.is(previous, current)) {
      return;
    }
    const diff: PlcSymbolDiffEntry[] = [
      {
        path: binding.address,
        previous,
        current,
      },
    ];
    const change: PlcStateChange = {
      region: STANDALONE_REGION,
      diff,
    };
    for (const listener of this.stateListeners) {
      listener(change);
    }
    const key = regionKey(STANDALONE_REGION);
    const scoped = this.areaListeners.get(key);
    if (scoped) {
      for (const listener of scoped) {
        listener(diff);
      }
    }
  }
}
