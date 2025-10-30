import { PlcErrorCode, createError, fail, ok } from "./types.js";
import type { PlcAddressDescriptor, PlcAddressNotation, PlcResult } from "./types.js";

export interface ParsedAddress extends PlcAddressDescriptor {
  notation: PlcAddressNotation;
}

export interface ByteAddressParseOptions {
  /** Expected byte length for the data type. */
  byteLength: number;
  /** Optional alignment requirement in bytes (e.g., 2 for WORD, 4 for DWORD). */
  alignment?: number;
}

const DB_PATTERN = /^DB(\d+)\.(DBX|DBB|DBW|DBD)(\d+)(?:\.(\d))?$/i;
const BIT_PATTERN = /^([IQM])(\d+)\.(\d)$/i;
const BYTE_PATTERN = /^([IQM])(B|W|D)?(\d+)$/i;

const notationSizes: Record<PlcAddressNotation, number> = {
  BIT: 0,
  BYTE: 1,
  WORD: 2,
  DWORD: 4,
};

function parseCore(address: string): PlcResult<ParsedAddress> {
  const trimmed = address.trim();
  if (!trimmed) {
    return fail(
      createError(PlcErrorCode.InvalidAddress, "Address must be non-empty", address)
    );
  }

  const dbMatch = trimmed.match(DB_PATTERN);
  if (dbMatch) {
    const [, dbNumRaw, tokenRaw, byteRaw, bitRaw] = dbMatch;
    const token = tokenRaw.toUpperCase();
    const byteOffset = Number.parseInt(byteRaw, 10);
    const region: PlcAddressDescriptor["region"] = {
      area: "DB",
      dbNumber: Number.parseInt(dbNumRaw, 10),
    };

    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      return fail(
        createError(
          PlcErrorCode.InvalidAddress,
          "Data block byte offset must be a non-negative integer",
          address,
          { byteOffset }
        )
      );
    }

    switch (token) {
      case "DBX": {
        const bitOffset = bitRaw === undefined ? 0 : Number.parseInt(bitRaw, 10);
        if (!Number.isInteger(bitOffset) || bitOffset < 0 || bitOffset > 7) {
          return fail(
            createError(
              PlcErrorCode.InvalidAddress,
              "Bit offset must be between 0 and 7",
              address,
              { bitOffset }
            )
          );
        }
        return ok({ region, byteOffset, bitOffset, notation: "BIT" });
      }
      case "DBB": {
        if (bitRaw !== undefined) {
          return fail(
            createError(
              PlcErrorCode.InvalidAddress,
              "Byte address cannot specify a bit offset",
              address
            )
          );
        }
        return ok({ region, byteOffset, notation: "BYTE" });
      }
      case "DBW": {
        if (bitRaw !== undefined) {
          return fail(
            createError(
              PlcErrorCode.InvalidAddress,
              "Word address cannot specify a bit offset",
              address
            )
          );
        }
        return ok({ region, byteOffset, notation: "WORD" });
      }
      case "DBD": {
        if (bitRaw !== undefined) {
          return fail(
            createError(
              PlcErrorCode.InvalidAddress,
              "Double-word address cannot specify a bit offset",
              address
            )
          );
        }
        return ok({ region, byteOffset, notation: "DWORD" });
      }
      default:
        return fail(
          createError(
            PlcErrorCode.InvalidAddress,
            "Unsupported data block token",
            address,
            { token }
          )
        );
    }
  }

  const bitMatch = trimmed.match(BIT_PATTERN);
  if (bitMatch) {
    const [, areaRaw, byteRaw, bitRaw] = bitMatch;
    const byteOffset = Number.parseInt(byteRaw, 10);
    const bitOffset = Number.parseInt(bitRaw, 10);
    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      return fail(
        createError(
          PlcErrorCode.InvalidAddress,
          "Byte offset must be a non-negative integer",
          address,
          { byteOffset }
        )
      );
    }
    if (!Number.isInteger(bitOffset) || bitOffset < 0 || bitOffset > 7) {
      return fail(
        createError(
          PlcErrorCode.InvalidAddress,
          "Bit offset must be between 0 and 7",
          address,
          { bitOffset }
        )
      );
    }
    return ok({
      region: { area: areaRaw.toUpperCase() as "I" | "Q" | "M" },
      byteOffset,
      bitOffset,
      notation: "BIT",
    });
  }

  const byteMatch = trimmed.match(BYTE_PATTERN);
  if (byteMatch) {
    const [, areaRaw, sizeSpecifierRaw, byteRaw] = byteMatch;
    const area = areaRaw.toUpperCase() as "I" | "Q" | "M";
    const byteOffset = Number.parseInt(byteRaw, 10);
    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      return fail(
        createError(
          PlcErrorCode.InvalidAddress,
          "Byte offset must be a non-negative integer",
          address,
          { byteOffset }
        )
      );
    }
    const sizeSpecifier = sizeSpecifierRaw?.toUpperCase() ?? "B";
    const notation: PlcAddressNotation =
      sizeSpecifier === "W"
        ? "WORD"
        : sizeSpecifier === "D"
          ? "DWORD"
          : "BYTE";

    return ok({ region: { area }, byteOffset, notation });
  }

  return fail(
    createError(PlcErrorCode.InvalidAddress, "Unsupported address format", address)
  );
}

export function parseBitAddress(address: string): PlcResult<ParsedAddress> {
  const parsed = parseCore(address);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.notation !== "BIT" || parsed.value.bitOffset === undefined) {
    return fail(
      createError(
        PlcErrorCode.TypeMismatch,
        "Expected a bit address (e.g., I0.0 or DB1.DBX0.1)",
        address
      )
    );
  }
  return parsed;
}

export function parseByteAddress(
  address: string,
  options: ByteAddressParseOptions
): PlcResult<ParsedAddress> {
  const parsed = parseCore(address);
  if (!parsed.ok) {
    return parsed;
  }

  const { byteLength, alignment } = options;
  const descriptor = parsed.value;

  if (descriptor.notation === "BIT") {
    if (descriptor.bitOffset && descriptor.bitOffset !== 0) {
      return fail(
        createError(
          PlcErrorCode.AlignmentError,
          "Multi-byte access requires bit offset 0",
          address,
          { bitOffset: descriptor.bitOffset }
        )
      );
    }
    // Treat as aligned DBX/Ix address referencing full bytes
    descriptor.bitOffset = 0;
  } else {
    const expectedSize = notationSizes[descriptor.notation];
    if (expectedSize !== 0 && expectedSize !== byteLength) {
      return fail(
        createError(
          PlcErrorCode.TypeMismatch,
          `Address token implies ${expectedSize} byte(s) but ${byteLength} required`,
          address,
          { expectedSize, byteLength }
        )
      );
    }
  }

  if (alignment && descriptor.byteOffset % alignment !== 0) {
    return fail(
      createError(
        PlcErrorCode.AlignmentError,
        `Address must be aligned to ${alignment} byte(s)` ,
        address,
        { alignment }
      )
    );
  }

  return ok(descriptor);
}

export function inspectAddress(address: string): PlcResult<ParsedAddress> {
  return parseCore(address);
}
