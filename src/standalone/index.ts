import type { ExecutionTraceEntry } from "../emulator/interpreter.js";
import { executeProgram } from "../emulator/interpreter.js";
import type { IrVariable } from "../emulator/ir/types.js";
import type { SclStandaloneProgram } from "./program.js";
import { prepareStandaloneProgram } from "./program.js";
import { StandaloneMemory } from "./memory.js";

export interface StandaloneOptions {
  readonly trace?: boolean;
  readonly maxLoopIterations?: number;
}

export interface StandaloneResult {
  readonly variables: Record<string, unknown>;
  readonly trace?: ExecutionTraceEntry[];
  readonly program: SclStandaloneProgram;
}

export function executeStandaloneScl(
  source: string,
  options: StandaloneOptions = {}
): StandaloneResult {
  const program = prepareStandaloneProgram(source);
  const memory = new StandaloneMemory();
  const symbolBindings = bindVariables(program.variables, memory);

  const execution = executeProgram(program.ir, memory, {
    symbols: symbolBindings,
    trace: options.trace,
    maxLoopIterations: options.maxLoopIterations,
  });

  const variables = memory.getVariables();

  return {
    variables,
    trace: execution.trace,
    program,
  };
}

function bindVariables(
  variables: readonly IrVariable[],
  memory: StandaloneMemory
): Record<string, { address: string; dataType: IrVariable["dataType"]; stringLength?: number }> {
  const bindings: Record<string, { address: string; dataType: IrVariable["dataType"]; stringLength?: number }> = {};
  for (const variable of variables) {
    const address = memory.bindVariable(variable.name, variable.dataType, variable.stringLength);
    bindings[variable.name] = {
      address,
      dataType: variable.dataType,
      stringLength: variable.stringLength,
    };
  }
  return bindings;
}

export { prepareStandaloneProgram } from "./program.js";
export { StandaloneMemory } from "./memory.js";
