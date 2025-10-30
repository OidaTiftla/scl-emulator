# PLC State Simulator

The PLC state simulator provides an in-memory model of Siemens S7 style memory areas so tools and test harnesses can inspect and manipulate controller data without connecting to hardware. This document explains addressing, supported operations, and common usage patterns.

## Memory Areas and Configuration

`createPlcState` accepts a `PlcStateConfig` describing the byte-length of each region:

```ts
import { createPlcState } from "@scl-emulator/core";

const plc = createPlcState({
  inputs: { size: 16 },   // `I` area: process inputs
  outputs: { size: 16 },  // `Q` area: process outputs
  flags: { size: 32 },    // `M` area: internal markers
  dataBlocks: [
    { id: 1, size: 256 },
    { id: 7, size: 128 },
  ],
});
```

All regions use big-endian layout to mirror S7 controllers. A configured area may be omitted when not needed; attempts to interact with an unconfigured region return `ok: false` with `code: "uninitialized_area"`.

## Address Notation

The simulator accepts Siemens symbolic addresses:

- **Inputs/Outputs/Flags**
  - Bit: `I0.0`, `Q4.3`, `M10.7`
  - Byte: `IB2`, `QB10`, `MB5`
  - Word: `IW0`, `QW12`, `MW100`
  - Double Word: `ID4`, `QD20`, `MD200`
- **Data Blocks**
  - Bit: `DB1.DBX0.0`, `DB7.DBX12.5`
  - Byte: `DB1.DBB0`
  - Word: `DB1.DBW2`
  - Double Word: `DB1.DBD4`

Typed getters allow either the canonical token (e.g., `DB1.DBD0`) or a bit-form address with `.0` alignment (`DB1.DBX0.0`). Misaligned or invalid addresses return `ok: false` with `code: "alignment_error"` or `"invalid_address"`.

## Typed Reads and Writes

Every API returns a `PlcResult<T>` with `{ ok: true, value }` on success, and `{ ok: false, error }` on failure. Example interactions:

```ts
const bitWrite = plc.writeBool("I0.0", true);
if (!bitWrite.ok) throw bitWrite.error;

const lintRead = plc.readLint("DB1.DBX64.0");
const position = lintRead.ok ? lintRead.value : 0n;

const pumpSpeed = plc.readReal("DB7.DBD12");
if (pumpSpeed.ok) {
  console.log("Pump speed", pumpSpeed.value);
}
```

Supported scalar data types:

| Type   | Accessor                 | Size | Notes |
| ------ | ----------------------- | ---- | ----- |
| BOOL   | `readBool` / `writeBool` | 1 bit | Uses containing byte, requires bit notation |
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
| STRING | `readString` / `writeString` | 2 + N | Siemens metadata + ASCII payload |

`writeString` honours the Siemens metadata convention (`byte[0] = max`, `byte[1] = current length`). Provide `maxLength` to declare capacity and set `truncate: true` when longer input should be clipped instead of rejected.

## Observability

Register observers to monitor state changes:

```ts
const unsubscribeAll = plc.onStateChange(({ region, diff }) => {
  console.info(region, diff);
});

const unsubscribeInputs = plc.onAreaChange({ area: "I" }, diff => {
  // diff is an array of { offset, previous, current }
});
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

`snapshotState` returns plain objects containing byte arrays for each area, and `diffStates` composes byte-level deltas grouped by region. Both structures are JSON-serializable and safe to persist or transmit.

## Error Handling

Common error codes surfaced through `PlcResult`:

| Code                 | Meaning |
| -------------------- | ------- |
| `invalid_address`    | Address string cannot be parsed |
| `alignment_error`    | Address violates alignment or bit rules |
| `out_of_range`       | Access exceeds configured memory or declared capacity |
| `type_mismatch`      | Value is not representable for the requested type |
| `unknown_data_block` | Data block number is not configured |
| `uninitialized_area` | Area (I/Q/M) was not configured in the state |

### Troubleshooting Tips

- Ensure the configuration allocates enough bytes for every address you touch; reads past the configured size fail with `out_of_range`.
- Use word/dword tokens (`IW`, `DBD`) for aligned accesses to avoid alignment errors when interfacing with SCADA exports.
- When migrating S7 DB layouts, remember that strings reserve two metadata bytes before the payload.
