export type PlcAreaKind = "I" | "Q" | "M";

export type PlcValueType =
  | "BOOL"
  | "BYTE"
  | "WORD"
  | "DWORD"
  | "SINT"
  | "INT"
  | "DINT"
  | "LINT"
  | "REAL"
  | "LREAL"
  | "TIME"
  | "DATE"
  | "TOD"
  | "STRING";

export interface PlcAreaConfig {
  size: number;
}

export interface OptimizedFbInstanceDefinition {
  /** Canonical FB instance name (case preserved). */
  name: string;
  /** Declared FB type that provides the member layout. */
  type: string;
}

export interface FbTypeSchema {
  /** Canonical FB type identifier (case preserved). */
  name: string;
  /** Declarative member definitions for this FB type. */
  fields: FbFieldSchema[];
}

export type FbFieldSchema =
  | FbScalarFieldSchema
  | FbStructFieldSchema
  | FbArrayFieldSchema
  | FbInstanceFieldSchema;

export interface FbScalarFieldSchema {
  kind: "scalar";
  name: string;
  dataType: PlcValueType;
  defaultValue?: unknown;
  stringLength?: number;
}

export interface FbStructFieldSchema {
  kind: "struct";
  name: string;
  fields: FbFieldSchema[];
}

export interface FbArrayFieldSchema {
  kind: "array";
  name: string;
  length: number;
  element: FbFieldSchema;
}

export interface FbInstanceFieldSchema {
  kind: "fb";
  name: string;
  type: string;
}

export type FbTypeSchemaRegistry = Map<string, FbTypeSchema>;

export type FbTypeSchemaRegistryInput =
  | FbTypeSchemaRegistry
  | ReadonlyMap<string, FbTypeSchema>
  | Record<string, FbTypeSchema>;

export interface OptimizedDbConfiguration {
  /** Top-level FB instances to provision into the PLC state. */
  instances: OptimizedFbInstanceDefinition[];
  /** FB type schemas keyed by identifier or provided as a registry. */
  schema: FbTypeSchemaRegistryInput;
}

export interface PlcStateConfig {
  inputs?: PlcAreaConfig;
  outputs?: PlcAreaConfig;
  flags?: PlcAreaConfig;
  optimizedDataBlocks?: OptimizedDbConfiguration;
}

export enum PlcErrorCode {
  InvalidAddress = "invalid_address",
  OutOfRange = "out_of_range",
  AlignmentError = "alignment_error",
  TypeMismatch = "type_mismatch",
  InvalidConfig = "invalid_config",
  UnknownFbInstance = "unknown_fb_instance",
  UnknownSymbol = "unknown_symbol",
  InvalidSymbolPath = "invalid_symbol_path",
  UninitializedArea = "uninitialized_area",
}

export interface PlcError {
  code: PlcErrorCode;
  message: string;
  address?: string;
  details?: Record<string, unknown>;
}

export type PlcResult<T> = PlcSuccess<T> | PlcFailure;

export interface PlcSuccess<T> {
  ok: true;
  value: T;
}

export interface PlcFailure {
  ok: false;
  error: PlcError;
}

export type PlcVoidResult = PlcResult<void>;

export type PlcRegionDescriptor = PlcAreaRegionDescriptor | PlcDbRegionDescriptor;

export interface PlcAreaRegionDescriptor {
  area: PlcAreaKind;
}

export interface PlcDbRegionDescriptor {
  area: "DB";
  /** Canonical FB instance path (dot/bracket notation). */
  instancePath: string;
}

export interface PlcSnapshot {
  inputs: number[];
  outputs: number[];
  flags: number[];
  dbSymbols: Record<string, unknown>;
}

export interface PlcDiffEntry {
  offset: number;
  previous: number;
  current: number;
}

export interface PlcSymbolDiffEntry {
  path: string;
  previous: unknown;
  current: unknown;
}

export interface PlcStateDiff {
  inputs: PlcDiffEntry[];
  outputs: PlcDiffEntry[];
  flags: PlcDiffEntry[];
  dbSymbols: PlcSymbolDiffEntry[];
}

export type PlcStateChange = PlcAreaStateChange | PlcDbStateChange;

export interface PlcAreaStateChange {
  region: PlcAreaRegionDescriptor;
  diff: PlcDiffEntry[];
}

export interface PlcDbStateChange {
  region: PlcDbRegionDescriptor;
  diff: PlcSymbolDiffEntry[];
}

export type PlcStateChangeListener = (change: PlcStateChange) => void;

export type PlcAreaChangeListener = (
  diff: PlcDiffEntry[] | PlcSymbolDiffEntry[]
) => void;

export interface PlcStringReadOptions {
  /** Optional override for maximum number of characters to read (default 254). */
  maxLength?: number;
}

export interface PlcStringWriteOptions extends PlcStringReadOptions {
  /** Truncate instead of error if the string exceeds available length. */
  truncate?: boolean;
}

export interface PlcState {
  /** Read a BOOL from the specified address. */
  readBool(address: string): PlcResult<boolean>;
  /** Write a BOOL to the specified address. */
  writeBool(address: string, value: boolean): PlcVoidResult;

  /** Read an unsigned BYTE from the specified address. */
  readByte(address: string): PlcResult<number>;
  /** Write an unsigned BYTE to the specified address. */
  writeByte(address: string, value: number): PlcVoidResult;

  /** Read a signed SINT (8-bit) value from the specified address. */
  readSInt(address: string): PlcResult<number>;
  /** Write a signed SINT (8-bit) value to the specified address. */
  writeSInt(address: string, value: number): PlcVoidResult;

  /** Read an unsigned WORD (16-bit) value from the specified address. */
  readWord(address: string): PlcResult<number>;
  /** Write an unsigned WORD (16-bit) value to the specified address. */
  writeWord(address: string, value: number): PlcVoidResult;

  /** Read a signed INT (16-bit) value from the specified address. */
  readInt(address: string): PlcResult<number>;
  /** Write a signed INT (16-bit) value to the specified address. */
  writeInt(address: string, value: number): PlcVoidResult;

  /** Read an unsigned DWORD (32-bit) value from the specified address. */
  readDWord(address: string): PlcResult<number>;
  /** Write an unsigned DWORD (32-bit) value to the specified address. */
  writeDWord(address: string, value: number): PlcVoidResult;

  /** Read a signed DINT (32-bit) value from the specified address. */
  readDInt(address: string): PlcResult<number>;
  /** Write a signed DINT (32-bit) value to the specified address. */
  writeDInt(address: string, value: number): PlcVoidResult;

  /** Read a signed LINT (64-bit) value from the specified address. */
  readLint(address: string): PlcResult<bigint>;
  /** Write a signed LINT (64-bit) value to the specified address. */
  writeLint(address: string, value: bigint): PlcVoidResult;

  /** Read a REAL (32-bit IEEE754 floating-point) value from the specified address. */
  readReal(address: string): PlcResult<number>;
  /** Write a REAL (32-bit IEEE754 floating-point) value to the specified address. */
  writeReal(address: string, value: number): PlcVoidResult;

  /** Read an LREAL (64-bit IEEE754 floating-point) value from the specified address. */
  readLReal(address: string): PlcResult<number>;
  /** Write an LREAL (64-bit IEEE754 floating-point) value to the specified address. */
  writeLReal(address: string, value: number): PlcVoidResult;

  /** Read a TIME (signed 32-bit milliseconds) value from the specified address. */
  readTime(address: string): PlcResult<number>;
  /** Write a TIME (signed 32-bit milliseconds) value to the specified address. */
  writeTime(address: string, value: number): PlcVoidResult;

  /** Read a DATE (unsigned 16-bit days offset) value from the specified address. */
  readDate(address: string): PlcResult<number>;
  /** Write a DATE (unsigned 16-bit days offset) value to the specified address. */
  writeDate(address: string, value: number): PlcVoidResult;

  /** Read a TOD (unsigned 32-bit milliseconds since midnight) value from the specified address. */
  readTod(address: string): PlcResult<number>;
  /** Write a TOD (unsigned 32-bit milliseconds since midnight) value to the specified address. */
  writeTod(address: string, value: number): PlcVoidResult;

  /** Read a STRING value encoded with Siemens metadata bytes. */
  readString(address: string, options?: PlcStringReadOptions): PlcResult<string>;
  /** Write a STRING value encoded with Siemens metadata bytes. */
  writeString(address: string, value: string, options?: PlcStringWriteOptions): PlcVoidResult;

  /** Produce an immutable snapshot of the entire PLC memory state. */
  snapshot(): PlcSnapshot;

  /** Subscribe to changes across all areas. Returns an unsubscribe callback. */
  onStateChange(listener: PlcStateChangeListener): () => void;
  /** Subscribe to changes for a specific area (I, Q, M, or DB instance). Returns an unsubscribe callback. */
  onAreaChange(region: PlcRegionDescriptor, listener: PlcAreaChangeListener): () => void;
}

export interface PlcAddressDescriptor {
  region: PlcRegionDescriptor;
  byteOffset: number;
  bitOffset?: number;
}

export type PlcAddressNotation = "BIT" | "BYTE" | "WORD" | "DWORD";

export interface FbSymbolDatapoint {
  /** Canonical FB instance path including nested prefixes and array indices. */
  path: string;
  /** Original declaration-cased field name (last segment of the path). */
  fieldName: string;
  /** Canonical FB instance path for the owning instance (without the field segment). */
  fbInstancePath: string;
  /** FB type that declared the owning instance. */
  fbType: string;
  /** Resolved data type identifier. */
  dataType: PlcValueType;
  /** Declaration-cased canonical path for display. */
  declarationPath: string;
  /** Optional declared default value. */
  defaultValue?: unknown;
  /** Optional declared string length when `dataType` is `STRING`. */
  stringLength?: number;
  /** Current runtime value stored in the PLC state. */
  currentValue: unknown;
}

export function createError(
  code: PlcErrorCode,
  message: string,
  address?: string,
  details?: Record<string, unknown>
): PlcError {
  return { code, message, address, details };
}

export function ok<T>(value: T): PlcSuccess<T> {
  return { ok: true, value };
}

export function fail(error: PlcError): PlcFailure {
  return { ok: false, error };
}
