export { parseScl } from "./parser/parseScl.js";
export type { SclAst, SclAstNode, SourceRange } from "./parser/astTypes.js";
export { SclParseError } from "./parser/astTypes.js";
export {
  analyzeFbSchema,
  extractFbSchemas,
  buildSchemaFromIr,
  SchemaAnalysisError,
} from "./plc/schema/analyzeFbSchema.js";
export * from "./plc/state/index.js";
export * from "./emulator/index.js";
