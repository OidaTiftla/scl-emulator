# PLC State Simulator

The PLC state simulator provides an in-memory model of Siemens S7 style memory areas so tools and test harnesses can inspect and manipulate controller data without connecting to hardware. This document explains addressing, supported operations, and common usage patterns.

## Memory Areas and Configuration

`createPlcState` accepts a `PlcStateConfig` describing the byte-length of each region along with optimized data block definitions:

```ts
import { createPlcState } from "@scl-emulator/core";

const plc = createPlcState({
  inputs: { size: 16 },   // `I` area: process inputs
  outputs: { size: 16 },  // `Q` area: process outputs
  flags: { size: 32 },    // `M` area: internal markers
  optimizedDataBlocks: {
    instances: [{ name: "Mixer", type: "MixerState" }],
    types: {
      MixerState: {
        fields: [
          { kind: "scalar", name: "isRunning", dataType: "BOOL" },
          { kind: "scalar", name: "rpm", dataType: "REAL" },
          {
            kind: "array",
            name: "temperatures",
            length: 3,
            element: { kind: "scalar", name: "value", dataType: "REAL" },
          },
        ],
      },
    },
  },
});
```

All regions use big-endian layout to mirror S7 controllers. A configured area may be omitted when not needed; attempts to interact with an unconfigured region return `ok: false` with `code: "uninitialized_area"`.

Optimized DBs require callers to declare FB instances and their member layout up front. Each symbol is referenced by its canonical dot/bracket path (e.g., `Mixer.rpm`, `Mixer.temperatures[0]`).

## Address Notation

The simulator accepts Siemens symbolic addresses for I/Q/M areas and FB instance paths for optimized DB symbols:

- **Inputs/Outputs/Flags**
  - Bit: `I0.0`, `Q4.3`, `M10.7`
  - Byte: `IB2`, `QB10`, `MB5`
  - Word: `IW0`, `QW12`, `MW100`
  - Double Word: `ID4`, `QD20`, `MD200`
- **Optimized Data Blocks**
  - Scalar: `Mixer.isRunning`, `Mixer.rpm`
  - Nested structs: `Mixer.status.code`
  - Arrays: `Mixer.temperatures[2]`
  - Nested FB instances: `Mixer.pumpA.pressure`

Optional `#` prefixes (e.g., `#pumpA`) that appear in SCL multi-instance calls are stripped automatically. Lookups are case-insensitive, but the simulator stores and reports declaration casing.

## Typed Reads and Writes

Every API returns a `PlcResult<T>` with `{ ok: true, value }` on success, and `{ ok: false, error }` on failure. Example interactions:

```ts
const bitWrite = plc.writeBool("I0.0", true);
if (!bitWrite.ok) throw bitWrite.error;

const rpmRead = plc.readReal("Mixer.rpm");
const currentRpm = rpmRead.ok ? rpmRead.value : 0;

const alarm = plc.readBool("Mixer.pumpA.alarms[0]");
if (alarm.ok && alarm.value) {
  console.warn("Pump alarm raised");
}
```

Supported scalar data types remain unchanged:

| Type   | Accessor                 | Size | Notes |
| ------ | ----------------------- | ---- | ----- |
| BOOL   | `readBool` / `writeBool` | 1 bit | Uses containing byte, requires bit notation for I/Q/M |
| BYTE   | `readByte` / `writeByte` | 1 byte | Unsigned |
| SINT   | `readSInt` / `writeSInt` | 1 byte | Signed |
| WORD   | `readWord` / `writeWord` | 2 bytes | Unsigned, 2-byte alignment |
| INT    | `readInt` / `writeInt`   | 2 bytes | Signed, 2-byte alignment |
| DWORD  | `readDWord` / `writeDWord` | 4 bytes | Unsigned, 4-byte alignment |
| DINT   | `readDInt` / `writeDInt` | 4 bytes | Signed, 4-byte alignment |
| LINT   | `readLint` / `writeLint` | 8 bytes | Signed, 8-byte alignment |
| REAL   | `readReal` / `writeReal` | 4 bytes | IEEE754 single precision |
| LREAL  | `readLReal` / `writeLReal` | 8 bytes | IEEE754 double precision |
| TIME   | `readTime` / `writeTime` | 4 bytes | Signed milliseconds |
| DATE   | `readDate` / `writeDate` | 2 bytes | Unsigned days since 1990-01-01 |
| TOD    | `readTod` / `writeTod`   | 4 bytes | Unsigned milliseconds since midnight |
| STRING | `readString` / `writeString` | 2 + N | Declared max length enforced via symbol metadata |

`writeString` honours the Siemens metadata convention (`byte[0] = max`, `byte[1] = current length`). The simulator enforces the declared `stringLength` for each symbol; callers may provide `maxLength` and `truncate: true` to clamp input before writing.

## Observability

Register observers to monitor state changes:

```ts
const unsubscribeAll = plc.onStateChange(({ region, diff }) => {
  console.info(region, diff);
});

const unsubscribeInputs = plc.onAreaChange({ area: "I" }, diff => {
  // diff is an array of { offset, previous, current }
});

const unsubscribeMixer = plc.onAreaChange(
  { area: "DB", instancePath: "Mixer" },
  diff => {
    // diff is an array of { path, previous, current }
  }
);
```

Observers fire synchronously after each successful write. Writing the same value twice is a no-op and does not emit notifications.

## Snapshots and Diffs

Use snapshots to capture immutable views of the PLC memory for UI visualization or regression testing:

```ts
const before = snapshotState(plc);
/* perform writes */
const after = snapshotState(plc);
const diff = diffStates(before, after);
```

`snapshotState` returns plain objects containing byte arrays for I/Q/M regions and a symbol map for optimized DB instances. `diffStates` produces byte-level deltas for I/Q/M and symbol-level changes for optimized DBs. Both structures are JSON-serializable and safe to persist or transmit.

## Error Handling

Common error codes surfaced through `PlcResult`:

| Code                    | Meaning |
| ----------------------- | ------- |
| `invalid_address`       | Address string cannot be parsed |
| `alignment_error`       | Address violates alignment or bit rules |
| `out_of_range`          | Access exceeds configured memory or declared capacity |
| `type_mismatch`         | Value is not representable for the requested type |
| `unknown_fb_instance`   | Referenced FB instance was not configured |
| `unknown_symbol`        | Symbol path is not declared under the FB instance |
| `uninitialized_area`    | Area (I/Q/M) was not configured in the state |

### Troubleshooting Tips

- Ensure the configuration declares every FB instance and nested member accessed by your tooling.
- When migrating from absolute DB offsets, map each address to the canonical symbol path and remove `DBn.` prefixes.
- Use `listFbInstanceSymbols` to surface metadata for UI inspectors or validation tooling.
