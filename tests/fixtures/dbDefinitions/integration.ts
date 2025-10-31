import type { OptimizedDbConfiguration } from "../../../src/plc/state/types.js";

export const integrationDbConfig: OptimizedDbConfiguration = {
  instances: [
    { name: "IntegrationTests", type: "IntegrationHarness" },
  ],
  types: {
    IntegrationHarness: {
      fields: [
        { kind: "scalar", name: "boolValue", dataType: "BOOL", defaultValue: false },
        { kind: "scalar", name: "byteValue", dataType: "BYTE", defaultValue: 0 },
        { kind: "scalar", name: "sintValue", dataType: "SINT", defaultValue: 0 },
        { kind: "scalar", name: "wordValue", dataType: "WORD", defaultValue: 0 },
        { kind: "scalar", name: "intValue", dataType: "INT", defaultValue: 0 },
        { kind: "scalar", name: "dwordValue", dataType: "DWORD", defaultValue: 0 },
        { kind: "scalar", name: "dintValue", dataType: "DINT", defaultValue: 0 },
        { kind: "scalar", name: "lintValue", dataType: "LINT", defaultValue: 0n },
        { kind: "scalar", name: "realValue", dataType: "REAL", defaultValue: 0 },
        { kind: "scalar", name: "lrealValue", dataType: "LREAL", defaultValue: 0 },
        { kind: "scalar", name: "timeValue", dataType: "TIME", defaultValue: 0 },
        { kind: "scalar", name: "dateValue", dataType: "DATE", defaultValue: 0 },
        { kind: "scalar", name: "todValue", dataType: "TOD", defaultValue: 0 },
        { kind: "scalar", name: "stringValue", dataType: "STRING", stringLength: 32, defaultValue: "" },
        {
          kind: "array",
          name: "intArray",
          length: 3,
          element: { kind: "scalar", name: "item", dataType: "INT", defaultValue: 0 },
        },
        {
          kind: "struct",
          name: "status",
          fields: [
            { kind: "scalar", name: "code", dataType: "INT", defaultValue: 0 },
            { kind: "scalar", name: "message", dataType: "STRING", stringLength: 24, defaultValue: "" },
          ],
        },
        { kind: "fb", name: "pumpA", type: "Pump" },
      ],
    },
    Pump: {
      fields: [
        { kind: "scalar", name: "pressure", dataType: "REAL", defaultValue: 1.5 },
        {
          kind: "array",
          name: "alarms",
          length: 2,
          element: { kind: "scalar", name: "flag", dataType: "BOOL", defaultValue: false },
        },
      ],
    },
  },
};
