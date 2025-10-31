import { describe, expect, it } from "vitest";

import {
  PlcErrorCode,
  createPlcState,
  listFbInstanceSymbols,
} from "../../../src/plc/state/index.js";
import type { PlcResult } from "../../../src/plc/state/index.js";
import { integrationDbConfig } from "../../fixtures/dbDefinitions/integration.js";

const ROOT = "IntegrationTests";
const path = (segment: string) => `${ROOT}.${segment}`;

describe("optimized DB symbols", () => {
  it("lists metadata for FB instances", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });

    const symbols = listFbInstanceSymbols(plc, { instancePath: ROOT });
    const realEntry = symbols.find((entry) => entry.path === path("realValue"));
    expect(realEntry).toBeDefined();
    expect(realEntry?.dataType).toBe("REAL");
    expect(realEntry?.defaultValue).toBe(0);

    const stringEntry = symbols.find((entry) => entry.path === path("status.message"));
    expect(stringEntry?.stringLength).toBe(24);
  });

  it("initializes defaults for nested FB instances", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });
    const pressure = plc.readReal(path("pumpA.pressure"));
    expect(pressure.ok && pressure.value).toBeCloseTo(1.5, 3);
  });

  it("supports case-insensitive symbol lookups", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });
    const write = plc.writeInt("integrationtests.intvalue", 42);
    expect(write.ok).toBe(true);

    const read = plc.readInt("INTEGRATIONTESTS.INTVALUE");
    expect(read.ok && read.value).toBe(42);
  });

  it("supports optional # prefixes and array indexing", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });
    const writeResult = plc.writeInt(`#${path("intArray[1]")}`, 7);
    expect(writeResult.ok).toBe(true);

    const readResult = plc.readInt(path("intArray[1]"));
    expect(readResult.ok && readResult.value).toBe(7);
  });

  it("returns descriptive errors for out-of-range indexes", () => {
    const plc = createPlcState({ optimizedDataBlocks: integrationDbConfig });
    const result: PlcResult<number> = plc.readInt(path("intArray[10]"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PlcErrorCode.UnknownSymbol);
    }
  });
});
