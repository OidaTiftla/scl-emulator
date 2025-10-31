import type { SclAst, SclAstNode, SourceRange } from "../../parser/astTypes.js";
import type {
  FbArrayFieldSchema,
  FbFieldSchema,
  FbInstanceFieldSchema,
  FbScalarFieldSchema,
  FbStructFieldSchema,
  FbTypeSchema,
  FbTypeSchemaRegistryInput,
  PlcValueType,
} from "../state/types.js";
import type { IrProgram, IrExpression } from "../../emulator/ir/types.js";
import { normalizeSchemaRegistry } from "./registry.js";

const DEFAULT_STRING_LENGTH = 254;

const SUPPORTED_SCALAR_TYPES: Record<string, PlcValueType> = {
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
  STRING: "STRING",
};

const SUPPORTED_VAR_SECTION_STARTS = new Set(["'VAR'"]); // Static VAR and multi-instance sections.

interface SchemaContext {
  readonly fbName: string;
  readonly path: readonly string[];
}

export interface AnalyzeFbSchemaOptions {
  readonly baseSchemas?: FbTypeSchemaRegistryInput;
}

export class SchemaAnalysisError extends Error {
  readonly range?: SourceRange;

  constructor(message: string, range?: SourceRange) {
    super(message);
    this.name = "SchemaAnalysisError";
    this.range = range;
  }
}

export function analyzeFbSchema(
  ast: SclAst,
  options?: AnalyzeFbSchemaOptions
): Map<string, FbTypeSchema> {
  const registry = options?.baseSchemas
    ? normalizeSchemaRegistry(options.baseSchemas)
    : new Map<string, FbTypeSchema>();

  const fbBlocks = collect(ast.root, (node) => node.type === "fbBlock");
  for (const block of fbBlocks) {
    const fbName = extractBlockName(block);
    const context: SchemaContext = { fbName, path: [] };
    const fields = extractFieldsFromBlock(block, context);
    registry.set(fbName.toLowerCase(), {
      name: fbName,
      fields,
    });
  }

  return registry;
}

export function extractFbSchemas(
  ast: SclAst,
  options?: AnalyzeFbSchemaOptions
): Map<string, FbTypeSchema> {
  return analyzeFbSchema(ast, options);
}

export interface BuildSchemaFromIrOptions {
  readonly typeName?: string;
}

export function buildSchemaFromIr(
  ir: IrProgram,
  options?: BuildSchemaFromIrOptions
): FbTypeSchema {
  const typeName = options?.typeName?.trim() || "AnonymousFb";
  const fields: FbFieldSchema[] = ir.variables.map((variable) => {
    const isString = variable.dataType === "STRING";
    let defaultValue: unknown | undefined;
    if (variable.initializer && isLiteral(variable.initializer)) {
      defaultValue = variable.initializer.value;
    }
    const stringLength = isString
      ? variable.stringLength ?? DEFAULT_STRING_LENGTH
      : undefined;
    return {
      kind: "scalar",
      name: variable.name,
      dataType: variable.dataType,
      defaultValue,
      stringLength,
    } satisfies FbScalarFieldSchema;
  });

  return {
    name: typeName,
    fields,
  };
}

function extractFieldsFromBlock(
  block: SclAstNode,
  context: SchemaContext
): FbFieldSchema[] {
  const declarations = block.children.find((child) => child.type === "blockVarDeclarations");
  if (!declarations) {
    return [];
  }

  const fields: FbFieldSchema[] = [];
  for (const section of declarations.children) {
    const firstToken = section.children[0]?.type;
    if (!firstToken || !SUPPORTED_VAR_SECTION_STARTS.has(firstToken)) {
      continue;
    }
    const definitions = section.children.find((child) => child.type === "variableDefinitions");
    if (!definitions) {
      continue;
    }
    fields.push(...parseVariableDefinitions(definitions, context));
  }
  return fields;
}

function parseVariableDefinitions(
  definitionsNode: SclAstNode,
  context: SchemaContext
): FbFieldSchema[] {
  const fields: FbFieldSchema[] = [];
  for (const child of definitionsNode.children) {
    if (child.type === "variableDefinition") {
      fields.push(parseVariableDefinition(child, context));
    }
  }
  return fields;
}

function parseVariableDefinition(node: SclAstNode, context: SchemaContext): FbFieldSchema {
  const nameNode = node.children.find((child) => child.type === "expressionName");
  const identifier = nameNode ? findFirst(nameNode, (candidate) => candidate.type === "Identifier") : undefined;
  const name = identifier?.text ?? nameNode?.text;
  if (!name) {
    throw new SchemaAnalysisError("Variable definition missing identifier", node.range);
  }

  const typeNode = node.children.find((child) => child.type === "variableType");
  if (!typeNode) {
    throw new SchemaAnalysisError(
      `Variable "${describePath(context, name)}" is missing a type annotation`,
      node.range
    );
  }

  const initializerNode = findInitializer(node);
  const scoped = pushPath(context, name);
  return parseFieldFromType(name, typeNode, initializerNode, scoped);
}

function parseFieldFromType(
  name: string,
  typeNode: SclAstNode,
  initializerNode: SclAstNode | undefined,
  context: SchemaContext
): FbFieldSchema {
  const kindNode = typeNode.children.find((child) => child.type !== "':'");
  if (!kindNode) {
    throw new SchemaAnalysisError(
      `Unable to resolve type for "${describePath(context, name)}"`,
      typeNode.range
    );
  }

  switch (kindNode.type) {
    case "elementaryType":
      return buildScalarField(name, kindNode, initializerNode, context);
    case "arrayType":
      return buildArrayField(name, kindNode, initializerNode, context);
    case "structType":
      return buildStructField(name, kindNode, initializerNode, context);
    case "udtType": {
      const identifierNode = findFirst(kindNode, (child) => child.type === "Identifier");
      const rawIdentifier = identifierNode?.text ?? kindNode.text;
      const normalized = rawIdentifier.trim().toUpperCase();
      if (SUPPORTED_SCALAR_TYPES[normalized]) {
        return buildScalarFromIdentifier(name, normalized, initializerNode, context);
      }
      return buildInstanceField(name, kindNode, initializerNode, context);
    }
    default:
      throw new SchemaAnalysisError(
        `Unsupported type "${kindNode.text}" for "${describePath(context, name)}"`,
        kindNode.range
      );
  }
}

function buildScalarFromIdentifier(
  name: string,
  typeName: string,
  initializerNode: SclAstNode | undefined,
  context: SchemaContext
): FbScalarFieldSchema {
  const dataType = SUPPORTED_SCALAR_TYPES[typeName];
  let defaultValue: unknown | undefined;
  if (initializerNode) {
    defaultValue = parseScalarInitializer(initializerNode, context, name);
  }
  const stringLength = dataType === "STRING" ? DEFAULT_STRING_LENGTH : undefined;
  return {
    kind: "scalar",
    name,
    dataType,
    defaultValue,
    stringLength,
  };
}

function buildScalarField(
  name: string,
  node: SclAstNode,
  initializerNode: SclAstNode | undefined,
  context: SchemaContext
): FbScalarFieldSchema {
  const rawText = node.text.trim().toUpperCase();
  const dataType = determineScalarType(rawText, context, name, node.range);
  const stringLength = dataType === "STRING"
    ? extractStringLength(rawText) ?? DEFAULT_STRING_LENGTH
    : undefined;

  let defaultValue: unknown | undefined;
  if (initializerNode) {
    defaultValue = parseScalarInitializer(initializerNode, context, name);
  }

  return {
    kind: "scalar",
    name,
    dataType,
    defaultValue,
    stringLength,
  };
}

function determineScalarType(
  normalized: string,
  context: SchemaContext,
  name: string,
  range: SourceRange | undefined
): PlcValueType {
  if (normalized.startsWith("STRING")) {
    return "STRING";
  }
  const dataType = SUPPORTED_SCALAR_TYPES[normalized];
  if (!dataType) {
    throw new SchemaAnalysisError(
      `Unsupported scalar type "${normalized}" for "${describePath(context, name)}"`,
      range
    );
  }
  return dataType;
}

function extractStringLength(text: string): number | undefined {
  const match = text.match(/^STRING\[(\d+)]$/);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
}

function buildArrayField(
  name: string,
  node: SclAstNode,
  initializerNode: SclAstNode | undefined,
  context: SchemaContext
): FbArrayFieldSchema {
  if (initializerNode) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" uses unsupported initializer`,
      initializerNode.range
    );
  }

  const rangeNode = node.children.find((child) => child.type === "arrayRange");
  if (!rangeNode) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" is missing bounds`,
      node.range
    );
  }

  const subRanges = rangeNode.children.filter((child) => child.type === "ArraySubRange");
  if (subRanges.length !== 1) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" must declare a single dimension`,
      rangeNode.range
    );
  }

  const { lower, upper } = parseArrayBounds(subRanges[0], context, name);
  if (lower !== 0) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" must start at index 0`,
      subRanges[0]?.range
    );
  }
  const length = upper - lower + 1;
  if (!Number.isInteger(length) || length <= 0) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" declares invalid length ${length}`,
      subRanges[0]?.range
    );
  }

  const elementType = node.children.find((child) => child.type === "variableType");
  if (!elementType) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" is missing element type`,
      node.range
    );
  }

  const elementField = parseFieldFromType(name, elementType, undefined, context);

  return {
    kind: "array",
    name,
    length,
    element: elementField,
  } satisfies FbArrayFieldSchema;
}

function buildStructField(
  name: string,
  node: SclAstNode,
  initializerNode: SclAstNode | undefined,
  context: SchemaContext
): FbStructFieldSchema {
  if (initializerNode) {
    throw new SchemaAnalysisError(
      `STRUCT "${describePath(context, name)}" uses unsupported initializer`,
      initializerNode.range
    );
  }
  const definitions = node.children.find((child) => child.type === "variableDefinitions");
  if (!definitions) {
    throw new SchemaAnalysisError(
      `STRUCT "${describePath(context, name)}" is missing field definitions`,
      node.range
    );
  }
  const scoped = pushPath(context, name);
  const fields = parseVariableDefinitions(definitions, scoped);
  return {
    kind: "struct",
    name,
    fields,
  };
}

function buildInstanceField(
  name: string,
  node: SclAstNode,
  initializerNode: SclAstNode | undefined,
  context: SchemaContext
): FbInstanceFieldSchema {
  if (initializerNode) {
    throw new SchemaAnalysisError(
      `FB instance "${describePath(context, name)}" cannot declare initializer`,
      initializerNode.range
    );
  }
  const identifierNode = findFirst(node, (child) => child.type === "Identifier");
  const typeName = identifierNode?.text ?? node.text;
  if (!typeName) {
    throw new SchemaAnalysisError(
      `FB instance "${describePath(context, name)}" is missing a type name`,
      node.range
    );
  }
  return {
    kind: "fb",
    name,
    type: typeName,
  };
}

function parseScalarInitializer(
  node: SclAstNode,
  context: SchemaContext,
  name: string
): unknown {
  if (node.type !== "constant") {
    throw new SchemaAnalysisError(
      `Initializer for "${describePath(context, name)}" must be a literal`,
      node.range
    );
  }
  if (node.children.length === 0) {
    throw new SchemaAnalysisError(
      `Initializer for "${describePath(context, name)}" is empty`,
      node.range
    );
  }
  const literalNode = node.children[0];
  switch (literalNode.type) {
    case "BOOLLiteral":
      return literalNode.text.toUpperCase() === "TRUE";
    case "INTLiteral":
    case "SINTLiteral":
    case "DINTLiteral":
      return Number.parseInt(literalNode.text, 10);
    case "LINTLiteral":
      return BigInt(literalNode.text);
    case "REALLiteral":
    case "LREALLiteral":
      return Number.parseFloat(literalNode.text);
    case "TIME_LITERAL":
    case "TIMELiteral":
      return parseTimeLiteral(literalNode.text, node.range);
    case "DATELiteral":
      return parseDateLiteral(literalNode.text, node.range);
    case "TODLiteral":
      return parseTodLiteral(literalNode.text, node.range);
    case "STRINGLiteral":
      return parseStringLiteral(literalNode.text);
    default:
      throw new SchemaAnalysisError(
        `Unsupported literal type "${literalNode.type}" for "${describePath(context, name)}"`,
        literalNode.range
      );
  }
}

function parseArrayBounds(
  node: SclAstNode,
  context: SchemaContext,
  name: string
): { lower: number; upper: number } {
  const match = node.text.match(/\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*/);
  if (!match) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" has invalid bounds "${node.text}"`,
      node.range
    );
  }
  const lower = Number.parseInt(match[1], 10);
  const upper = Number.parseInt(match[2], 10);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower) {
    throw new SchemaAnalysisError(
      `Array "${describePath(context, name)}" has invalid bounds ${match[1]}..${match[2]}`,
      node.range
    );
  }
  return { lower, upper };
}

function findInitializer(node: SclAstNode): SclAstNode | undefined {
  const index = node.children.findIndex((child) => child.type === "':='");
  if (index < 0) {
    return undefined;
  }
  for (let cursor = index + 1; cursor < node.children.length; cursor += 1) {
    const candidate = node.children[cursor];
    if (candidate.type === "constant") {
      return candidate;
    }
    if (candidate.type === "expr") {
      const collapsed = unwrapConstant(candidate);
      return collapsed ?? candidate;
    }
  }
  return undefined;
}

function unwrapConstant(node: SclAstNode): SclAstNode | undefined {
  if (node.type === "constant") {
    return node;
  }
  if (node.type !== "expr") {
    return undefined;
  }
  const meaningful = node.children.filter(
    (child) => child.type !== "'('" && child.type !== "')'" && child.type !== "';'"
  );
  if (meaningful.length !== 1) {
    return undefined;
  }
  return unwrapConstant(meaningful[0]);
}

function extractBlockName(block: SclAstNode): string {
  const nameNode = block.children.find((child) => child.type === "blockName");
  const identifier = nameNode ? findFirst(nameNode, (candidate) => candidate.type === "Identifier") : undefined;
  const name = identifier?.text ?? nameNode?.text;
  if (!name) {
    throw new SchemaAnalysisError("FUNCTION_BLOCK declaration is missing a name", block.range);
  }
  return name;
}

function pushPath(context: SchemaContext, segment: string): SchemaContext {
  return {
    fbName: context.fbName,
    path: [...context.path, segment],
  };
}

function describePath(context: SchemaContext, leaf?: string): string {
  const segments = [context.fbName, ...context.path];
  if (leaf) {
    segments.push(leaf);
  }
  return segments.filter(Boolean).join(".");
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

function parseTimeLiteral(raw: string, range?: SourceRange): number {
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
      throw new SchemaAnalysisError(`Unsupported TIME literal segment "${part}"`, range);
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

function parseDateLiteral(raw: string, range?: SourceRange): number {
  const normalized = raw
    .toUpperCase()
    .replace(/^DATE#/, "")
    .replace(/^D#/, "");
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new SchemaAnalysisError(`Invalid DATE literal "${raw}"`, range);
  }
  const base = Date.UTC(1990, 0, 1);
  return Math.floor((date.getTime() - base) / 86_400_000);
}

function parseTodLiteral(raw: string, range?: SourceRange): number {
  const normalized = raw
    .toUpperCase()
    .replace(/^TOD#/, "")
    .replace(/^T#/, "");
  const match = normalized.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) {
    throw new SchemaAnalysisError(`Invalid TOD literal "${raw}"`, range);
  }
  const [, hoursRaw, minutesRaw, secondsRaw, millisRaw] = match;
  const hours = Number.parseInt(hoursRaw, 10);
  const minutes = Number.parseInt(minutesRaw, 10);
  const seconds = Number.parseInt(secondsRaw, 10);
  const millis = millisRaw ? Number.parseInt(millisRaw.padEnd(3, "0"), 10) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59 || millis < 0 || millis > 999) {
    throw new SchemaAnalysisError(`TOD literal out of range "${raw}"`, range);
  }
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis;
}

function isLiteral(expression: IrExpression): expression is Extract<IrExpression, { kind: "literal" }> {
  return expression.kind === "literal";
}
