import { analyzeFbSchema, parseScl } from "../../../src/index.js";
import type { OptimizedDbConfiguration } from "../../../src/plc/state/types.js";

const SOURCE = `
FUNCTION_BLOCK ProgramState
VAR
  toggleFlag : BOOL := FALSE;
  count : INT := 0;
  index : INT := 0;
  total : INT := 0;
  mode : INT := 0;
  idx : INT := 0;
  hits : INT := 0;
  flag : BOOL := FALSE;
END_VAR
END_FUNCTION_BLOCK
`;

const ast = parseScl(SOURCE);
const schema = analyzeFbSchema(ast);

export const emulatorDbConfig: OptimizedDbConfiguration = {
  instances: [{ name: "ProgramState", type: "ProgramState" }],
  schema,
};

export const programStateSchema = schema;
