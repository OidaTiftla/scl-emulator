# SPEC-plc-simulator

## Status

- Accepted

## Owners

- Codex (Planner-Architect)

## Date

- 2025-10-29

## Summary

- Define a TypeScript PLC simulation runtime that executes a constrained subset of Siemens SCL programs by interpreting the AST produced by `parseScl`, modeling PLC memory areas (flags, data blocks, inputs, outputs) and producing deterministic execution traces for tests and downstream tooling.

## Context

- The accepted `SPEC-scl-parser` delivers a deterministic AST for valid SCL programs but there is no execution model to validate semantics or demonstrate end-to-end tooling value.
- Product needs a lightweight, scriptable emulator to validate simple control logic patterns, support regression testing, and inform future UI/analysis work.
- Constraints: stay inside Node.js/TypeScript, keep scope to single-task PLC cycle semantics, no external dependencies beyond runtime/lint/test stack already adopted.

## Goals (Acceptance criteria)

- Expose a public API `simulateSclProgram(ast: SclAst, options: SimulationOptions): SimulationResult` in `src/runtime/index.ts` that executes a deterministic single scan cycle (with room to extend to multiple cycles later), mutating an in-memory PLC state containing Inputs (`I`), Outputs (`Q`), Flags (`M`), and Data Blocks (`DB<number>`).
- Support at minimum the following SCL constructs across statements and expressions: variable declarations within DBs, assignments, arithmetic (+, -, *, /), boolean operations (AND, OR, NOT), comparison operators, IF/ELSIF/ELSE, CASE, and WHILE loops with bounded iteration (guarded to avoid infinite loops).
- Support Siemens SCL scalar data types out of the box (BOOL, BYTE, WORD, DWORD, INT, DINT, SINT, LINT, REAL, LREAL, TIME, DATE, TOD, STRING) in DBs, flags, and I/O; custom user-defined `TYPE`s may be deferred.
- Provide state introspection hooks: initial state injection, post-cycle snapshots, and an execution trace (sequence of evaluated statements with before/after state deltas) that exposes final Inputs, Outputs, Flags, and DB values for downstream visualization tooling.
- Validate interpreter correctness with Vitest unit tests in `tests/runtime/plcSimulator.spec.ts` using AST fixtures from the parser (happy-path arithmetic/boolean logic, conditional branching, loop termination) and at least one integration test exercising end-to-end parse+simulate flow.
- Document the supported instruction subset, simulator usage, and limitations in `docs/plc-simulator.md` (or existing README section) and ensure `pnpm build`, `pnpm lint`, and `pnpm test` succeed after implementation.

## Non-goals

- Implementing full Siemens S7 runtime semantics (timers, counters, interrupts, multi-task scheduling, hardware diagnostics).
- Performing real-time scheduling guarantees or modeling scan-cycle timing jitter.
- Providing a GUI, PLC networking stack, or binary code generation; this milestone stays library-only.
- Supporting custom user-defined `TYPE` declarations (structures, arrays) beyond the built-in SCL scalar types.

## Decision

- Build a two-phase pipeline: convert the `SclAst` into a normalized intermediate representation (IR) tailored for simulation, then interpret the IR against an immutable-by-default state snapshot that yields new state objects per cycle.
- Represent PLC memory as typed maps (`BitArea`, `WordArea`, `StructArea`) keyed by symbolic addresses (e.g., `M0.0`, `DB1.DINT0`), enabling validation and deterministic diffing while staying schema-light.
- Keep execution tracing at the statement level (before/after state deltas) with a pluggable formatter so downstream UI layers can visualize results without being coupled to internal IR structures.
- Reject alternatives:
  - Direct AST walking on every execution step: rejected for mixing parsing concerns with runtime semantics and complicating deterministic tracing.
  - Generating JavaScript code from SCL and `eval`-ing: rejected over security, debuggability, and testability concerns.

## Architecture and Design

- `src/runtime/state.ts`: defines TypeScript interfaces for PLC memory areas, address resolvers, and helper utilities to read/write typed values.
- `src/runtime/ir.ts`: transforms `SclAst` using a visitor into an IR of statements/expressions with explicit opcodes and operand references; includes validation for supported constructs.
- `src/runtime/interpreter.ts`: executes IR against `PlcState`, handles expression evaluation, loop/branch control, and tracks execution trace entries (`{ statementId, before, after }`).
- `src/runtime/index.ts`: exports the public API (`simulateSclProgram`, `SimulationOptions`, `SimulationResult`) and re-exports state helpers for callers to seed inputs and inspect final-state outputs formatted for UI consumption.
- `tests/fixtures/runtime/*.ts`: houses reusable AST fixtures generated via `parseScl` for regression tests.
- Documentation update enumerates supported constructs, memory layout expectations, and examples for seeding DBs, flags, and I/O arrays.

## Performance and Complexity

- Expected interpreter runtime is O(n * c) where n is the number of IR statements executed per cycle and c is the number of cycles requested (default 1; current milestone fixes c = 1).
- Performance budget: execute a 500-statement program for 10 cycles within 200 ms and 256 MB RSS inside the Nix shell on a standard dev laptop (baseline measurements recorded in documentation).
- Memory usage scales with the size of DB definitions supplied; assume <1 MB total per scenario in this milestone.

## Compatibility and Platforms

- Target Node.js 20.x (Nix shell baseline) and TypeScript 5.x strict mode; deliver ESM-compatible modules.
- No browser support is required but code should avoid Node-specific APIs beyond standard runtime features.
- No migration or feature flags; library consumers opt-in by importing the runtime modules.

## Security, Privacy, and Compliance

- Simulator operates on caller-provided in-memory data only and does not access external resources.
- No personal data is processed; ensure documentation clarifies that consumers must sanitize inputs.
- Maintain upstream license compliance for any future runtime helpers (none newly introduced here).

## Test Plan

- Unit tests for expression evaluation (arithmetic, boolean, comparisons, data type coercions) using deterministic fixtures.
- Control-flow unit tests verifying IF/CASE/WHILE semantics, including loop exit conditions and guard rails against excessive iterations (e.g., configurable max iterations with failure case).
- Integration test parsing SCL source, running through `simulateSclProgram`, and asserting final Output/Flag/DB states.
- Property-style test (optional stretch) ensuring assignments preserve declared data types.
- Coverage target ≥85% across runtime modules; record coverage report via `pnpm test -- --coverage`.

## Rollout and Monitoring

- Implementation delivered as part of library package; no deployment steps.
- Add developer docs and example usage to aid adoption.
- Provide a simple logging hook within `SimulationOptions` to allow consumers to plug in their own monitoring; defaults to in-memory trace capturing final Inputs/Outputs/Flags/DB snapshots for visualization.
- Rollback plan: revert runtime modules to prior version; parser package remains unaffected.

## Risks and Mitigations

- Risk: Unsupported SCL constructs appear in real programs — mitigation: emit descriptive errors listing unsupported nodes and document how to extend the IR.
- Risk: Infinite or long-running loops — mitigation: enforce configurable max iterations per loop/cycle and surface errors when exceeded.
- Risk: Divergence between parser AST schema and interpreter expectations — mitigation: add schema version tags to IR transform and keep parser/export tests synced.
- Risk: Data type coverage gaps (e.g., STRING/TIME operations) — mitigation: implement unit tests per supported type and document any unsupported operations explicitly.
- Risk: Trace payload may not align with UI expectations — mitigation: define JSON schema for final Inputs/Outputs/Flags/DB snapshots and expose adapter layers for future enhancements.

## Open Questions


## References

- specs/SPEC-scl-parser.md

## History

- 2025-10-29: Spec proposed.
