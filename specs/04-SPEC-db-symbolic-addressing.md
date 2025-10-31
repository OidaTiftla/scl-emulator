# SPEC-db-symbolic-addressing

## Status

- Accepted

## Owners

- Codex (Planner-Architect)

## Date

- 2025-10-30

## Summary

- Replace Siemens-style absolute addressing inside PLC data blocks (e.g., `DB1.DBX0.0`) with purely symbolic field access that mirrors Siemens optimized DBs (no absolute offsets), while retaining absolute addressing for Inputs (`I`), Outputs (`Q`), and Flags (`M`).

## Context

- The current PLC state simulator accepts string addresses for all areas, including absolute offsets into data blocks. Product wants to remove programmer-facing offsets for DBs so that tooling aligns with Siemens optimized DB behavior where only symbolic names are valid.
- Manual symbol mapping is error prone and slows iteration. Interpreter bindings already tolerate symbolic naming, but they still require callers to translate symbols to absolute DB addresses.
- Optimized DB semantics mean we store values directly against symbol names (including arrays) with defaults applied from declarations; consumers provide the symbol definitions up front, and runtime never exposes absolute offsets.
- Product also needs a UI-level API to surface semantic datapoints for inspectors without reimplementing symbol traversal.
- FB invocation semantics rely on instance typing: when `OrderManager(...)` is called, the system knows the FB type (`ManageOrder`) and prefixes all internal symbol references with `OrderManager.*`; nested FB calls (multi-instances) such as `#pumpA(...)` inside `OrderManager` resolve to `OrderManager.pumpA.*`, with the leading `#` only permitted in FB body statements and stripped during IR conversion so stored paths never include it.
- Stakeholders: product (reduce address friction), emulator team (simplify bindings), future UI tooling (display structured DB schemas).

## Goals (Acceptance criteria)

- Update the PLC state API so that DB read/write helpers reject `DB*` absolute tokens and instead accept FB instance symbolic member paths (e.g., `OrderManager.orderCounter`, `PumpA.batch.config.retryLimit`, `pumpA.batches[0].status`). Array indexing uses bracket notation with zero-based integers, and optional `#` prefixes that may appear in FB body statements are stripped before resolution. The API must validate paths and enforce declared data types.
- Extend `PlcStateConfig` to accept optimized DB definitions that declare FB instance symbols (e.g., `OrderManager`) mapped to types (`ManageOrder`) and their member symbols (names, types, optional defaults, nested structure, arrays). `PlcState` must allocate storage keyed entirely by those instance definitions without deriving byte offsets and initialize values from declared defaults.
- Adjust the emulator to consume the optimized DB definitions rather than absolute DB addresses. Executions that reference missing symbols must throw descriptive errors including the canonical FB instance path, the underlying FB type, and source range.
- Expose a read-only API that surfaces optimized DB symbol metadata (field name, resolved type, declared default) in a UI-friendly format keyed by FB instance paths (e.g., `OrderManager.orderCounter`).
- Ensure DB symbol lookup is case-insensitive at call sites while storing declaration casing in the state store/metadata, and require canonical FB instance naming (no numeric DB prefixes).
- Support hierarchical FB instance resolution during execution: FB calls (including multi-instances invoked with optional `#`) must automatically compose prefixes based on the caller instance and the callee variable name/type so that symbol access inside `pump` resolves to `OrderManager.pumpA.*`.
- Maintain absolute addressing and optional symbol mapping for I/Q/M areas exactly as-is; regression tests must continue to pass for those regions.
- Provide unit and integration tests covering DB symbolic lookups (including arrays), emulator bindings, optimized DB registration/default initialization, and the UI datapoint API. `pnpm build`, `pnpm lint`, and `pnpm test -- --coverage` must pass.

## Non-goals

- Supporting custom Siemens UDT/TYPE imports beyond what the optimized DB configuration format supports in this iteration.
- Reworking the SCL emulator’s IR or expression semantics beyond address binding changes.
- Changing the absolute-address format for I/O or flag areas.
- Delivering UI visualization of DB structures (documented as future work).

## Decision

- Represent each optimized DB definition as a tree of named fields with resolved types, optional defaults, and array shapes under FB instance roots. Store values directly in typed slots keyed by canonical dot/bracket strings (`OrderManager.orderCounter`, `OrderManager.pumpA.batches[0].status`). Each entry is stored using the declaration’s original casing, while lookups normalize the requested token sequence in a case-insensitive fashion to locate the same slot; since all references resolve to the declared variable, no collisions are possible. No absolute offsets or numeric DB prefixes are exposed or stored.
- Resolve symbolic paths once when DB definitions register, caching descriptors for O(1) lookups during reads/writes and applying default initializers from the definitions.
- Enhance `PlcState` with `readSymbol`/`writeSymbol` helpers that delegate to existing typed readers after resolving descriptors and enforce declared types (e.g., calling `readDInt` for an INT32 field). Flag areas continue using the existing string parser. Symbol resolution removes any optional leading `#` before matching and performs case-insensitive lookup while returning metadata with the declaration casing for display.
- Introduce a `listFbInstanceSymbols` API that returns semantic datapoints for UI consumption, with optional filtering by FB instance/type. Each datapoint provides the declaration-cased field name, resolved type identifier, and declared default (if present), and current runtime values.
- Update emulator bindings so `ExecutionOptions` accepts either absolute I/Q/M addresses or symbolic DB references expressed as `{ instance: string, path: string }` (or a single canonical string if that proves more stable). Document the chosen representation and migration guidance. The emulator resolves DB references against the registered optimized definitions (ensuring declared FB instance/type pairs exist) and records effects using the same canonical symbolic path notation. Maintain an execution-time instance stack so nested FB calls automatically derive prefixes (e.g., caller `OrderManager` + callee variable `pumpA` => `OrderManager.pumpA`), ignoring optional leading `#`.
- Alternatives considered:
  - Retain absolute DB addresses alongside symbols: rejected because it fails the requirement and keeps offset drift risks alive.
  - Build symbol maps automatically from SCL ASTs: rejected per product guidance; callers will supply optimized DB definitions directly.
  - Model DB symbols as dynamic proxies instead of upfront maps: rejected for added runtime cost and harder validation.

## Architecture and Design

- `src/plc/state/optimizedDb.ts` (new): defines `OptimizedFbInstanceDefinition` (instance name → FB type → fields), array metadata, string metadata, defaults, case-insensitive canonicalization, and helper utilities for validation and descriptor generation.
- `src/plc/state/plcState.ts`: store a `Map<string, SymbolDescriptor>` compiled from optimized DB definitions; add `resolveDbSymbol(path: string)` and gate existing read/write helpers to use symbol resolution when region `DB`.
- `src/plc/state/address.ts`: drop support for parsing `DBX/DBB/DBW/DBD` tokens; surface a dedicated error advising symbolic usage and guiding callers to the canonicalized forms.
- `src/plc/state/datapoints.ts` (new): expose a `listFbInstanceSymbols` helper that returns semantic datapoints keyed by FB instance paths for UI/inspection, each containing the declaration-cased field name, resolved type identifier, and declared default (if present), and live values.
- `src/emulator/index.ts` & `src/emulator/interpreter.ts`: update binding ingestion so DB entries reference schema paths, maintain an instance/type registry, and push/pop instance prefixes during FB and multi-instance calls (stripping optional `#`). Evaluate merging `{ instance, path }` into a single canonical string token before finalizing the public API and document the outcome. Execution trace addresses for DBs switch to canonical symbolic strings.
- `src/index.ts`: export optimized DB configuration APIs and revised types.
- Tests:
  - `tests/plc/state/dbSymbols.spec.ts` for optimized DB definition validation (including arrays/defaults) and lookup edge cases.
  - Update `tests/plc/state/plcState.spec.ts` and `tests/emulator/executeSclProgram.spec.ts` to use symbolic DB paths.
  - Add coverage for `listFbInstanceSymbols` responses, ensuring field name/type/default/runtime-values metadata matches declarations.
  - Add fixtures under `tests/fixtures/dbDefinitions/` representing representative optimized DB configurations with arrays/defaults.
- Documentation: introduce `docs/db-symbols.md` (or extend existing simulator docs) describing optimized DB configuration, allowed path syntax, case-insensitive matching, UI datapoint API, and migration notes.

## Performance and Complexity

- Symbol resolution is O(1) with a precomputed map; registering optimized DB definitions is O(total fields) per configuration.
- Performance budget: registering 10 DBs with 200 fields each completes within 50 ms and ≤32 MB RSS in Node.js 20 inside the Nix shell.
- Runtime read/write throughput must remain comparable to absolute addressing (≤5% overhead measured by microbenchmarks touching 10k symbol reads), including case-insensitive lookup normalization and array indexing.
- Listing semantic datapoints for a DB with 500 symbols should complete within 10 ms and avoid allocations >5 MB.

## Compatibility and Platforms

- Target Node.js 20.x and TypeScript 5.x strict mode (unchanged).
- `dist/` exports remain ESM-compatible. New optimized DB configuration types must have type definitions surfaced.
- Existing consumers must migrate DB references to symbolic paths; provide a migration guide and helper script (optional) to flag old `DB*` address usage.

## Security, Privacy, and Compliance

- No new external services or sensitive data handling. Symbol tables derived from provided configuration only.
- Validate optimized DB configurations for identifier lengths to avoid pathological memory usage and normalize symbol casing deterministically to prevent spoofing.

## Test Plan

- Unit: optimized DB registration validates scalar, nested struct, array, and string declarations supplied via configuration; invalid constructs raise errors and case-insensitive duplicates are rejected.
- Unit: `PlcState` symbol resolver rejects unknown DBs/paths, enforces type expectations, and round-trips values for all supported scalar types; includes array element access via bracket notation, optional leading `#` stripping, case-insensitive lookup scenarios, and FB instance prefix combinations.
- Integration: emulator executes sample programs using symbolic FB bindings (including nested multi-instance calls with optional `#` that is stripped prior to storage), initialization via DB default values where available, and records canonicalized paths in traces.
- Regression: retained tests for I/Q/M absolute addressing; coverage goal ≥85% sustained.
- Optional microbenchmark recording to compare symbol vs absolute addressing latency.

## Rollout and Monitoring

- Migration requires:
  1. Provide optimized DB definitions via configuration (JSON/TS) during initialization.
  2. Update binding configuration to pass symbolic paths.
  3. Run `pnpm lint` rule that flags `DB.` absolute tokens in TypeScript code.
  4. Integrate the UI datapoint API where DB visualizations or inspectors exist.
- Provide changelog entry and docs showing before/after.
- Rollback: revert to previous commit; no persisted data formats change.

## Risks and Mitigations

- Risk: Configuration format may not cover all DB constructs (arrays of structs, etc.). Mitigation: start with scalar + struct support; log unsupported definitions with actionable errors and document coverage.
- Risk: Symbol collisions (duplicate field names) between nested scopes. Mitigation: canonicalize full paths and validate uniqueness during registration; surface configuration errors.
- Risk: Emulator consumers forgetting to register optimized DB definitions before execution. Mitigation: require definition map input when constructing the interpreter; throw early if missing.
- Risk: Performance regressions due to schema lookup at runtime. Mitigation: compile map once per DB and benchmark; ensure resolver caches typed descriptors.
- Risk: Case-insensitive matching introduces ambiguity for UI display (e.g., `Value` vs `value`). Mitigation: document the declaration-casing storage rule, expose the declaration casing in metadata, and add lint warnings for identifiers that differ only by case.

## Open Questions

- None.

## References

- [02-SPEC-plc-simulator](02-SPEC-plc-simulator.md)
- [03-SPEC-scl-emulator](03-SPEC-scl-emulator.md)
- [01-SPEC-scl-parser](01-SPEC-scl-parser.md)

## History

- 2025-10-30: Spec proposed.
