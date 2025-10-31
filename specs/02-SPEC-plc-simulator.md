# SPEC-plc-simulator

## Status

- Accepted

## Owners

- Codex (Planner-Architect)

## Date

- 2025-10-30

## Summary

- Define a TypeScript PLC state simulation library that models Siemens S7-style memory areas (Inputs, Outputs, Flags, and Data Blocks), supporting read/write operations, validation, and observability hooks without executing SCL code.

## Context

- Follow-up work will execute SCL programs using the AST returned by `parseScl`, but the execution layer first needs a dependable in-memory PLC model.
- Product wants UI explorations that visualize PLC state, which requires an API to inspect and manipulate I/O and DB regions outside of program execution.
- Constraints: remain inside the existing Node.js/TypeScript toolchain, reuse repo conventions (pnpm, Vitest), and provide full coverage of Siemens scalar data types (excluding user-defined `TYPE`s for now).

## Goals (Acceptance criteria)

- Provide a public API in `src/plc/state/index.ts` exposing:
  - `createPlcState(config: PlcStateConfig): PlcState` to initialize Inputs (`I`), Outputs (`Q`), Flags (`M`), and Data Blocks (`DB<number>`).
  - Typed getters/setters for PLC addresses (e.g., `readBool("I0.0")`, `writeReal("DB1.DBX0.0", value)`), returning success/failure with descriptive errors on invalid addresses or type mismatches.
  - Snapshot and diff utilities (`snapshotState`, `diffStates`) producing JSON-serializable structures suitable for UI visualization.
  - Optional subscription APIs (`onStateChange`, `onAreaChange`) for supervising updates during manual manipulation or future emulation.
- Support Siemens scalar SCL data types (BOOL, BYTE, WORD, DWORD, INT, DINT, SINT, LINT, REAL, LREAL, TIME, DATE, TOD, STRING) across Flags, I/O, and DB memory, including size/alignment validation where applicable.
- Include documentation (`docs/plc-simulator.md`) detailing address notation, supported operations, and sample usage for UI tooling.
- Ensure `pnpm build`, `pnpm lint`, and `pnpm test` succeed with new unit tests covering read/write scenarios, validation, and snapshot formatting.

## Non-goals

- Executing or interpreting SCL code (handled by a separate emulator spec).
- Modeling PLC cycle timing, interrupts, or hardware diagnostics.
- Supporting custom user-defined `TYPE` declarations, arrays, or complex structures beyond scalar DB members.
- Implementing persistence, networking, or PLC hardware communication.

## Decision

- Represent PLC memory areas with dedicated TypeScript classes (`BitArea`, `WordArea`, `DbArea`) that encapsulate storage and enforce type boundaries, exposing a unified interface through `PlcState`.
- Use symbolic addressing parsers to translate Siemens-style addresses into offsets within backing buffers, ensuring deterministic lookups and enabling schema validation at initialization.
- Offer immutable snapshots via structured cloning to simplify diffing and UI rendering, keeping mutable operations isolated within the state object.
- Alternatives considered:
  - Storing all values in a generic `Map<string, unknown>`: rejected for lack of type guarantees and inefficient diffing.
  - Using a binary buffer mirroring PLC memory map without high-level helpers: rejected due to ergonomics and higher risk of user error.

## Architecture and Design

- `src/plc/state/types.ts`: shared TypeScript types for configurations, supported data types, address tokens, and snapshot shapes.
- `src/plc/state/address.ts`: parsers/formatters translating string addresses (`I0.1`, `DB1.DBB4`, etc.) into internal descriptors.
- `src/plc/state/areas/`: folder housing implementations for I/Q/M memory areas (`bitArea.ts`, `wordArea.ts`) backed by typed arrays, plus `optimizedDb.ts` for FB symbol registration.
- `src/plc/state/plcState.ts`: orchestrates area instances, exposes public getters/setters, manages subscriptions, and produces snapshots/diffs.
- `src/plc/state/index.ts`: exports public API surface and helper utilities for consumers.
- `tests/plc/state/*.spec.ts`: Vitest suites verifying initialization, read/write correctness, validation errors, subscriptions, and snapshot/diff semantics.
- `docs/plc-simulator.md`: usage guide with sample code, supported data types, and troubleshooting tips.

## Performance and Complexity

- Read/write operations should be O(1) per request; snapshot creation is O(n) relative to total stored addresses.
- Performance budget: create and snapshot a state with 1,000 scalar addresses in ≤50 ms and ≤50 MB RSS on Node.js 20 inside the Nix shell.
- Memory usage scales with configured DB sizes; document acceptable limits (target <5 MB typical scenario).

## Compatibility and Platforms

- Target Node.js 20.x and TypeScript 5.x strict mode; export ESM-compatible modules.
- No browser-specific APIs, but snapshots should remain JSON-serializable for potential web visualization.
- No feature flags or migrations required; consumers instantiate states directly.

## Security, Privacy, and Compliance

- Library operates purely in-memory with caller-provided data, no external I/O.
- Document that downstream consumers bear responsibility for sanitizing UI inputs.
- No new third-party dependencies anticipated.

## Test Plan

- Unit tests for each getter/setter validating correct conversions, range checks, and error messages on invalid addresses or types.
- Tests covering subscription callbacks firing with accurate payloads for single and batched updates.
- Snapshot/diff tests verifying deterministic output, deep cloning, and JSON serialization.
- Negative tests ensuring initialization fails when config defines overlapping or unsupported data types.
- Coverage target ≥85% for `src/plc/state/` modules with `pnpm test -- --coverage`.

## Rollout and Monitoring

- Published as part of the existing library package; no deployment steps.
- Provide example scripts (optional) in `tools/` or documentation to demonstrate manual state manipulation.
- Rollback plan: revert `src/plc/state/` modules to previous version; execution layer remains unaffected.

## Risks and Mitigations

- Risk: Siemens address parsing edge cases missed — mitigation: build comprehensive parser unit tests and document unsupported formats.
- Risk: Data type coercion bugs (e.g., TIME, STRING) — mitigation: implement type-specific helper functions and targeted unit tests.
- Risk: Subscription API overhead — mitigation: keep observer notifications synchronous and document performance characteristics.

## References

- [01-SPEC-scl-parser](01-SPEC-scl-parser.md)

## History

- 2025-10-30: Spec proposed after splitting execution scope into a separate emulator spec.
