export { createPlcState, snapshotState, diffStates, resolveOptimizedDbSymbol } from "./plcState.js";
export { listFbInstanceSymbols } from "./datapoints.js";
export {
  PlcErrorCode,
} from "./types.js";
export type {
  PlcState,
  PlcStateConfig,
  PlcResult,
  PlcVoidResult,
  PlcSnapshot,
  PlcStateDiff,
  PlcDiffEntry,
  PlcError,
  PlcRegionDescriptor,
  PlcStateChange,
  PlcStateChangeListener,
  PlcAreaChangeListener,
  PlcStringReadOptions,
  PlcStringWriteOptions,
} from "./types.js";
