import { SclEmulatorBuildError } from "../emulator/errors.js";
import { buildIrProgram } from "../emulator/ir/builder.js";
import type {
  IrCaseBranch,
  IrCaseSelector,
  IrCaseStatement,
  IrExpression,
  IrIfStatement,
  IrProgram,
  IrStatement,
  IrVariable,
  IrWhileStatement,
} from "../emulator/ir/types.js";
import type { SourceRange } from "../parser/astTypes.js";
import { parseScl } from "../parser/parseScl.js";

const EMPTY_RANGE: SourceRange = { start: 0, end: 0 };

export interface SclStandaloneProgram {
  readonly ir: IrProgram;
  readonly wrappedSource: string;
  readonly variables: readonly IrVariable[];
}

/**
 * Parse, validate, and compile an SCL snippet for standalone execution.
 */
export function prepareStandaloneProgram(source: string): SclStandaloneProgram {
  const normalized = normalizeSource(source);
  const wrappedSource = wrapSnippet(normalized);
  const ast = parseScl(wrappedSource);
  const ir = buildIrProgram(ast);
  enforceStandaloneConstraints(ir);
  return {
    ir,
    wrappedSource,
    variables: ir.variables,
  };
}

function normalizeSource(source: string): string {
  const normalized = source.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new SclEmulatorBuildError(
      "Standalone SCL source must not be empty",
      EMPTY_RANGE
    );
  }
  return normalized;
}

function wrapSnippet(snippet: string): string {
  const varMatch = snippet.match(/^\s*VAR\b[\s\S]*?\bEND_VAR\b/i);
  const declarations = varMatch ? varMatch[0].trim() : "";
  const statements = varMatch
    ? snippet.slice(varMatch[0].length).trim()
    : snippet.trim();

  const lines: string[] = ["FUNCTION_BLOCK __Standalone"];
  if (declarations) {
    lines.push(declarations);
  }
  lines.push("BEGIN");
  if (statements) {
    lines.push(statements);
  }
  lines.push("END_FUNCTION_BLOCK");
  return lines.join("\n");
}

function enforceStandaloneConstraints(program: IrProgram): void {
  const declared = new Set(program.variables.map((variable) => variable.name));
  for (const variable of program.variables) {
    ensureScalar(variable);
  }
  for (const statement of program.statements) {
    validateStatement(statement, declared);
  }
}

function ensureScalar(variable: IrVariable): void {
  if (variable.stringLength !== undefined && variable.dataType !== "STRING") {
    throw new SclEmulatorBuildError(
      "Only scalar Siemens types are supported in standalone mode",
      variable.range
    );
  }
}

function validateStatement(statement: IrStatement, declared: ReadonlySet<string>): void {
  const range = statement.range;
  switch (statement.kind) {
    case "assignment":
      if (statement.target.kind === "address") {
        throw new SclEmulatorBuildError(
          `Direct PLC address "${statement.target.address}" is not allowed in standalone mode`,
          statement.target.range
        );
      }
      assertDeclared(statement.target.name, declared, statement.target.range);
      validateExpression(statement.expression, declared);
      return;
    case "if":
      validateIfStatement(statement, declared);
      return;
    case "while":
      validateWhileStatement(statement, declared);
      return;
    case "case":
      validateCaseStatement(statement, declared);
      return;
    case "for":
      assertDeclared(statement.iterator.name, declared, statement.iterator.range);
      validateExpression(statement.initial, declared);
      validateExpression(statement.end, declared);
      if (statement.step) {
        validateExpression(statement.step, declared);
      }
      for (const nested of statement.body) {
        validateStatement(nested, declared);
      }
      return;
    case "exit":
    case "continue":
      return;
    default:
      throwStandaloneUnsupported(range);
  }
}

function validateIfStatement(statement: IrIfStatement, declared: ReadonlySet<string>): void {
  for (const branch of statement.branches) {
    if (branch.condition) {
      validateExpression(branch.condition, declared);
    }
    for (const nested of branch.statements) {
      validateStatement(nested, declared);
    }
  }
}

function validateWhileStatement(statement: IrWhileStatement, declared: ReadonlySet<string>): void {
  validateExpression(statement.condition, declared);
  for (const nested of statement.body) {
    validateStatement(nested, declared);
  }
}

function validateCaseStatement(statement: IrCaseStatement, declared: ReadonlySet<string>): void {
  validateExpression(statement.discriminant, declared);
  validateCaseBranches(statement.cases, declared);
  if (statement.elseBranch) {
    for (const nested of statement.elseBranch) {
      validateStatement(nested, declared);
    }
  }
}

function validateCaseBranches(branches: IrCaseBranch[], declared: ReadonlySet<string>): void {
  for (const branch of branches) {
    validateCaseSelectors(branch.selectors, declared);
    for (const nested of branch.statements) {
      validateStatement(nested, declared);
    }
  }
}

function validateCaseSelectors(selectors: IrCaseSelector[], declared: ReadonlySet<string>): void {
  for (const selector of selectors) {
    const range = selector.range;
    switch (selector.kind) {
      case "value":
        validateExpression(selector.expression, declared);
        break;
      case "range":
        validateExpression(selector.start, declared);
        validateExpression(selector.end, declared);
        break;
      default:
        throwStandaloneUnsupported(range);
    }
  }
}

function validateExpression(expression: IrExpression, declared: ReadonlySet<string>): void {
  const range = expression.range;
  switch (expression.kind) {
    case "literal":
      return;
    case "variable":
      assertDeclared(expression.name, declared, expression.range);
      return;
    case "address":
      throw new SclEmulatorBuildError(
        `Direct PLC address "${expression.address}" is not allowed in standalone mode`,
        expression.range
      );
    case "unary":
      validateExpression(expression.operand, declared);
      return;
    case "binary":
      validateExpression(expression.left, declared);
      validateExpression(expression.right, declared);
      return;
    case "comparison":
      validateExpression(expression.left, declared);
      validateExpression(expression.right, declared);
      return;
    default:
      throwStandaloneUnsupported(range);
  }
}

function assertDeclared(name: string, declared: ReadonlySet<string>, range: SourceRange): void {
  if (!declared.has(name)) {
    throw new SclEmulatorBuildError(
      `Variable "${name}" is not declared in the standalone snippet`,
      range
    );
  }
}

function throwStandaloneUnsupported(range: SourceRange): never {
  throw new SclEmulatorBuildError("Unsupported construct in standalone mode", range);
}
