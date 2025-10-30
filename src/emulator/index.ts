import type { SclAst } from "../parser/astTypes.js";
import type { PlcState } from "../plc/state/index.js";
import { buildIrProgram } from "./ir/builder.js";
import type {
  ExecutionOptions,
  ExecutionResult,
} from "./interpreter.js";
import { executeProgram } from "./interpreter.js";

export type {
  ExecutionOptions,
  ExecutionResult,
  ExecutionEffect,
  ExecutionTraceEntry,
} from "./interpreter.js";
export { SclEmulatorBuildError, SclEmulatorRuntimeError } from "./errors.js";
export type { SclDataType } from "./ir/types.js";

export function executeSclProgram(
  ast: SclAst,
  state: PlcState,
  options: ExecutionOptions = {}
): ExecutionResult {
  const program = buildIrProgram(ast);
  return executeProgram(program, state, options);
}
