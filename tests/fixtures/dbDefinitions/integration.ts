import { analyzeFbSchema, parseScl } from "../../../src/index.js";
import type { OptimizedDbConfiguration } from "../../../src/plc/state/types.js";

const SOURCE = `
FUNCTION_BLOCK Pump
VAR
  pressure : REAL := 1.5;
  alarms : ARRAY[0..1] OF BOOL;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK IntegrationHarness
VAR
  boolValue : BOOL := FALSE;
  byteValue : BYTE;
  sintValue : SINT;
  wordValue : WORD;
  intValue : INT;
  dwordValue : DWORD;
  dintValue : DINT;
  lintValue : LINT;
  realValue : REAL;
  lrealValue : LREAL;
  timeValue : TIME;
  dateValue : DATE;
  todValue : TOD;
  stringValue : STRING[32];
  intArray : ARRAY[0..2] OF INT;
  status : STRUCT
    code : INT;
    message : STRING[24];
  END_STRUCT;
  pumpA : Pump;
END_VAR
END_FUNCTION_BLOCK
`;

const ast = parseScl(SOURCE);
const schema = analyzeFbSchema(ast);

export const integrationDbConfig: OptimizedDbConfiguration = {
  instances: [
    { name: "IntegrationTests", type: "IntegrationHarness" },
  ],
  schema,
};

export const integrationSchema = schema;
