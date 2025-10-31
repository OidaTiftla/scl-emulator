import type {
  FbArrayFieldSchema,
  FbFieldSchema,
  FbInstanceFieldSchema,
  FbScalarFieldSchema,
  FbStructFieldSchema,
  FbTypeSchema,
  FbTypeSchemaRegistry,
  FbTypeSchemaRegistryInput,
} from "../state/types.js";

export function normalizeSchemaRegistry(
  input: FbTypeSchemaRegistryInput | undefined
): Map<string, FbTypeSchema> {
  if (!input) {
    throw new RangeError("optimizedDataBlocks.schema must be provided");
  }

  if (isMapLike(input)) {
    return cloneRegistry(input);
  }

  return cloneRegistry(new Map<string, FbTypeSchema>(Object.entries(input)));
}

export function mergeSchemaRegistries(
  base: FbTypeSchemaRegistry | Map<string, FbTypeSchema>,
  additions: Map<string, FbTypeSchema>
): Map<string, FbTypeSchema> {
  const merged = new Map<string, FbTypeSchema>();
  for (const [key, schema] of cloneRegistry(base).entries()) {
    merged.set(key, schema);
  }
  for (const [key, schema] of additions.entries()) {
    if (merged.has(key)) {
      throw new RangeError(`Duplicate FB type definition "${schema.name}"`);
    }
    merged.set(key, schema);
  }
  return merged;
}

function cloneRegistry(
  source: FbTypeSchemaRegistry | Map<string, FbTypeSchema>
): Map<string, FbTypeSchema> {
  const registry = new Map<string, FbTypeSchema>();
  for (const [key, schema] of source.entries()) {
    const cloned = cloneSchema(schema, key);
    const normalized = cloned.name.toLowerCase();
    if (registry.has(normalized)) {
      throw new RangeError(`Duplicate FB type definition "${cloned.name}"`);
    }
    registry.set(normalized, cloned);
  }
  return registry;
}

function cloneSchema(schema: FbTypeSchema, fallbackName?: string): FbTypeSchema {
  const name = normalizeName(schema, fallbackName);
  return {
    name,
    fields: Array.isArray(schema.fields)
      ? schema.fields.map(cloneField)
      : [],
  };
}

function normalizeName(schema: FbTypeSchema, fallbackName?: string): string {
  const declared = typeof schema.name === "string" ? schema.name.trim() : "";
  const fallback = typeof fallbackName === "string" ? fallbackName.trim() : "";
  const name = declared || fallback;
  if (!name) {
    throw new RangeError("FB type schema is missing a name");
  }
  return name;
}

function cloneField(field: FbFieldSchema): FbFieldSchema {
  switch (field.kind) {
    case "scalar":
      return cloneScalar(field);
    case "struct":
      return cloneStruct(field);
    case "array":
      return cloneArray(field);
    case "fb":
      return cloneInstance(field);
    default:
      throw new RangeError(`Unsupported field kind ${(field as { kind?: string }).kind}`);
  }
}

function cloneScalar(field: FbScalarFieldSchema): FbScalarFieldSchema {
  return {
    kind: "scalar",
    name: field.name,
    dataType: field.dataType,
    defaultValue: field.defaultValue,
    stringLength: field.stringLength,
  };
}

function cloneStruct(field: FbStructFieldSchema): FbStructFieldSchema {
  return {
    kind: "struct",
    name: field.name,
    fields: Array.isArray(field.fields) ? field.fields.map(cloneField) : [],
  };
}

function cloneArray(field: FbArrayFieldSchema): FbArrayFieldSchema {
  return {
    kind: "array",
    name: field.name,
    length: field.length,
    element: cloneField(field.element),
  };
}

function cloneInstance(field: FbInstanceFieldSchema): FbInstanceFieldSchema {
  return {
    kind: "fb",
    name: field.name,
    type: field.type,
  };
}

function isMapLike(value: unknown): value is Map<string, FbTypeSchema> {
  return value instanceof Map;
}
