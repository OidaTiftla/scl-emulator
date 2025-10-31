import { PlcStateImpl } from "./plcState.js";
import type { SymbolFilter } from "./optimizedDb.js";
import type { FbSymbolDatapoint, PlcState } from "./types.js";

export interface ListFbSymbolsOptions extends SymbolFilter {}

export function listFbInstanceSymbols(
  state: PlcState,
  filter?: ListFbSymbolsOptions
): FbSymbolDatapoint[] {
  if (state instanceof PlcStateImpl) {
    return state.listOptimizedSymbols(filter);
  }
  return [];
}
