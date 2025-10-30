import type { SourceRange } from "../parser/astTypes.js";
import {
  SclEmulatorRuntimeError,
} from "./errors.js";
import type {
  BinaryOperator,
  ComparisonOperator,
  IrAssignmentStatement,
  IrCaseBranch,
  IrCaseStatement,
  IrExpression,
  IrIfStatement,
  IrForStatement,
  IrProgram,
  IrStatement,
  IrWhileStatement,
  SclDataType,
  UnaryOperator,
} from "./ir/types.js";
import type {
  PlcResult,
  PlcSnapshot,
  PlcState,
  PlcVoidResult,
} from "../plc/state/index.js";

export interface ExecutionOptions {
  readonly maxLoopIterations?: number;
  readonly trace?: boolean;
  readonly symbols?: Record<string, SymbolBindingInput>;
  readonly addressTypes?: Record<string, SclDataType>;
}

export type SymbolBindingInput =
  | string
  | {
      address: string;
      dataType?: SclDataType;
      stringLength?: number;
    };

export interface ExecutionEffect {
  readonly address: string;
  readonly dataType: SclDataType;
  readonly value: unknown;
}

export interface ExecutionTraceEntry {
  readonly statementRange: SourceRange;
  readonly effects: ExecutionEffect[];
}

export interface ExecutionResult {
  readonly snapshot: PlcSnapshot;
  readonly trace?: ExecutionTraceEntry[];
}

interface SymbolBinding {
  readonly name: string;
  readonly address: string;
  readonly dataType: SclDataType;
  readonly stringLength?: number;
  readonly range: SourceRange;
}

interface ExecutionValue {
  readonly value: unknown;
  readonly dataType: SclDataType;
}

type LoopControl = "normal" | "exit" | "continue";

export function executeProgram(
  program: IrProgram,
  state: PlcState,
  options: ExecutionOptions
): ExecutionResult {
  const interpreter = new Interpreter(program, state, options);
  interpreter.execute();
  return interpreter.result();
}

class Interpreter {
  private readonly program: IrProgram;
  private readonly state: PlcState;
  private readonly options: ExecutionOptions;
  private readonly symbolTable = new Map<string, SymbolBinding>();
  private readonly traceEntries: ExecutionTraceEntry[] = [];
  private readonly maxLoopIterations: number;
  private readonly traceEnabled: boolean;

  constructor(program: IrProgram, state: PlcState, options: ExecutionOptions) {
    this.program = program;
    this.state = state;
    this.options = options;
    this.maxLoopIterations = options.maxLoopIterations ?? 1000;
    this.traceEnabled = options.trace === true;
  }

  execute(): void {
    this.buildSymbolTable();
    this.initializeVariables();
    for (const statement of this.program.statements) {
      this.executeStatement(statement, false);
    }
  }

  result(): ExecutionResult {
    const snapshot = this.state.snapshot();
    if (!this.traceEnabled) {
      return { snapshot };
    }
    return {
      snapshot,
      trace: [...this.traceEntries],
    };
  }

  private buildSymbolTable(): void {
    for (const variable of this.program.variables) {
      const bindingInput = this.options.symbols?.[variable.name];
      if (!bindingInput) {
        throw new SclEmulatorRuntimeError(
          `No binding provided for variable "${variable.name}"`,
          variable.range
        );
      }

      const binding =
        typeof bindingInput === "string"
          ? {
              address: bindingInput,
              dataType: variable.dataType,
              stringLength: variable.stringLength,
            }
          : {
              address: bindingInput.address,
              dataType: bindingInput.dataType ?? variable.dataType,
              stringLength:
                bindingInput.stringLength ?? variable.stringLength,
            };

      if (!binding.address) {
        throw new SclEmulatorRuntimeError(
          `Binding for variable "${variable.name}" is missing an address`,
          variable.range
        );
      }

      this.symbolTable.set(variable.name, {
        name: variable.name,
        address: binding.address,
        dataType: binding.dataType,
        stringLength: binding.stringLength,
        range: variable.range,
      });
    }
  }

  private initializeVariables(): void {
    for (const variable of this.program.variables) {
      if (!variable.initializer) {
        continue;
      }
      const binding = this.symbolTable.get(variable.name);
      if (!binding) {
        continue;
      }
      const value = this.evaluateExpression(variable.initializer);
      this.writeBinding(binding, value, variable.initializer.range, variable.range);
    }
  }

  private executeStatement(statement: IrStatement, inLoop: boolean): LoopControl {
    const statementKind = statement.kind;
    const statementRange = statement.range;
    switch (statement.kind) {
      case "assignment":
        return this.executeAssignment(statement);
      case "if":
        return this.executeIf(statement, inLoop);
      case "while":
        return this.executeWhile(statement, inLoop);
      case "case":
        return this.executeCase(statement, inLoop);
      case "for":
        return this.executeFor(statement);
      case "exit":
        if (!inLoop) {
          throw new SclEmulatorRuntimeError(
            "EXIT may only be used inside a loop",
            statement.range
          );
        }
        return "exit";
      case "continue":
        if (!inLoop) {
          throw new SclEmulatorRuntimeError(
            "CONTINUE may only be used inside a loop",
            statement.range
          );
        }
        return "continue";
    }
    return assertNever(statement as never, statementRange, `Unsupported statement kind "${statementKind}"`);
  }

  private executeAssignment(statement: IrAssignmentStatement): LoopControl {
    const value = this.evaluateExpression(statement.expression);
    const effects: ExecutionEffect[] = [];

    if (statement.target.kind === "variable") {
      const binding = this.symbolTable.get(statement.target.name);
      if (!binding) {
        throw new SclEmulatorRuntimeError(
          `Variable "${statement.target.name}" is not bound to PLC memory`,
          statement.target.range
        );
      }
      const written = this.writeBinding(binding, value, statement.expression.range, statement.range);
      effects.push(written);
    } else {
      const dataType =
        statement.target.dataTypeHint ??
        this.options.addressTypes?.[statement.target.address] ??
        inferDataTypeFromAddress(statement.target.address);
      if (!dataType) {
        throw new SclEmulatorRuntimeError(
          `Unable to infer data type for address "${statement.target.address}"`,
          statement.target.range
        );
      }
      const written = this.writeAddress(
        statement.target.address,
        dataType,
        value,
        undefined,
        statement.expression.range
      );
      effects.push(written);
    }

    if (this.traceEnabled) {
      this.traceEntries.push({
        statementRange: statement.range,
        effects,
      });
    }
    return "normal";
  }

  private executeIf(statement: IrIfStatement, inLoop: boolean): LoopControl {
    for (const branch of statement.branches) {
      if (!branch.condition) {
        return this.executeBlock(branch.statements, inLoop);
      }
      const conditionValue = this.evaluateExpression(branch.condition);
      if (toBoolean(conditionValue, branch.condition.range)) {
        return this.executeBlock(branch.statements, inLoop);
      }
    }
    return "normal";
  }

  private executeWhile(statement: IrWhileStatement, _inLoop: boolean): LoopControl {
    let iterations = 0;
    while (true) {
      const condition = this.evaluateExpression(statement.condition);
      if (!toBoolean(condition, statement.condition.range)) {
        break;
      }
      iterations += 1;
      if (iterations > this.maxLoopIterations) {
        throw new SclEmulatorRuntimeError(
          `WHILE loop exceeded ${this.maxLoopIterations} iterations`,
          statement.range
        );
      }
      const control = this.executeBlock(statement.body, true);
      if (control === "exit") {
        break;
      }
      if (control === "continue") {
        continue;
      }
    }
    return "normal";
  }

  private executeFor(statement: IrForStatement): LoopControl {
    const binding = this.symbolTable.get(statement.iterator.name);
    if (!binding) {
      throw new SclEmulatorRuntimeError(
        `Variable "${statement.iterator.name}" is not bound to PLC memory`,
        statement.iterator.range
      );
    }

    const useBigInt = binding.dataType === "LINT";

    const effects: ExecutionEffect[] = [];

    const initialValue = this.evaluateExpression(statement.initial);
    const initEffect = this.writeBinding(
      binding,
      initialValue,
      statement.initial.range,
      statement.range
    );
    effects.push(initEffect);

    let current: bigint | number = useBigInt
      ? toBigInt({ value: initEffect.value, dataType: "LINT" }, statement.range)
      : toNumber({ value: initEffect.value, dataType: binding.dataType }, statement.range);

    const endValue = this.evaluateExpression(statement.end);
    const endNumeric = useBigInt
      ? toBigInt(endValue, statement.end.range)
      : toNumber(endValue, statement.end.range);

    const stepRange = statement.step?.range ?? statement.range;
    const stepValue: ExecutionValue = statement.step
      ? this.evaluateExpression(statement.step)
      : useBigInt
        ? { value: 1n, dataType: "LINT" }
        : { value: 1, dataType: binding.dataType };

    const stepNumeric = useBigInt
      ? toBigInt(stepValue, stepRange)
      : toNumber(stepValue, stepRange);

    if ((useBigInt && stepNumeric === 0n) || (!useBigInt && stepNumeric === 0)) {
      throw new SclEmulatorRuntimeError("FOR loop step cannot be zero", statement.range);
    }

    const shouldContinue = (): boolean => {
      if (useBigInt) {
        const step = stepNumeric as bigint;
        const currentValue = current as bigint;
        const endValueCast = endNumeric as bigint;
        return step > 0n ? currentValue <= endValueCast : currentValue >= endValueCast;
      }
      const step = stepNumeric as number;
      const currentValue = current as number;
      const endValueCast = endNumeric as number;
      return step > 0 ? currentValue <= endValueCast : currentValue >= endValueCast;
    };

    let iterations = 0;
    while (shouldContinue()) {
      iterations += 1;
      if (iterations > this.maxLoopIterations) {
        throw new SclEmulatorRuntimeError(
          `FOR loop exceeded ${this.maxLoopIterations} iterations`,
          statement.range
        );
      }

      const control = this.executeBlock(statement.body, true);

      if (control === "exit") {
        break;
      }

      if (useBigInt) {
        current = (current as bigint) + (stepNumeric as bigint);
      } else {
        current = (current as number) + (stepNumeric as number);
      }
      const nextValue: ExecutionValue = useBigInt
        ? { value: current, dataType: "LINT" }
        : { value: current, dataType: binding.dataType };

      const nextEffect = this.writeBinding(
        binding,
        nextValue,
        statement.range,
        statement.range
      );
      effects.push(nextEffect);

      current = useBigInt
        ? toBigInt({ value: nextEffect.value, dataType: "LINT" }, statement.range)
        : toNumber({ value: nextEffect.value, dataType: binding.dataType }, statement.range);
    }

    if (this.traceEnabled && effects.length > 0) {
      this.traceEntries.push({
        statementRange: statement.range,
        effects,
      });
    }
    return "normal";
  }

  private executeCase(statement: IrCaseStatement, inLoop: boolean): LoopControl {
    const discriminant = this.evaluateExpression(statement.discriminant);
    for (const branch of statement.cases) {
      if (this.caseBranchMatches(branch, discriminant)) {
        return this.executeBlock(branch.statements, inLoop);
      }
    }
    if (statement.elseBranch) {
      return this.executeBlock(statement.elseBranch, inLoop);
    }
    return "normal";
  }

  private caseBranchMatches(branch: IrCaseBranch, discriminant: ExecutionValue): boolean {
    for (const selector of branch.selectors) {
      if (selector.kind === "value") {
        const candidate = this.evaluateExpression(selector.expression);
        if (compareExecutionValues(discriminant, candidate, "EQ", selector.range)) {
          return true;
        }
      } else {
        const start = this.evaluateExpression(selector.start);
        const end = this.evaluateExpression(selector.end);
        const meetsLowerBound = compareExecutionValues(discriminant, start, "GTE", selector.range);
        const meetsUpperBound = compareExecutionValues(discriminant, end, "LTE", selector.range);
        if (meetsLowerBound && meetsUpperBound) {
          return true;
        }
      }
    }
    return false;
  }

  private executeBlock(statements: readonly IrStatement[], inLoop: boolean): LoopControl {
    for (const statement of statements) {
      const control = this.executeStatement(statement, inLoop);
      if (control !== "normal") {
        return control;
      }
    }
    return "normal";
  }

  private evaluateExpression(expression: IrExpression): ExecutionValue {
    const expressionRange = expression.range;
    const expressionKind = expression.kind;
    switch (expression.kind) {
      case "literal":
        return { value: expression.value, dataType: expression.valueType };
      case "variable": {
        const binding = this.symbolTable.get(expression.name);
        if (!binding) {
          throw new SclEmulatorRuntimeError(
            `Variable "${expression.name}" is not bound to PLC memory`,
            expression.range
          );
        }
        const value = this.readAddress(binding.address, binding.dataType, binding.stringLength, expression.range);
        return value;
      }
      case "address": {
        const dataType =
          expression.dataTypeHint ??
          this.options.addressTypes?.[expression.address] ??
          inferDataTypeFromAddress(expression.address);
        if (!dataType) {
          throw new SclEmulatorRuntimeError(
            `Unable to infer data type for address "${expression.address}"`,
            expression.range
          );
        }
        return this.readAddress(expression.address, dataType, undefined, expression.range);
      }
      case "unary":
        return this.evaluateUnary(expression.operator, this.evaluateExpression(expression.operand), expression.range);
      case "binary":
        return this.evaluateBinary(
          expression.operator,
          this.evaluateExpression(expression.left),
          this.evaluateExpression(expression.right),
          expression.range
        );
      case "comparison":
        return this.evaluateComparison(
          expression.operator,
          this.evaluateExpression(expression.left),
          this.evaluateExpression(expression.right),
          expression.range
        );
    }
    return assertNever(expression as never, expressionRange, `Unsupported expression kind "${expressionKind}"`);
  }

  private evaluateUnary(
    operator: UnaryOperator,
    operand: ExecutionValue,
    range: SourceRange
  ): ExecutionValue {
    if (operator === "NOT") {
      return {
        value: !toBoolean(operand, range),
        dataType: "BOOL",
      };
    }
    if (operator === "NEGATE") {
      if (operand.dataType === "LINT") {
        return { value: -toBigInt(operand, range), dataType: "LINT" };
      }
      const num = toNumber(operand, range);
      return { value: -num, dataType: pickNumericResultType(operand.dataType, operand.dataType) };
    }
    throw new SclEmulatorRuntimeError(
      `Unsupported unary operator "${operator}"`,
      range
    );
  }

  private evaluateBinary(
    operator: BinaryOperator,
    left: ExecutionValue,
    right: ExecutionValue,
    range: SourceRange
  ): ExecutionValue {
    switch (operator) {
      case "AND":
        return {
          value: toBoolean(left, range) && toBoolean(right, range),
          dataType: "BOOL",
        };
      case "OR":
        return {
          value: toBoolean(left, range) || toBoolean(right, range),
          dataType: "BOOL",
        };
      case "XOR": {
        const lhs = toBoolean(left, range);
        const rhs = toBoolean(right, range);
        return {
          value: (lhs || rhs) && !(lhs && rhs),
          dataType: "BOOL",
        };
      }
      case "ADD":
      case "SUBTRACT":
      case "MULTIPLY":
      case "DIVIDE":
        return this.evaluateNumericBinary(operator, left, right, range);
      default:
        throw new SclEmulatorRuntimeError(
          `Unsupported binary operator "${operator}"`,
          range
        );
    }
  }

  private evaluateNumericBinary(
    operator: Extract<BinaryOperator, "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE">,
    left: ExecutionValue,
    right: ExecutionValue,
    range: SourceRange
  ): ExecutionValue {
    if (left.dataType === "LINT" || right.dataType === "LINT") {
      const lhs = toBigInt(left, range);
      const rhs = toBigInt(right, range);
      let value: bigint;
      switch (operator) {
        case "ADD":
          value = lhs + rhs;
          break;
        case "SUBTRACT":
          value = lhs - rhs;
          break;
        case "MULTIPLY":
          value = lhs * rhs;
          break;
        case "DIVIDE":
          if (rhs === 0n) {
            throw new SclEmulatorRuntimeError("Division by zero", range);
          }
          value = lhs / rhs;
          break;
      }
      return { value, dataType: "LINT" };
    }

    const lhs = toNumber(left, range);
    const rhs = toNumber(right, range);
    let value: number;
    switch (operator) {
      case "ADD":
        value = lhs + rhs;
        break;
      case "SUBTRACT":
        value = lhs - rhs;
        break;
      case "MULTIPLY":
        value = lhs * rhs;
        break;
      case "DIVIDE":
        if (rhs === 0) {
          throw new SclEmulatorRuntimeError("Division by zero", range);
        }
        value = lhs / rhs;
        break;
    }
    const resultType = operator === "DIVIDE"
      ? promoteNumericType(left.dataType, right.dataType, true)
      : promoteNumericType(left.dataType, right.dataType, false);
    return { value, dataType: resultType };
  }

  private evaluateComparison(
    operator: ComparisonOperator,
    left: ExecutionValue,
    right: ExecutionValue,
    range: SourceRange
  ): ExecutionValue {
    const result = compareExecutionValues(left, right, operator, range);
    return { value: result, dataType: "BOOL" };
  }

  private writeBinding(
    binding: SymbolBinding,
    value: ExecutionValue,
    expressionRange: SourceRange,
    fallbackRange: SourceRange
  ): ExecutionEffect {
    return this.writeAddress(
      binding.address,
      binding.dataType,
      value,
      binding.stringLength,
      expressionRange ?? fallbackRange
    );
  }

  private writeAddress(
    address: string,
    dataType: SclDataType,
    value: ExecutionValue,
    stringLength: number | undefined,
    range: SourceRange
  ): ExecutionEffect {
    const coerced = normalizeForType(value, dataType, range);
    const result = performWrite(this.state, dataType, address, coerced, stringLength);
    if (!result.ok) {
      throw new SclEmulatorRuntimeError(result.error.message, range);
    }
    return { address, dataType, value: coerced };
  }

  private readAddress(
    address: string,
    dataType: SclDataType,
    stringLength: number | undefined,
    range: SourceRange
  ): ExecutionValue {
    const result = performRead(this.state, dataType, address, stringLength);
    if (!result.ok) {
      throw new SclEmulatorRuntimeError(result.error.message, range);
    }
    return { value: result.value, dataType };
  }
}

function inferDataTypeFromAddress(address: string): SclDataType | undefined {
  const trimmed = address.trim().toUpperCase();
  if (/^(I|Q|M)\d+\.\d$/.test(trimmed)) {
    return "BOOL";
  }
  if (/^(I|Q|M)B\d+$/.test(trimmed)) {
    return "BYTE";
  }
  if (/^(I|Q|M)W\d+$/.test(trimmed)) {
    return "WORD";
  }
  if (/^(I|Q|M)D\d+$/.test(trimmed)) {
    return "DWORD";
  }
  if (/^DB\d+\.DBX\d+(?:\.\d)?$/.test(trimmed)) {
    return "BOOL";
  }
  if (/^DB\d+\.DBB\d+$/.test(trimmed)) {
    return "BYTE";
  }
  if (/^DB\d+\.DBW\d+$/.test(trimmed)) {
    return "WORD";
  }
  if (/^DB\d+\.DBD\d+$/.test(trimmed)) {
    return "DWORD";
  }
  return undefined;
}

function toBoolean(value: ExecutionValue, range: SourceRange): boolean {
  if (value.dataType === "BOOL") {
    return Boolean(value.value);
  }
  if (typeof value.value === "number") {
    return value.value !== 0;
  }
  if (typeof value.value === "bigint") {
    return value.value !== 0n;
  }
  throw new SclEmulatorRuntimeError(
    "Expected a boolean-compatible value",
    range
  );
}

function toNumber(value: ExecutionValue, range: SourceRange): number {
  if (typeof value.value === "number") {
    return value.value;
  }
  if (typeof value.value === "bigint") {
    return Number(value.value);
  }
  if (value.value === true) {
    return 1;
  }
  if (value.value === false) {
    return 0;
  }
  if (typeof value.value === "string" && value.dataType !== "STRING") {
    const parsed = Number.parseFloat(value.value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  throw new SclEmulatorRuntimeError(
    "Expected a numeric-compatible value",
    range
  );
}

function toBigInt(value: ExecutionValue, range: SourceRange): bigint {
  if (typeof value.value === "bigint") {
    return value.value;
  }
  if (typeof value.value === "number") {
    if (!Number.isFinite(value.value)) {
      throw new SclEmulatorRuntimeError(
        "Cannot convert non-finite number to LINT",
        range
      );
    }
    return BigInt(Math.trunc(value.value));
  }
  throw new SclEmulatorRuntimeError(
    "Expected an integer value for LINT arithmetic",
    range
  );
}

function promoteNumericType(
  left: SclDataType,
  right: SclDataType,
  forceReal: boolean
): SclDataType {
  if (forceReal || left === "REAL" || right === "REAL" || left === "LREAL" || right === "LREAL") {
    return left === "LREAL" || right === "LREAL" ? "LREAL" : "REAL";
  }
  if (left === "LINT" || right === "LINT") {
    return "LINT";
  }
  if (left === "DINT" || right === "DINT") {
    return "DINT";
  }
  if (left === "INT" || right === "INT") {
    return "INT";
  }
  if (left === "SINT" || right === "SINT") {
    return "SINT";
  }
  if (left === "DWORD" || right === "DWORD") {
    return "DWORD";
  }
  if (left === "WORD" || right === "WORD") {
    return "WORD";
  }
  if (left === "BYTE" || right === "BYTE") {
    return "BYTE";
  }
  return left;
}

function pickNumericResultType(
  left: SclDataType,
  right: SclDataType
): SclDataType {
  return promoteNumericType(left, right, false);
}

function normalizeForType(
  value: ExecutionValue,
  target: SclDataType,
  range: SourceRange
): unknown {
  switch (target) {
    case "BOOL":
      return toBoolean(value, range);
    case "BYTE":
      return clampInteger(toNumber(value, range), 0, 0xff, range);
    case "WORD":
      return clampInteger(toNumber(value, range), 0, 0xffff, range);
    case "DWORD":
      return clampInteger(toNumber(value, range), 0, 0xffffffff, range);
    case "SINT":
      return clampInteger(toNumber(value, range), -128, 127, range);
    case "INT":
      return clampInteger(toNumber(value, range), -32768, 32767, range);
    case "DINT":
      return clampInteger(
        toNumber(value, range),
        -2147483648,
        2147483647,
        range
      );
    case "LINT":
      return toBigInt(value, range);
    case "REAL":
    case "LREAL": {
      const num = toNumber(value, range);
      if (!Number.isFinite(num)) {
        throw new SclEmulatorRuntimeError(
          "Floating-point value must be finite",
          range
        );
      }
      return num;
    }
    case "TIME": {
      const num = toNumber(value, range);
      return Math.trunc(num);
    }
    case "DATE":
      return clampInteger(toNumber(value, range), 0, 65535, range);
    case "TOD":
      return clampInteger(toNumber(value, range), 0, 0xffffffff, range);
    case "STRING":
      return String(value.value);
    default:
      throw new SclEmulatorRuntimeError(
        `Unsupported target data type "${target}"`,
        range
      );
  }
}

function clampInteger(
  value: number,
  min: number,
  max: number,
  range: SourceRange
): number {
  if (!Number.isFinite(value)) {
    throw new SclEmulatorRuntimeError("Expected a finite number", range);
  }
  const truncated = Math.trunc(value);
  if (truncated < min || truncated > max) {
    throw new SclEmulatorRuntimeError(
      `Value ${truncated} is outside allowed range [${min}, ${max}]`,
      range
    );
  }
  return truncated;
}

function compareExecutionValues(
  left: ExecutionValue,
  right: ExecutionValue,
  operator: ComparisonOperator,
  range: SourceRange
): boolean {
  if (left.dataType === "STRING" || right.dataType === "STRING") {
    const lhs = String(left.value);
    const rhs = String(right.value);
    return compareNumbers(lhs.localeCompare(rhs), operator);
  }
  if (left.dataType === "BOOL" || right.dataType === "BOOL") {
    const lhs = toBoolean(left, range);
    const rhs = toBoolean(right, range);
    return compareNumbers(lhs === rhs ? 0 : lhs ? 1 : -1, operator);
  }
  if (left.dataType === "LINT" || right.dataType === "LINT") {
    const lhs = toBigInt(left, range);
    const rhs = toBigInt(right, range);
    const diff = lhs === rhs ? 0 : lhs > rhs ? 1 : -1;
    return compareNumbers(diff, operator);
  }
  const lhs = toNumber(left, range);
  const rhs = toNumber(right, range);
  return compareNumbers(lhs - rhs, operator);
}

function compareNumbers(
  difference: number,
  operator: ComparisonOperator
): boolean {
  switch (operator) {
    case "EQ":
      return difference === 0;
    case "NEQ":
      return difference !== 0;
    case "LT":
      return difference < 0;
    case "LTE":
      return difference <= 0;
    case "GT":
      return difference > 0;
    case "GTE":
      return difference >= 0;
    default:
      return false;
  }
}

function performWrite(
  state: PlcState,
  dataType: SclDataType,
  address: string,
  value: unknown,
  stringLength: number | undefined
): PlcVoidResult {
  switch (dataType) {
    case "BOOL":
      return state.writeBool(address, Boolean(value));
    case "BYTE":
      return state.writeByte(address, Number(value));
    case "WORD":
      return state.writeWord(address, Number(value));
    case "DWORD":
      return state.writeDWord(address, Number(value));
    case "SINT":
      return state.writeSInt(address, Number(value));
    case "INT":
      return state.writeInt(address, Number(value));
    case "DINT":
      return state.writeDInt(address, Number(value));
    case "LINT":
      return state.writeLint(address, value as bigint);
    case "REAL":
      return state.writeReal(address, Number(value));
    case "LREAL":
      return state.writeLReal(address, Number(value));
    case "TIME":
      return state.writeTime(address, Number(value));
    case "DATE":
      return state.writeDate(address, Number(value));
    case "TOD":
      return state.writeTod(address, Number(value));
    case "STRING":
      return state.writeString(address, String(value), {
        maxLength: stringLength,
        truncate: true,
      });
    default:
      throw new SclEmulatorRuntimeError(
        `Cannot write unsupported data type "${dataType}"`,
        { start: -1, end: -1 }
      );
  }
}

function performRead(
  state: PlcState,
  dataType: SclDataType,
  address: string,
  stringLength: number | undefined
): PlcResult<unknown> {
  switch (dataType) {
    case "BOOL":
      return state.readBool(address);
    case "BYTE":
      return state.readByte(address);
    case "WORD":
      return state.readWord(address);
    case "DWORD":
      return state.readDWord(address);
    case "SINT":
      return state.readSInt(address);
    case "INT":
      return state.readInt(address);
    case "DINT":
      return state.readDInt(address);
    case "LINT":
      return state.readLint(address);
    case "REAL":
      return state.readReal(address);
    case "LREAL":
      return state.readLReal(address);
    case "TIME":
      return state.readTime(address);
    case "DATE":
      return state.readDate(address);
    case "TOD":
      return state.readTod(address);
    case "STRING":
      return state.readString(address, {
        maxLength: stringLength,
      });
    default:
      throw new SclEmulatorRuntimeError(
        `Cannot read unsupported data type "${dataType}"`,
        { start: -1, end: -1 }
      );
  }
}

function assertNever(
  _value: never,
  range: SourceRange,
  message: string
): never {
  throw new SclEmulatorRuntimeError(message, range);
}
