import type { OptimizedDbConfiguration } from "../../../src/plc/state/types.js";

export const emulatorDbConfig: OptimizedDbConfiguration = {
  instances: [{ name: "ProgramState", type: "ProgramState" }],
  types: {
    ProgramState: {
      fields: [
        { kind: "scalar", name: "toggleFlag", dataType: "BOOL", defaultValue: false },
        { kind: "scalar", name: "count", dataType: "INT", defaultValue: 0 },
        { kind: "scalar", name: "index", dataType: "INT", defaultValue: 0 },
        { kind: "scalar", name: "total", dataType: "INT", defaultValue: 0 },
        { kind: "scalar", name: "mode", dataType: "INT", defaultValue: 0 },
        { kind: "scalar", name: "idx", dataType: "INT", defaultValue: 0 },
        { kind: "scalar", name: "hits", dataType: "INT", defaultValue: 0 },
        { kind: "scalar", name: "flag", dataType: "BOOL", defaultValue: false },
      ],
    },
  },
};
