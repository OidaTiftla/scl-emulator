import type {
  SclAst,
  SclAstNode,
  SourceRange,
} from "../../parser/astTypes.js";
import { SclEmulatorBuildError } from "../errors.js";
import type {
  BinaryOperator,
  ComparisonOperator,
  IrAddressExpression,
  IrAddressReference,
  IrAssignmentStatement,
  IrCaseBranch,
  IrCaseStatement,
  IrCaseSelector,
  IrExpression,
  IrIfBranch,
  IrIfStatement,
  IrLiteralExpression,
  IrForStatement,
  IrProgram,
  IrStatement,
  IrUnaryExpression,
  IrVariable,
  IrVariableExpression,
  IrVariableReference,
  IrWhileStatement,
  SclDataType,
  UnaryOperator,
} from "./types.js";

const BLOCK_TYPES = new Set(["fbBlock", "obBlock", "fcBlock", "dbBlock"]);

export function buildIrProgram(ast: SclAst): IrProgram {
  const builder = new IrBuilder(ast);
  return builder.build();
}

class IrBuilder {
  private readonly ast: SclAst;

  private readonly variables: IrVariable[] = [];

  constructor(ast: SclAst) {
    this.ast = ast;
  }

  build(): IrProgram {
    const block = findFirst(this.ast.root, (node) =>
      BLOCK_TYPES.has(node.type)
    );
    if (!block) {
      throw new SclEmulatorBuildError(
        "No supported SCL block found in AST",
        this.ast.root.range
      );
    }

    const varDeclarations = findFirst(block, (node) =>
      node.type.startsWith("block") && node.type.endsWith("Declarations")
    );
    if (varDeclarations) {
      this.collectVariables(varDeclarations);
    }

    const functionality = findFirst(block, (node) => node.type === "blockFunctionality");
    const statements = functionality
      ? this.buildStatementContainer(functionality)
      : [];

    return {
      variables: [...this.variables],
      statements,
    };
  }

  private collectVariables(root: SclAstNode): void {
    const definitions = collect(root, (node) => node.type === "variableDefinition");
    for (const definition of definitions) {
      const nameNode = findFirst(definition, (node) => node.type === "Identifier");
      if (!nameNode) {
        throw new SclEmulatorBuildError(
          "Variable definition missing identifier",
          definition.range
        );
      }
      const name = nameNode.text;

      const typeNode = findFirst(definition, (node) => node.type === "variableType");
      if (!typeNode) {
        throw new SclEmulatorBuildError(
          `Variable "${name}" is missing a type annotation`,
          definition.range
        );
      }

      const { dataType, stringLength } = this.parseVariableType(typeNode);

      let initializer: IrExpression | undefined;
      const assignmentIndex = definition.children.findIndex(
        (child) => child.type === "':='"
      );
      if (assignmentIndex >= 0) {
        const initCandidate = definition.children
          .slice(assignmentIndex + 1)
          .find((child) =>
            child.type === "expr" ||
            child.type === "constant" ||
            child.type === "expressionName"
          );
        if (!initCandidate) {
          throw new SclEmulatorBuildError(
            `Initializer missing expression for variable "${name}"`,
            definition.range
          );
        }
        initializer = this.buildExpression(initCandidate);
      }

      this.variables.push({
        name,
        dataType,
        range: definition.range,
        stringLength,
        initializer,
      });
    }
  }

  private parseVariableType(node: SclAstNode): {
    dataType: SclDataType;
    stringLength?: number;
  } {
    const raw = node.text.trim().toUpperCase();
    if (raw.startsWith("STRING")) {
      const lengthMatch = raw.match(/^STRING\[(\d+)\]$/);
      return {
        dataType: "STRING",
        stringLength: lengthMatch ? Number.parseInt(lengthMatch[1], 10) : undefined,
      };
    }

    const supported: Record<string, SclDataType> = {
      BOOL: "BOOL",
      BYTE: "BYTE",
      WORD: "WORD",
      DWORD: "DWORD",
      SINT: "SINT",
      INT: "INT",
      DINT: "DINT",
      LINT: "LINT",
      REAL: "REAL",
      LREAL: "LREAL",
      TIME: "TIME",
      DATE: "DATE",
      TOD: "TOD",
    };

    const dataType = supported[raw];
    if (!dataType) {
      throw new SclEmulatorBuildError(
        `Unsupported variable data type "${node.text}"`,
        node.range
      );
    }

    return { dataType };
  }

  private buildStatementContainer(node: SclAstNode): IrStatement[] {
    const statements: IrStatement[] = [];
    for (const child of node.children) {
      if (child.type === "stat") {
        const statement = this.buildStatement(child);
        statements.push(statement);
      }
    }
    return statements;
  }

  private buildStatement(node: SclAstNode): IrStatement {
    const core = node.children.find((child) => child.type !== "';'");
    if (!core) {
      throw new SclEmulatorBuildError(
        "Could not determine statement kind",
        node.range
      );
    }

    switch (core.type) {
      case "assignmentStatement":
        return this.buildAssignment(core);
      case "ifStatement":
        return this.buildIfStatement(core);
      case "whileStatement":
        return this.buildWhileStatement(core);
      case "switchStatement":
        return this.buildCaseStatement(core);
      case "forStatement":
        return this.buildForStatement(core);
      default:
        throw new SclEmulatorBuildError(
          `Unsupported statement type "${core.type}"`,
          core.range
        );
    }
  }

  private buildAssignment(node: SclAstNode): IrAssignmentStatement {
    const leftNode = findFirst(node, (child) => child.type === "leftHandAssignment");
    const rightNode = findFirst(node, (child) => child.type === "rightHandAssignment");
    if (!leftNode || !rightNode) {
      throw new SclEmulatorBuildError("Malformed assignment statement", node.range);
    }

    const leftExpr = findFirst(leftNode, (child) => child.type === "expr");
    const rightExpr = findFirst(rightNode, (child) => child.type === "expr") ?? rightNode;

    if (!leftExpr) {
      throw new SclEmulatorBuildError(
        "Assignment missing left-hand expression",
        leftNode.range
      );
    }

    const target = this.buildAssignable(leftExpr);
    const expression = this.buildExpression(rightExpr);

    return {
      kind: "assignment",
      target,
      expression,
      range: node.range,
    };
  }

  private buildIfStatement(node: SclAstNode): IrIfStatement {
    const branches: IrIfBranch[] = [];

    const children = node.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child.type === "ifCondition") {
        const exprNode =
          findFirst(child, (grand) => grand.type === "expr") ?? child;
        const condition = this.buildExpression(exprNode);

        const bodyNodeIndex = findIndexAfter(
          children,
          index,
          (candidate) => candidate.type === "ifBlockStatments"
        );
        if (bodyNodeIndex === -1) {
          throw new SclEmulatorBuildError(
            "IF branch missing body",
            child.range
          );
        }
        const bodyNode = children[bodyNodeIndex];
        const statements = this.buildStatementContainer(bodyNode);

        branches.push({
          condition,
          statements,
          range: mergeRanges(child.range, bodyNode.range),
        });

        index = bodyNodeIndex;
      } else if (child.type === "ELSE") {
        const bodyNodeIndex = findIndexAfter(
          children,
          index,
          (candidate) => candidate.type === "ifBlockStatments"
        );
        if (bodyNodeIndex === -1) {
          throw new SclEmulatorBuildError(
            "ELSE branch missing body",
            child.range
          );
        }
        const bodyNode = children[bodyNodeIndex];
        branches.push({
          condition: null,
          statements: this.buildStatementContainer(bodyNode),
          range: mergeRanges(child.range, bodyNode.range),
        });
        index = bodyNodeIndex;
      }
    }

    if (branches.length === 0) {
      throw new SclEmulatorBuildError(
        "IF statement has no branches",
        node.range
      );
    }

    return {
      kind: "if",
      branches,
      range: node.range,
    };
  }

  private buildWhileStatement(node: SclAstNode): IrWhileStatement {
    const conditionNode = findFirst(node, (child) => child.type === "whileCondition");
    const bodyNode = findFirst(node, (child) => child.type === "whileBlockStatements");
    if (!conditionNode || !bodyNode) {
      throw new SclEmulatorBuildError(
        "WHILE statement missing condition or body",
        node.range
      );
    }

    const exprNode =
      findFirst(conditionNode, (child) => child.type === "expr") ?? conditionNode;

    return {
      kind: "while",
      condition: this.buildExpression(exprNode),
      body: this.buildStatementContainer(bodyNode),
      range: node.range,
    };
  }

  private buildCaseStatement(node: SclAstNode): IrCaseStatement {
    const discriminantNode =
      findFirst(node, (child) => child.type === "expr") ?? node;
    const discriminant = this.buildExpression(discriminantNode);

    const cases: IrCaseBranch[] = [];
    let elseBranch: IrStatement[] | undefined;

    for (const child of node.children) {
      if (child.type === "switchBlock") {
        cases.push(this.buildCaseBranch(child));
      } else if (
        child.type === "defualtswitchBlockStatements" ||
        child.type === "switchBlockElse"
      ) {
        const statementsNode =
          findFirst(child, (grand) => grand.type === "switchBlockStatements") ??
          child;
        elseBranch = this.buildStatementContainer(statementsNode);
      }
    }

    if (cases.length === 0) {
      throw new SclEmulatorBuildError(
        "CASE statement requires at least one branch",
        node.range
      );
    }

    return {
      kind: "case",
      discriminant,
      cases,
      elseBranch,
      range: node.range,
    };
  }

  private buildCaseBranch(node: SclAstNode): IrCaseBranch {
    const labelNode = findFirst(node, (child) => child.type === "switchLabel");
    const statementsNode = findFirst(node, (child) => child.type === "switchBlockStatements");
    if (!labelNode || !statementsNode) {
      throw new SclEmulatorBuildError(
        "CASE branch missing label or statements",
        node.range
      );
    }

    const selectors: IrCaseSelector[] = [];
    for (const labelChild of labelNode.children) {
      if (labelChild.type === "switchLabelConstant") {
        const rangeNode = labelChild.children.find(
          (grand) => grand.type === "ArraySubRange"
        );
        if (rangeNode) {
          selectors.push(this.buildRangeSelector(rangeNode));
          continue;
        }
        const constantNode = findFirst(
          labelChild,
          (grand) => grand.type === "constant" || grand.type === "expr"
        );
        if (!constantNode) {
          throw new SclEmulatorBuildError(
            "Switch label missing constant",
            labelChild.range
          );
        }
        selectors.push({
          kind: "value",
          expression: this.buildExpression(constantNode),
          range: labelChild.range,
        });
      } else if (labelChild.type === "switchLabelRange") {
        const rangeNode = findFirst(labelChild, (grand) => grand.type === "ArraySubRange");
        if (!rangeNode) {
          throw new SclEmulatorBuildError(
            "Switch label range missing bounds",
            labelChild.range
          );
        }
        selectors.push(this.buildRangeSelector(rangeNode));
      }
    }

    if (selectors.length === 0) {
      throw new SclEmulatorBuildError(
        "CASE branch must specify at least one selector",
        labelNode.range
      );
    }

    return {
      selectors,
      statements: this.buildStatementContainer(statementsNode),
      range: node.range,
    };
  }

  private buildRangeSelector(node: SclAstNode): IrCaseSelector {
    const match = node.text.match(/^\s*(.+?)\s*\.\.\s*(.+?)\s*$/);
    if (!match) {
      throw new SclEmulatorBuildError(
        `Invalid CASE range selector "${node.text}"`,
        node.range
      );
    }
    const [, startRaw, endRaw] = match;
    const start = createLiteralExpressionFromText(startRaw, node.range);
    const end = createLiteralExpressionFromText(endRaw, node.range);
    return {
      kind: "range",
      start,
      end,
      range: node.range,
    };
  }

  private buildForStatement(node: SclAstNode): IrForStatement {
    const initNode = findFirst(node, (child) => child.type === "forInitialCondition");
    const endNode = findFirst(node, (child) => child.type === "forEndCondition");
    const stepNode = findFirst(node, (child) => child.type === "forStepCondition");
    const bodyNode = findFirst(node, (child) => child.type === "forBlockStatements");

    if (!initNode || !endNode || !bodyNode) {
      throw new SclEmulatorBuildError(
        "FOR loop missing initializer, end condition, or body",
        node.range
      );
    }

    const initAssignment = findFirst(
      initNode,
      (child) => child.type === "assignmentStatement"
    );
    if (!initAssignment) {
      throw new SclEmulatorBuildError(
        "FOR initializer must be an assignment",
        initNode.range
      );
    }

    const leftNode = findFirst(initAssignment, (child) => child.type === "expr");
    const rightNode =
      findFirst(initAssignment, (child) => child.type === "rightHandAssignment") ??
      initAssignment.children.find((child) => child.type === "expr");

    if (!leftNode || !rightNode) {
      throw new SclEmulatorBuildError(
        "FOR initializer assignment is malformed",
        initAssignment.range
      );
    }

    const iterator = this.buildAssignable(leftNode);
    if (iterator.kind !== "variable") {
      throw new SclEmulatorBuildError(
        "FOR iterator must be a declared variable",
        leftNode.range
      );
    }

    const endExpr =
      findFirst(endNode, (child) => child.type === "expr") ?? endNode;

    const stepExpr = stepNode
      ? findFirst(stepNode, (child) => child.type === "expr") ?? stepNode
      : undefined;

    const initialExprNode = findFirst(rightNode, (child) => child.type === "expr") ?? rightNode;

    return {
      kind: "for",
      iterator,
      initial: this.buildExpression(initialExprNode),
      end: this.buildExpression(endExpr),
      step: stepExpr ? this.buildExpression(stepExpr) : undefined,
      body: this.buildStatementContainer(bodyNode),
      range: node.range,
    };
  }

  private buildAssignable(exprNode: SclAstNode): IrVariableReference | IrAddressReference {
    const base = this.buildExpression(exprNode);
    if (base.kind === "variable") {
      return {
        kind: "variable",
        name: base.name,
        range: base.range,
      };
    }
    if (base.kind === "address") {
      return {
        kind: "address",
        address: base.address,
        dataTypeHint: base.dataTypeHint,
        range: base.range,
      };
    }

    throw new SclEmulatorBuildError(
      "Left-hand side must be a variable or address",
      exprNode.range
    );
  }

  private buildExpression(node: SclAstNode): IrExpression {
    switch (node.type) {
      case "expr":
        return this.buildExprNode(node);
      case "constant":
        return this.buildConstant(node);
      case "expressionName":
        return this.buildIdentifier(node);
      default:
        if (node.type === "switchLabelConstant") {
          const constantNode = findFirst(node, (child) => child.type === "constant");
          if (!constantNode) {
            throw new SclEmulatorBuildError(
              "Switch label without constant",
              node.range
            );
          }
          return this.buildConstant(constantNode);
        }
        throw new SclEmulatorBuildError(
          `Unsupported expression node "${node.type}"`,
          node.range
        );
    }
  }

  private buildExprNode(node: SclAstNode): IrExpression {
    if (node.children.length === 0) {
      throw new SclEmulatorBuildError("Empty expression", node.range);
    }

    if (
      node.children.length === 3 &&
      node.children[0].type === "'('" &&
      node.children[2].type === "')'" &&
      node.children[1]
    ) {
      return this.buildExpression(node.children[1]);
    }

    if (node.children.length === 1) {
      return this.buildExpression(node.children[0]);
    }

    const first = node.children[0];
    if (first.type === "'NOT'") {
      const operandNode = node.children[1];
      if (!operandNode) {
        throw new SclEmulatorBuildError(
          "NOT expression missing operand",
          node.range
        );
      }
      return this.makeUnary("NOT", operandNode, node.range);
    }
    if (first.type === "'-'") {
      const operandNode = node.children[1];
      if (!operandNode) {
        throw new SclEmulatorBuildError(
          "Unary minus missing operand",
          node.range
        );
      }
      return this.makeUnary("NEGATE", operandNode, node.range);
    }
    if (first.type === "'+'") {
      const operandNode = node.children[1];
      if (!operandNode) {
        throw new SclEmulatorBuildError(
          "Unary plus missing operand",
          node.range
        );
      }
      return this.buildExpression(operandNode);
    }

    if (node.children.length === 3) {
      const [leftNode, operatorNode, rightNode] = node.children;
      if (leftNode.type === "expr" && rightNode.type === "expr") {
        const comparison = comparisonOperatorFor(operatorNode.type);
        if (comparison) {
          return {
            kind: "comparison",
            operator: comparison,
            left: this.buildExpression(leftNode),
            right: this.buildExpression(rightNode),
            range: node.range,
          };
        }

        const binary = binaryOperatorFor(operatorNode.type);
        if (binary) {
          return {
            kind: "binary",
            operator: binary,
            left: this.buildExpression(leftNode),
            right: this.buildExpression(rightNode),
            range: node.range,
          };
        }
      }
    }

    if (node.children.length === 2) {
      const [leftNode, rightNode] = node.children;
      const operator = binaryOperatorFor(rightNode.type);
      if (leftNode.type === "expr" && operator) {
        const rightExpr = findFirst(rightNode, (child) => child.type === "expr");
        if (!rightExpr) {
          throw new SclEmulatorBuildError(
            "Binary expression missing right operand",
            rightNode.range
          );
        }
        return {
          kind: "binary",
          operator,
          left: this.buildExpression(leftNode),
          right: this.buildExpression(rightExpr),
          range: node.range,
        };
      }
    }

    const collapsed = node.children.find(
      (child) => child.type === "expr" || child.type === "constant"
    );
    if (collapsed) {
      return this.buildExpression(collapsed);
    }

    throw new SclEmulatorBuildError(
      `Unsupported expression structure "${node.text}"`,
      node.range
    );
  }

  private makeUnary(
    operator: UnaryOperator,
    operandNode: SclAstNode,
    range: SourceRange
  ): IrUnaryExpression {
    return {
      kind: "unary",
      operator,
      operand: this.buildExpression(operandNode),
      range,
    };
  }

  private buildIdentifier(node: SclAstNode): IrVariableExpression | IrAddressExpression {
    const name = node.text;
    const classified = classifyAddress(name);
    if (classified) {
      return {
        kind: "address",
        address: classified.address,
        dataTypeHint: classified.dataType,
        range: node.range,
      };
    }

    return {
      kind: "variable",
      name,
      range: node.range,
    };
  }

  private buildConstant(node: SclAstNode): IrLiteralExpression | IrAddressExpression {
    if (node.children.length === 0) {
      throw new SclEmulatorBuildError("Constant node missing value", node.range);
    }

    const literalNode = node.children[0];
    switch (literalNode.type) {
      case "BOOLLiteral": {
        const normalized = literalNode.text.toUpperCase();
        return {
          kind: "literal",
          valueType: "BOOL",
          value: normalized === "TRUE",
          range: node.range,
        };
      }
      case "INTLiteral":
        return literalFromNumber(
          node.range,
          Number.parseInt(literalNode.text, 10),
          "INT"
        );
      case "SINTLiteral":
        return literalFromNumber(
          node.range,
          Number.parseInt(literalNode.text, 10),
          "SINT"
        );
      case "DINTLiteral":
        return literalFromNumber(
          node.range,
          Number.parseInt(literalNode.text, 10),
          "DINT"
        );
      case "LINTLiteral":
        return {
          kind: "literal",
          valueType: "LINT",
          value: BigInt(literalNode.text),
          range: node.range,
        };
      case "REALLiteral":
        return literalFromNumber(
          node.range,
          Number.parseFloat(literalNode.text),
          "REAL"
        );
      case "LREALLiteral":
        return literalFromNumber(
          node.range,
          Number.parseFloat(literalNode.text),
          "LREAL"
        );
      case "TIME_LITERAL":
      case "TIMELiteral":
        return literalFromNumber(
          node.range,
          parseTimeLiteral(literalNode.text, node.range),
          "TIME"
        );
      case "DATELiteral":
        return literalFromNumber(
          node.range,
          parseDateLiteral(literalNode.text, node.range),
          "DATE"
        );
      case "TODLiteral":
        return literalFromNumber(
          node.range,
          parseTodLiteral(literalNode.text, node.range),
          "TOD"
        );
      case "STRINGLiteral":
        return {
          kind: "literal",
          valueType: "STRING",
          value: parseStringLiteral(literalNode.text),
          range: node.range,
        };
      case "GLOBALBOOLLiteral": {
        const classified = classifyAddress(literalNode.text, "GLOBALBOOLLiteral");
        if (!classified) {
          throw new SclEmulatorBuildError(
            `Unsupported global literal "${literalNode.text}"`,
            node.range
          );
        }
        return {
          kind: "address",
          address: classified.address,
          dataTypeHint: classified.dataType,
          range: node.range,
        };
      }
      default:
        throw new SclEmulatorBuildError(
          `Unsupported literal type "${literalNode.type}"`,
          literalNode.range
        );
    }
  }
}

function findFirst(
  node: SclAstNode,
  predicate: (candidate: SclAstNode) => boolean
): SclAstNode | undefined {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children) {
    const found = findFirst(child, predicate);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function collect(
  node: SclAstNode,
  predicate: (candidate: SclAstNode) => boolean,
  result: SclAstNode[] = []
): SclAstNode[] {
  if (predicate(node)) {
    result.push(node);
  }
  for (const child of node.children) {
    collect(child, predicate, result);
  }
  return result;
}

function findIndexAfter(
  nodes: readonly SclAstNode[],
  startIndex: number,
  predicate: (candidate: SclAstNode) => boolean
): number {
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    if (predicate(nodes[index])) {
      return index;
    }
  }
  return -1;
}

function mergeRanges(a: SourceRange, b: SourceRange): SourceRange {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
  };
}

function binaryOperatorFor(tokenType: string): BinaryOperator | undefined {
  switch (tokenType) {
    case "'+'":
      return "ADD";
    case "'-'":
      return "SUBTRACT";
    case "'*'":
      return "MULTIPLY";
    case "'/'":
      return "DIVIDE";
    case "'AND'":
      return "AND";
    case "'OR'":
      return "OR";
    case "'XOR'":
      return "XOR";
    default:
      return undefined;
  }
}

function comparisonOperatorFor(tokenType: string): ComparisonOperator | undefined {
  switch (tokenType) {
    case "'='":
      return "EQ";
    case "'<>'":
      return "NEQ";
    case "'<'":
      return "LT";
    case "'<='":
      return "LTE";
    case "'>'":
      return "GT";
    case "'>='":
      return "GTE";
    default:
      return undefined;
  }
}

function classifyAddress(
  text: string,
  tokenType?: string
): { address: string; dataType?: SclDataType } | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  if (tokenType === "GLOBALBOOLLiteral") {
    return { address: trimmed, dataType: "BOOL" };
  }

  const bitMatch = trimmed.match(/^(I|Q|M)(\d+)\.(\d)$/i);
  if (bitMatch) {
    return { address: trimmed, dataType: "BOOL" };
  }

  const byteMatch = trimmed.match(/^(I|Q|M)B\d+$/i);
  if (byteMatch) {
    return { address: trimmed, dataType: "BYTE" };
  }

  const wordMatch = trimmed.match(/^(I|Q|M)W\d+$/i);
  if (wordMatch) {
    return { address: trimmed, dataType: "WORD" };
  }

  const dwordMatch = trimmed.match(/^(I|Q|M)D\d+$/i);
  if (dwordMatch) {
    return { address: trimmed, dataType: "DWORD" };
  }

  const dbMatch = trimmed.match(/^DB\d+\.(DBX|DBB|DBW|DBD)\d+(?:\.\d)?$/i);
  if (dbMatch) {
    const token = dbMatch[1].toUpperCase();
    const dataType: Record<string, SclDataType> = {
      DBX: "BOOL",
      DBB: "BYTE",
      DBW: "WORD",
      DBD: "DWORD",
    };
    return { address: trimmed, dataType: dataType[token] };
  }

  return undefined;
}

function literalFromNumber(
  range: SourceRange,
  value: number,
  valueType: Exclude<SclDataType, "BOOL" | "LINT" | "STRING">
): IrLiteralExpression {
  return {
    kind: "literal",
    valueType,
    value,
    range,
  };
}

function createLiteralExpressionFromText(
  raw: string,
  range: SourceRange
): IrLiteralExpression {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();

  if (upper === "TRUE" || upper === "FALSE") {
    return {
      kind: "literal",
      valueType: "BOOL",
      value: upper === "TRUE",
      range,
    };
  }

  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("\"") && trimmed.endsWith("\""))) {
    return {
      kind: "literal",
      valueType: "STRING",
      value: parseStringLiteral(trimmed),
      range,
    };
  }

  if (/^[+-]?\d+$/.test(trimmed)) {
    const bigintValue = BigInt(trimmed);
    if (bigintValue < BigInt(-2147483648) || bigintValue > BigInt(2147483647)) {
      return {
        kind: "literal",
        valueType: "LINT",
        value: bigintValue,
        range,
      };
    }
    const numberValue = Number.parseInt(trimmed, 10);
    if (numberValue >= -32768 && numberValue <= 32767) {
      return literalFromNumber(range, numberValue, "INT");
    }
    return literalFromNumber(range, numberValue, "DINT");
  }

  if (/^[+-]?\d*\.\d+(?:[eE][+-]?\d+)?$/.test(trimmed) || /^[+-]?\d+(?:[eE][+-]?\d+)$/.test(trimmed)) {
    const numeric = Number.parseFloat(trimmed);
    const valueType = trimmed.toUpperCase().includes("E") ? "LREAL" : "REAL";
    return literalFromNumber(range, numeric, valueType);
  }

  throw new SclEmulatorBuildError(
    `Unsupported literal value "${raw}" in CASE range`,
    range
  );
}

function parseStringLiteral(raw: string): string {
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw
      .slice(1, -1)
      .replace(/''/g, "'")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  return raw;
}

function parseTimeLiteral(raw: string, range: SourceRange): number {
  const normalized = raw
    .toUpperCase()
    .replace(/^TIME#/, "")
    .replace(/^T#/, "");
  const parts = normalized.split("_");
  let total = 0;
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const match = part.match(/^(-?\d+(?:\.\d+)?)(MS|S|M|H|D)$/);
    if (!match) {
      throw new SclEmulatorBuildError(
        `Unsupported TIME literal segment "${part}"`,
        range
      );
    }
    const [, valueRaw, unit] = match;
    const value = Number.parseFloat(valueRaw);
    const multiplier =
      unit === "MS"
        ? 1
        : unit === "S"
          ? 1000
          : unit === "M"
            ? 60_000
            : unit === "H"
              ? 3_600_000
              : 86_400_000;
    total += value * multiplier;
  }
  return total;
}

function parseDateLiteral(raw: string, range: SourceRange): number {
  const normalized = raw
    .toUpperCase()
    .replace(/^DATE#/, "")
    .replace(/^D#/, "");
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new SclEmulatorBuildError(
      `Invalid DATE literal "${raw}"`,
      range
    );
  }
  const base = Date.UTC(1990, 0, 1);
  const diff = Math.floor((date.getTime() - base) / 86_400_000);
  return diff;
}

function parseTodLiteral(raw: string, range: SourceRange): number {
  const normalized = raw
    .toUpperCase()
    .replace(/^TOD#/, "")
    .replace(/^T#/, "");
  const match = normalized.match(
    /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/
  );
  if (!match) {
    throw new SclEmulatorBuildError(
      `Invalid TOD literal "${raw}"`,
      range
    );
  }
  const [, hoursRaw, minutesRaw, secondsRaw, millisRaw] = match;
  const hours = Number.parseInt(hoursRaw, 10);
  const minutes = Number.parseInt(minutesRaw, 10);
  const seconds = Number.parseInt(secondsRaw, 10);
  const millis = millisRaw ? Number.parseInt(millisRaw.padEnd(3, "0"), 10) : 0;
  if (
    hours > 23 ||
    minutes > 59 ||
    seconds > 59 ||
    millis < 0 ||
    millis > 999
  ) {
    throw new SclEmulatorBuildError(
      `TOD literal out of range "${raw}"`,
      range
    );
  }
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis;
}
