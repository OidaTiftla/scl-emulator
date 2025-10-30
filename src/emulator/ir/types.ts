import type { SourceRange } from "../../parser/astTypes.js";

export type SclDataType =
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

export interface IrVariable {
  readonly name: string;
  readonly dataType: SclDataType;
  readonly range: SourceRange;
  readonly stringLength?: number;
  readonly initializer?: IrExpression;
}

export interface IrProgram {
  readonly variables: IrVariable[];
  readonly statements: IrStatement[];
}

export type IrStatement =
  | IrAssignmentStatement
  | IrIfStatement
  | IrWhileStatement
  | IrCaseStatement
  | IrForStatement;

export interface IrAssignmentStatement {
  readonly kind: "assignment";
  readonly target: IrAssignable;
  readonly expression: IrExpression;
  readonly range: SourceRange;
}

export interface IrIfStatement {
  readonly kind: "if";
  readonly branches: IrIfBranch[];
  readonly range: SourceRange;
}

export interface IrIfBranch {
  readonly condition: IrExpression | null;
  readonly statements: IrStatement[];
  readonly range: SourceRange;
}

export interface IrWhileStatement {
  readonly kind: "while";
  readonly condition: IrExpression;
  readonly body: IrStatement[];
  readonly range: SourceRange;
}

export interface IrCaseStatement {
  readonly kind: "case";
  readonly discriminant: IrExpression;
  readonly cases: IrCaseBranch[];
  readonly elseBranch?: IrStatement[];
  readonly range: SourceRange;
}

export interface IrCaseBranch {
  readonly selectors: IrCaseSelector[];
  readonly statements: IrStatement[];
  readonly range: SourceRange;
}

export type IrCaseSelector =
  | {
      readonly kind: "value";
      readonly expression: IrExpression;
      readonly range: SourceRange;
    }
  | {
      readonly kind: "range";
      readonly start: IrExpression;
      readonly end: IrExpression;
      readonly range: SourceRange;
    };

export interface IrForStatement {
  readonly kind: "for";
  readonly iterator: IrVariableReference;
  readonly initial: IrExpression;
  readonly end: IrExpression;
  readonly step?: IrExpression;
  readonly body: IrStatement[];
  readonly range: SourceRange;
}

export type IrAssignable = IrVariableReference | IrAddressReference;

export interface IrVariableReference {
  readonly kind: "variable";
  readonly name: string;
  readonly range: SourceRange;
}

export interface IrAddressReference {
  readonly kind: "address";
  readonly address: string;
  readonly dataTypeHint?: SclDataType;
  readonly range: SourceRange;
}

export type UnaryOperator = "NOT" | "NEGATE";

export type BinaryOperator =
  | "ADD"
  | "SUBTRACT"
  | "MULTIPLY"
  | "DIVIDE"
  | "AND"
  | "OR"
  | "XOR";

export type ComparisonOperator = "EQ" | "NEQ" | "LT" | "LTE" | "GT" | "GTE";

export type IrExpression =
  | IrLiteralExpression
  | IrVariableExpression
  | IrAddressExpression
  | IrUnaryExpression
  | IrBinaryExpression
  | IrComparisonExpression;

export interface IrLiteralExpression {
  readonly kind: "literal";
  readonly value: unknown;
  readonly valueType: SclDataType;
  readonly range: SourceRange;
}

export interface IrVariableExpression {
  readonly kind: "variable";
  readonly name: string;
  readonly range: SourceRange;
}

export interface IrAddressExpression {
  readonly kind: "address";
  readonly address: string;
  readonly dataTypeHint?: SclDataType;
  readonly range: SourceRange;
}

export interface IrUnaryExpression {
  readonly kind: "unary";
  readonly operator: UnaryOperator;
  readonly operand: IrExpression;
  readonly range: SourceRange;
}

export interface IrBinaryExpression {
  readonly kind: "binary";
  readonly operator: BinaryOperator;
  readonly left: IrExpression;
  readonly right: IrExpression;
  readonly range: SourceRange;
}

export interface IrComparisonExpression {
  readonly kind: "comparison";
  readonly operator: ComparisonOperator;
  readonly left: IrExpression;
  readonly right: IrExpression;
  readonly range: SourceRange;
}
