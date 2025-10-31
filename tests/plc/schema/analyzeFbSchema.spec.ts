import { describe, expect, it } from "vitest";

import {
  SchemaAnalysisError,
  analyzeFbSchema,
  buildSchemaFromIr,
} from "../../../src/index.js";
import { parseScl } from "../../../src/parser/parseScl.js";
import { buildIrProgram } from "../../../src/emulator/ir/builder.js";

describe("analyzeFbSchema", () => {
  it("derives scalars, arrays, structs, and FB instances", () => {
    const source = `
      FUNCTION_BLOCK Pump
      VAR
        pressure : REAL := 1.25;
      END_VAR
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Example
      VAR
        flag : BOOL := TRUE;
        values : ARRAY[0..2] OF INT;
        status : STRUCT
          code : INT := 7;
          description : STRING[16];
        END_STRUCT;
        helper : Pump;
      END_VAR
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const registry = analyzeFbSchema(ast);
    const schema = registry.get("example");
    expect(schema).toBeDefined();
    if (!schema) {
      throw new Error("Schema missing");
    }

    const flagField = schema.fields.find((field) => field.kind === "scalar" && field.name === "flag");
    expect(flagField).toMatchObject({ dataType: "BOOL", defaultValue: true });

    const arrayField = schema.fields.find((field) => field.kind === "array" && field.name === "values");
    expect(arrayField).toBeDefined();
    expect((arrayField as { length: number }).length).toBe(3);

    const structField = schema.fields.find((field) => field.kind === "struct" && field.name === "status");
    expect(structField).toBeDefined();
    const structFields = (structField as { fields: readonly unknown[] }).fields;
    const messageField = (structFields as typeof structFields).find(
      (field) => (field as { kind: string; name: string }).name === "description"
    ) as { kind: string; stringLength?: number } | undefined;
    expect(messageField?.kind).toBe("scalar");
    expect(messageField?.stringLength).toBe(16);

    const fbField = schema.fields.find((field) => field.kind === "fb" && field.name === "helper");
    expect(fbField).toMatchObject({ type: "Pump" });
  });

  it("defaults STRING length to 254 when unspecified", () => {
    const source = `
      FUNCTION_BLOCK Example
      VAR
        message : STRING;
      END_VAR
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const registry = analyzeFbSchema(ast);
    const schema = registry.get("example");
    expect(schema).toBeDefined();
    const stringField = schema?.fields[0];
    expect(stringField).toMatchObject({ kind: "scalar", stringLength: 254 });
  });

  it("throws on multi-dimensional arrays", () => {
    const source = `
      FUNCTION_BLOCK Example
      VAR
        values : ARRAY[0..1,0..2] OF INT;
      END_VAR
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    expect(() => analyzeFbSchema(ast)).toThrow(SchemaAnalysisError);
  });
});

describe("buildSchemaFromIr", () => {
  it("produces scalar schema entries with defaults", () => {
    const source = `
      FUNCTION_BLOCK Example
      VAR
        count : INT := 5;
        label : STRING;
      END_VAR
      BEGIN
        count := count + 1;
      END_FUNCTION_BLOCK
    `;

    const ast = parseScl(source);
    const ir = buildIrProgram(ast);
    const schema = buildSchemaFromIr(ir, { typeName: "Example" });

    expect(schema.name).toBe("Example");
    const countField = schema.fields.find((field) => field.kind === "scalar" && field.name === "count");
    expect(countField).toMatchObject({ dataType: "INT", defaultValue: 5 });
    const labelField = schema.fields.find((field) => field.kind === "scalar" && field.name === "label");
    expect(labelField).toMatchObject({ dataType: "STRING", stringLength: 254 });
  });
});
