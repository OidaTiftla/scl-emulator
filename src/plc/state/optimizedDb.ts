import {
  PlcErrorCode,
  createError,
  fail,
  ok,
  type FbSymbolDatapoint,
  type OptimizedDbArrayFieldDefinition,
  type OptimizedDbConfiguration,
  type OptimizedDbFieldDefinition,
  type OptimizedDbFbFieldDefinition,
  type OptimizedDbScalarFieldDefinition,
  type OptimizedDbStructFieldDefinition,
  type OptimizedFbInstanceDefinition,
  type OptimizedFbTypeDefinition,
  type PlcResult,
  type PlcValueType,
} from "./types.js";

export interface SymbolDescriptor {
  readonly canonicalPath: string;
  readonly normalizedPath: string;
  readonly declarationPath: string;
  readonly fieldName: string;
  readonly dataType: PlcValueType;
  readonly stringLength?: number;
  readonly defaultValue: unknown;
  readonly fbInstancePath: string;
  readonly fbType: string;
}

export interface SymbolReadResult {
  readonly descriptor: SymbolDescriptor;
  readonly value: unknown;
}

export interface SymbolWriteResult {
  readonly descriptor: SymbolDescriptor;
  readonly previous: unknown;
  readonly current: unknown;
  readonly changed: boolean;
}

export interface SymbolFilter {
  readonly instancePath?: string;
  readonly type?: string;
}

export interface FbInstanceInfo {
  readonly canonicalPath: string;
  readonly normalizedPath: string;
  readonly typeName: string;
}

interface TypeInfo {
  readonly name: string;
  readonly definition: OptimizedDbFieldDefinition[];
}

interface InstanceRegistryEntry extends FbInstanceInfo {}

interface ArrayInfo {
  readonly canonicalPath: string;
  readonly normalizedPath: string;
  readonly length: number;
}

type FieldScope = Set<string>;

export class OptimizedDbStore {
  private readonly descriptors = new Map<string, SymbolDescriptor>();

  private readonly values = new Map<string, unknown>();

  private readonly instances = new Map<string, InstanceRegistryEntry>();

  private readonly arrays = new Map<string, ArrayInfo>();

  private readonly typeDefinitions = new Map<string, TypeInfo>();

  constructor(config?: OptimizedDbConfiguration) {
    if (!config) {
      return;
    }

    this.loadTypes(config.types ?? {});
    this.loadInstances(config.instances ?? []);
  }

  get hasSymbols(): boolean {
    return this.descriptors.size > 0;
  }

  resolveInstance(path: string): FbInstanceInfo | undefined {
    return this.instances.get(normalizeLookupKey(path));
  }

  read(path: string, expectedType: PlcValueType): PlcResult<SymbolReadResult> {
    const descriptorResult = this.describe(path, expectedType);
    if (!descriptorResult.ok) {
      return descriptorResult;
    }
    const descriptor = descriptorResult.value;
    const stored = this.values.get(descriptor.normalizedPath);
    return ok({ descriptor, value: stored });
  }

  write(
    path: string,
    expectedType: PlcValueType,
    rawValue: unknown
  ): PlcResult<SymbolWriteResult> {
    const descriptorResult = this.describe(path, expectedType);
    if (!descriptorResult.ok) {
      return descriptorResult;
    }
    const descriptor = descriptorResult.value;
    const coercedResult = coerceScalarValue(
      descriptor.dataType,
      rawValue,
      descriptor.stringLength,
      path
    );
    if (!coercedResult.ok) {
      return coercedResult;
    }
    const previous = this.values.get(descriptor.normalizedPath);
    const current = coercedResult.value;
    const changed = !valueEquals(previous, current);
    if (changed) {
      this.values.set(descriptor.normalizedPath, current);
    }
    return ok({ descriptor, previous, current, changed });
  }

  describe(path: string, expectedType: PlcValueType): PlcResult<SymbolDescriptor> {
    const descriptorResult = this.resolveDescriptor(path);
    if (!descriptorResult.ok) {
      return descriptorResult;
    }
    const descriptor = descriptorResult.value;
    if (descriptor.dataType !== expectedType) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          `Symbol "${descriptor.declarationPath}" is declared as ${descriptor.dataType}`,
          path,
          { expected: expectedType, actual: descriptor.dataType }
        )
      );
    }
    return ok(descriptor);
  }

  snapshot(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const descriptor of this.descriptors.values()) {
      payload[descriptor.canonicalPath] = this.values.get(descriptor.normalizedPath);
    }
    return payload;
  }

  listSymbols(filter?: SymbolFilter): FbSymbolDatapoint[] {
    const entries = Array.from(this.descriptors.values()).sort((a, b) =>
      a.canonicalPath.localeCompare(b.canonicalPath)
    );
    return entries
      .filter((descriptor) => {
        if (!filter) {
          return true;
        }
        if (filter.instancePath) {
          const normalizedInstance = normalizeLookupKey(filter.instancePath);
          if (normalizeLookupKey(descriptor.fbInstancePath) !== normalizedInstance) {
            return false;
          }
        }
        if (filter.type) {
          if (descriptor.fbType.toLowerCase() !== filter.type.toLowerCase()) {
            return false;
          }
        }
        return true;
      })
      .map((descriptor) => ({
        path: descriptor.canonicalPath,
        fieldName: descriptor.fieldName,
        fbInstancePath: descriptor.fbInstancePath,
        fbType: descriptor.fbType,
        dataType: descriptor.dataType,
        declarationPath: descriptor.declarationPath,
        defaultValue: descriptor.defaultValue,
        stringLength: descriptor.stringLength,
        currentValue: this.values.get(descriptor.normalizedPath),
      }));
  }

  private resolveDescriptor(path: string): PlcResult<SymbolDescriptor> {
    const tokensResult = tokenizePath(path);
    if (!tokensResult.ok) {
      return tokensResult;
    }
    const tokens = tokensResult.value;
    if (tokens.length === 0) {
      return fail(
        createError(
          PlcErrorCode.InvalidSymbolPath,
          "Symbol path must include at least one segment",
          path
        )
      );
    }
    const normalizedKey = normalizeTokens(tokens);
    const descriptor = this.descriptors.get(normalizedKey);
    if (descriptor) {
      return ok(descriptor);
    }

    return fail(this.describeMissingSymbol(path, tokens));
  }

  private describeMissingSymbol(
    path: string,
    tokens: readonly string[]
  ): ReturnType<typeof createError> {
    let currentNormalized = "";
    let deepestInstance: InstanceRegistryEntry | undefined;
    let arrayContext: ArrayInfo | undefined;
    let arrayIndex: number | undefined;

    for (const token of tokens) {
      const normalizedSegment = normalizeSegment(token);
      currentNormalized = currentNormalized
        ? `${currentNormalized}.${normalizedSegment}`
        : normalizedSegment;
      const instance = this.instances.get(currentNormalized);
      if (instance) {
        deepestInstance = instance;
      }
      const arrayKey = extractArrayBase(normalizedSegment);
      if (arrayKey) {
        const arrayNormalized = currentNormalized.slice(
          0,
          currentNormalized.length - (normalizedSegment.length - arrayKey.length)
        );
        const arrayInfo = this.arrays.get(arrayNormalized);
        if (arrayInfo) {
          arrayContext = arrayInfo;
          arrayIndex = extractArrayIndex(normalizedSegment);
        }
      }
    }

    if (!deepestInstance) {
      return createError(
        PlcErrorCode.UnknownFbInstance,
        `FB instance "${tokens[0]}" is not registered`,
        path
      );
    }

    if (arrayContext && arrayIndex !== undefined) {
      if (arrayIndex < 0 || arrayIndex >= arrayContext.length) {
        return createError(
          PlcErrorCode.UnknownSymbol,
          `Array index ${arrayIndex} is outside declared range for "${arrayContext.canonicalPath}"`,
          path,
          {
            instance: deepestInstance.canonicalPath,
            fbType: deepestInstance.typeName,
            declaredLength: arrayContext.length,
          }
        );
      }
    }

    return createError(
      PlcErrorCode.UnknownSymbol,
      `Symbol "${path}" does not exist on FB instance ${deepestInstance.canonicalPath} (${deepestInstance.typeName})`,
      path,
      {
        instance: deepestInstance.canonicalPath,
        fbType: deepestInstance.typeName,
      }
    );
  }

  private loadTypes(types: Record<string, OptimizedFbTypeDefinition>): void {
    for (const [name, value] of Object.entries(types)) {
      const validatedName = validateIdentifier(name, "FB type");
      const normalized = validatedName.toLowerCase();
      if (this.typeDefinitions.has(normalized)) {
        throw new RangeError(`Duplicate FB type definition "${validatedName}"`);
      }
      this.typeDefinitions.set(normalized, {
        name: validatedName,
        definition: Array.isArray(value.fields) ? value.fields : [],
      });
    }
  }

  private loadInstances(instances: OptimizedFbInstanceDefinition[]): void {
    if (instances.length === 0) {
      return;
    }
    for (const instance of instances) {
      const name = validateIdentifier(instance.name, "FB instance");
      assertNoNumericDbPrefix(name, "FB instance");
      const typeName = instance.type;
      const typeInfo = this.resolveType(typeName);
      const normalizedPath = normalizeCanonicalPath(name);

      if (this.instances.has(normalizedPath)) {
        throw new RangeError(`Duplicate FB instance "${name}"`);
      }

      const registryEntry: InstanceRegistryEntry = {
        canonicalPath: name,
        normalizedPath,
        typeName: typeInfo.name,
      };
      this.instances.set(normalizedPath, registryEntry);
      this.expandType(typeInfo, name, name, new Set<string>());
    }
  }

  private expandType(
    typeInfo: TypeInfo,
    instancePath: string,
    parentPath: string,
    typeStack: Set<string>
  ): void {
    const normalizedType = typeInfo.name.toLowerCase();
    if (typeStack.has(normalizedType)) {
      throw new RangeError(
        `Recursive FB type reference detected at "${instancePath}" for type "${typeInfo.name}"`
      );
    }
    typeStack.add(normalizedType);

    this.expandFields(
      typeInfo.definition,
      parentPath,
      instancePath,
      typeInfo.name,
      typeStack
    );

    typeStack.delete(normalizedType);
  }

  private expandFields(
    fields: OptimizedDbFieldDefinition[],
    parentPath: string,
    instancePath: string,
    instanceType: string,
    typeStack: Set<string>
  ): void {
    const scope: FieldScope = new Set<string>();
    for (const field of fields) {
      switch (field.kind) {
        case "scalar":
          this.registerScalar(
            field,
            parentPath,
            instancePath,
            instanceType,
            scope
          );
          break;
        case "struct":
          this.registerStruct(
            field,
            parentPath,
            instancePath,
            instanceType,
            typeStack,
            scope
          );
          break;
        case "array":
          this.registerArray(
            field,
            parentPath,
            instancePath,
            instanceType,
            typeStack,
            scope
          );
          break;
        case "fb":
          this.registerNestedInstance(
            field,
            parentPath,
            instancePath,
            typeStack,
            scope
          );
          break;
        default:
          throw new RangeError(`Unsupported field kind ${(field as { kind: string }).kind}`);
      }
    }
  }

  private registerScalar(
    field: OptimizedDbScalarFieldDefinition,
    parentPath: string,
    instancePath: string,
    instanceType: string,
    scope: FieldScope
  ): void {
    const name = validateIdentifier(field.name, "field");
    const normalizedName = name.toLowerCase();
    if (scope.has(normalizedName)) {
      throw new RangeError(`Duplicate field "${name}" under "${parentPath}"`);
    }
    scope.add(normalizedName);

    const canonicalPath = `${parentPath}.${name}`;
    const normalizedPath = normalizeCanonicalPath(canonicalPath);
    if (this.descriptors.has(normalizedPath)) {
      throw new RangeError(`Duplicate symbol path "${canonicalPath}"`);
    }

    const stringLength =
      field.dataType === "STRING" ? validateStringLength(field, canonicalPath) : undefined;

    const defaultValue =
      field.defaultValue !== undefined
        ? requireScalarDefault(field.dataType, field.defaultValue, stringLength, canonicalPath)
        : defaultForType(field.dataType, stringLength);

    const descriptor: SymbolDescriptor = {
      canonicalPath,
      normalizedPath,
      declarationPath: canonicalPath,
      fieldName: extractFieldName(canonicalPath),
      dataType: field.dataType,
      stringLength,
      defaultValue,
      fbInstancePath: instancePath,
      fbType: instanceType,
    };
    this.descriptors.set(normalizedPath, descriptor);
    this.values.set(normalizedPath, defaultValue);
  }

  private registerStruct(
    field: OptimizedDbStructFieldDefinition,
    parentPath: string,
    instancePath: string,
    instanceType: string,
    typeStack: Set<string>,
    scope: FieldScope
  ): void {
    const name = validateIdentifier(field.name, "field");
    const normalizedName = name.toLowerCase();
    if (scope.has(normalizedName)) {
      throw new RangeError(`Duplicate field "${name}" under "${parentPath}"`);
    }
    scope.add(normalizedName);

    const canonicalPath = `${parentPath}.${name}`;
    this.expandFields(field.fields ?? [], canonicalPath, instancePath, instanceType, typeStack);
  }

  private registerArray(
    field: OptimizedDbArrayFieldDefinition,
    parentPath: string,
    instancePath: string,
    instanceType: string,
    typeStack: Set<string>,
    scope: FieldScope
  ): void {
    const name = validateIdentifier(field.name, "field");
    const normalizedName = name.toLowerCase();
    if (scope.has(normalizedName)) {
      throw new RangeError(`Duplicate field "${name}" under "${parentPath}"`);
    }
    scope.add(normalizedName);

    if (!Number.isInteger(field.length) || field.length < 0) {
      throw new RangeError(`Array "${name}" under "${parentPath}" must declare a non-negative integer length`);
    }

    const canonicalPath = `${parentPath}.${name}`;
    const normalizedArrayPath = normalizeCanonicalPath(canonicalPath);
    if (this.arrays.has(normalizedArrayPath)) {
      throw new RangeError(`Duplicate array declaration at "${canonicalPath}"`);
    }
    this.arrays.set(normalizedArrayPath, {
      canonicalPath,
      normalizedPath: normalizedArrayPath,
      length: field.length,
    });

    for (let index = 0; index < field.length; index += 1) {
      const elementPath = `${canonicalPath}[${index}]`;
      switch (field.element.kind) {
        case "scalar":
          this.registerScalarElement(
            field.element,
            elementPath,
            instancePath,
            instanceType
          );
          break;
        case "struct":
          this.expandFields(
            field.element.fields ?? [],
            elementPath,
            instancePath,
            instanceType,
            typeStack
          );
          break;
        case "fb":
          this.registerArrayFbInstance(
            field.element,
            elementPath,
            typeStack
          );
          break;
        case "array":
          this.registerArray(
            field.element,
            elementPath,
            instancePath,
            instanceType,
            typeStack,
            new Set<string>()
          );
          break;
        default:
          throw new RangeError(
            `Unsupported array element kind ${(field.element as { kind: string }).kind}`
          );
      }
    }
  }

  private registerNestedInstance(
    field: OptimizedDbFbFieldDefinition,
    parentPath: string,
    instancePath: string,
    typeStack: Set<string>,
    scope: FieldScope
  ): void {
    const name = validateIdentifier(field.name, "field");
    assertNoNumericDbPrefix(name, "FB instance");
    const normalizedName = name.toLowerCase();
    if (scope.has(normalizedName)) {
      throw new RangeError(`Duplicate field "${name}" under "${parentPath}"`);
    }
    scope.add(normalizedName);

    const childInstancePath = `${parentPath}.${name}`;
    const typeInfo = this.resolveType(field.type);
    const normalizedPath = normalizeCanonicalPath(childInstancePath);

    if (this.instances.has(normalizedPath)) {
      throw new RangeError(`Duplicate FB instance "${childInstancePath}"`);
    }
    this.instances.set(normalizedPath, {
      canonicalPath: childInstancePath,
      normalizedPath,
      typeName: typeInfo.name,
    });

    this.expandType(typeInfo, childInstancePath, childInstancePath, typeStack);
  }

  private registerScalarElement(
    element: OptimizedDbScalarFieldDefinition,
    canonicalPath: string,
    instancePath: string,
    instanceType: string
  ): void {
    const normalizedPath = normalizeCanonicalPath(canonicalPath);
    if (this.descriptors.has(normalizedPath)) {
      throw new RangeError(`Duplicate symbol path "${canonicalPath}"`);
    }
    const stringLength =
      element.dataType === "STRING"
        ? validateStringLength(element, canonicalPath)
        : undefined;
    const defaultValue =
      element.defaultValue !== undefined
        ? requireScalarDefault(
            element.dataType,
            element.defaultValue,
            stringLength,
            canonicalPath
          )
        : defaultForType(element.dataType, stringLength);
    const descriptor: SymbolDescriptor = {
      canonicalPath,
      normalizedPath,
      declarationPath: canonicalPath,
      fieldName: extractFieldName(canonicalPath),
      dataType: element.dataType,
      stringLength,
      defaultValue,
      fbInstancePath: instancePath,
      fbType: instanceType,
    };
    this.descriptors.set(normalizedPath, descriptor);
    this.values.set(normalizedPath, defaultValue);
  }

  private registerArrayFbInstance(
    element: OptimizedDbFbFieldDefinition,
    elementPath: string,
    typeStack: Set<string>
  ): void {
    const typeInfo = this.resolveType(element.type);
    const normalizedPath = normalizeCanonicalPath(elementPath);
    if (this.instances.has(normalizedPath)) {
      throw new RangeError(`Duplicate FB instance "${elementPath}"`);
    }
    this.instances.set(normalizedPath, {
      canonicalPath: elementPath,
      normalizedPath,
      typeName: typeInfo.name,
    });
    this.expandType(typeInfo, elementPath, elementPath, typeStack);
  }

  private resolveType(typeName: string): TypeInfo {
    const validatedType = validateIdentifier(typeName, "FB type reference");
    const normalized = validatedType.toLowerCase();
    const typeInfo = this.typeDefinitions.get(normalized);
    if (!typeInfo) {
      throw new RangeError(`Unknown FB type "${typeName}"`);
    }
    return typeInfo;
  }
}

function tokenizePath(path: string): PlcResult<string[]> {
  const trimmed = path.trim();
  if (!trimmed) {
    return fail(
      createError(PlcErrorCode.InvalidSymbolPath, "Symbol path must be non-empty", path)
    );
  }
  const sanitized = trimmed.replace(/\s+/g, "").replace(/#/g, "");
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of sanitized) {
    if (char === "." && depth === 0) {
      if (!current) {
        return fail(
          createError(
            PlcErrorCode.InvalidSymbolPath,
            "Symbol path cannot contain empty segments",
            path
          )
        );
      }
      tokens.push(current);
      current = "";
      continue;
    }
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth < 0) {
        return fail(
          createError(
            PlcErrorCode.InvalidSymbolPath,
            "Mismatched brackets in symbol path",
            path
          )
        );
      }
    }
    current += char;
  }
  if (depth !== 0) {
    return fail(
      createError(
        PlcErrorCode.InvalidSymbolPath,
        "Mismatched brackets in symbol path",
        path
      )
    );
  }
  if (!current) {
    return fail(
      createError(
        PlcErrorCode.InvalidSymbolPath,
        "Symbol path cannot end with a delimiter",
        path
      )
    );
  }
  tokens.push(current);
  return ok(tokens);
}

function normalizeTokens(tokens: readonly string[]): string {
  return tokens.map(normalizeSegment).join(".");
}

function normalizeSegment(segment: string): string {
  const match = /^([^[]*)(.*)$/.exec(segment);
  if (!match) {
    return segment.toLowerCase();
  }
  const [, head, tail] = match;
  return head.toLowerCase() + tail;
}

function normalizeCanonicalPath(path: string): string {
  const tokens = path.split(".").filter(Boolean);
  return tokens.map(normalizeSegment).join(".");
}

function normalizeLookupKey(path: string): string {
  const tokensResult = tokenizePath(path);
  if (!tokensResult.ok) {
    return "";
  }
  return normalizeTokens(tokensResult.value);
}

function validateIdentifier(value: string, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new RangeError(`${label} name must be non-empty`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new RangeError(
      `${label} "${value}" must match /[A-Za-z_][A-Za-z0-9_]*/`
    );
  }
  return trimmed;
}

function assertNoNumericDbPrefix(name: string, label: string): void {
  if (/^DB\d+/i.test(name)) {
    throw new RangeError(
      `${label} "${name}" cannot start with a numeric DB prefix`
    );
  }
}

function validateStringLength(
  field: OptimizedDbScalarFieldDefinition,
  path: string
): number {
  if (field.stringLength === undefined) {
    throw new RangeError(`STRING field at "${path}" must declare stringLength`);
  }
  if (
    !Number.isInteger(field.stringLength) ||
    field.stringLength <= 0 ||
    field.stringLength > 254
  ) {
    throw new RangeError(
      `STRING field at "${path}" must declare stringLength between 1 and 254`
    );
  }
  return field.stringLength;
}

function requireScalarDefault(
  type: PlcValueType,
  value: unknown,
  stringLength: number | undefined,
  path: string
): unknown {
  const coerced = coerceScalarValue(type, value, stringLength, path);
  if (!coerced.ok) {
    throw new RangeError(
      `Invalid default value for "${path}": ${coerced.error.message}`
    );
  }
  return coerced.value;
}

function coerceScalarValue(
  type: PlcValueType,
  value: unknown,
  stringLength: number | undefined,
  address: string
): PlcResult<unknown> {
  switch (type) {
    case "BOOL":
      if (typeof value !== "boolean") {
        return fail(
          createError(
            PlcErrorCode.TypeMismatch,
            "BOOL values must be boolean",
            address,
            { value }
          )
        );
      }
      return ok(value);
    case "BYTE":
      return coerceInteger(value, 0, 0xff, address, type);
    case "WORD":
      return coerceInteger(value, 0, 0xffff, address, type);
    case "DWORD":
      return coerceInteger(value, 0, 0xffffffff, address, type);
    case "SINT":
      return coerceInteger(value, -128, 127, address, type);
    case "INT":
      return coerceInteger(value, -32768, 32767, address, type);
    case "DINT":
      return coerceInteger(value, -2147483648, 2147483647, address, type);
    case "LINT":
      return coerceBigInt(value, address);
    case "REAL":
    case "LREAL":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail(
          createError(
            PlcErrorCode.TypeMismatch,
            `${type} values must be finite numbers`,
            address,
            { value }
          )
        );
      }
      return ok(value);
    case "TIME":
    case "TOD":
      return coerceInteger(value, 0, 0xffffffff, address, type);
    case "DATE":
      return coerceInteger(value, 0, 0xffff, address, type);
    case "STRING":
      if (typeof value !== "string") {
        return fail(
          createError(
            PlcErrorCode.TypeMismatch,
            "STRING values must be strings",
            address,
            { value }
          )
        );
      }
      if (stringLength === undefined) {
        return fail(
          createError(
            PlcErrorCode.InvalidConfig,
            "STRING symbol is missing declared stringLength",
            address
          )
        );
      }
      if (value.length > stringLength) {
        return fail(
          createError(
            PlcErrorCode.OutOfRange,
            `STRING value exceeds declared length ${stringLength}`,
            address,
            { length: value.length, maxLength: stringLength }
          )
        );
      }
      return ok(value);
    default:
      return fail(
        createError(
          PlcErrorCode.InvalidConfig,
          `Unsupported data type "${type}"`,
          address
        )
      );
  }
}

function coerceInteger(
  value: unknown,
  min: number,
  max: number,
  address: string,
  type: string
): PlcResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(
      createError(
        PlcErrorCode.TypeMismatch,
        `${type} values must be finite numbers`,
        address,
        { value }
      )
    );
  }
  const truncated = Math.trunc(value);
  if (truncated < min || truncated > max) {
    return fail(
      createError(
        PlcErrorCode.OutOfRange,
        `${type} value ${truncated} falls outside range [${min}, ${max}]`,
        address,
        { value: truncated, min, max }
      )
    );
  }
  return ok(truncated);
}

function coerceBigInt(value: unknown, address: string): PlcResult<bigint> {
  if (typeof value === "bigint") {
    return ok(value);
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return ok(BigInt(value));
  }
  return fail(
    createError(
      PlcErrorCode.TypeMismatch,
      "LINT values must be bigint or integer number",
      address,
      { value }
    )
  );
}

function defaultForType(
  type: PlcValueType,
  stringLength?: number
): unknown {
  switch (type) {
    case "BOOL":
      return false;
    case "BYTE":
    case "WORD":
    case "DWORD":
    case "SINT":
    case "INT":
    case "DINT":
    case "REAL":
    case "LREAL":
    case "TIME":
    case "DATE":
    case "TOD":
      return 0;
    case "LINT":
      return 0n;
    case "STRING":
      if (stringLength === undefined) {
        throw new RangeError("STRING symbols require stringLength");
      }
      return "";
    default:
      throw new RangeError(`Unsupported data type "${type}"`);
  }
}

function extractFieldName(path: string): string {
  const segments = path.split(".");
  return segments[segments.length - 1] ?? path;
}

function extractArrayBase(segment: string): string | undefined {
  const match = /^([^[]+)/.exec(segment);
  if (!match) {
    return undefined;
  }
  return match[1];
}

function extractArrayIndex(segment: string): number | undefined {
  const match = /\[(\d+)\](?:\[.*\])*$/.exec(segment);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (typeof a === "bigint" || typeof b === "bigint") {
    return a === b;
  }
  return Object.is(a, b);
}
