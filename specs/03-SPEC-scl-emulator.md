# SPEC-scl-emulator

## Status

- Accepted

## Owners

- Codex (Planner-Architect)

## Date

- 2025-10-30

## Summary

- Specify a TypeScript SCL emulator that interprets the AST produced by `parseScl`, executes a constrained subset of Siemens SCL logic, and manipulates PLC state via the APIs delivered in [02-SPEC-plc-simulator](02-SPEC-plc-simulator.md).

## Context

- With the PLC state simulator in place, the next milestone is to execute SCL code end-to-end to validate semantics and power UI visualizations.
- Product needs deterministic execution results for a curated set of SCL programs to vet future tooling ideas (e.g., code previews, diagramming).
- Constraints: reuse existing Node.js/TypeScript toolchain, rely on `parseScl` output, and operate strictly on the simulator's `PlcState` API without introducing additional runtime dependencies.

## Goals (Acceptance criteria)

- Provide a public API `executeSclProgram(ast: SclAst, state: PlcState, options: ExecutionOptions): ExecutionResult` in `src/emulator/index.ts` that:
  - Executes a single PLC scan cycle (future-proofed for multiple cycles) using the PLC state API for all reads/writes.
  - Supports SCL statements and expressions: variable declarations within DBs, assignments, arithmetic (+, -, *, /), boolean operations (AND, OR, NOT), comparison operators, IF/ELSIF/ELSE, CASE, and WHILE loops with bounded iterations to prevent infinite loops.
  - Honors Siemens scalar data types (BOOL, BYTE, WORD, DWORD, INT, DINT, SINT, LINT, REAL, LREAL, TIME, DATE, TOD, STRING) when reading/writing PLC memory, deferring custom `TYPE`s.
  - Produces an `ExecutionResult` containing the final PLC state snapshot; statement-level trace capture is optional and disabled by default.
- Provide validation that unsupported AST nodes or constructs raise descriptive errors referencing the original source locations.
- Document emulator usage, supported language features, and limitations in `docs/scl-emulator.md` (or section within existing docs) including examples that combine parsing, execution, and state inspection.
- Ensure `pnpm build`, `pnpm lint`, and `pnpm test` succeed with new unit and integration tests covering interpreter behavior and parser+emulator flows.

## Non-goals

- Implementing full Siemens S7 runtime features (multi-task scheduling, timers/counters with persistence, hardware communication).
- Providing GUI, CLI, or visualization tooling (handled separately).
- Supporting user-defined `TYPE`s, arrays, or advanced language constructs beyond the enumerated subset.
- Handling multi-cycle execution persistence (future work).

## Decision

- Convert the `SclAst` into an intermediate representation (IR) optimized for execution, decoupling parsing concerns from runtime semantics and easing future optimizations.
- Use a visitor pattern to map AST nodes to IR statements/expressions with explicit opcodes referencing PLC addresses or literal values.
- Drive execution through a deterministic interpreter that leverages the PLC simulator’s read/write methods, emits trace entries `{ statementId, sourceRange, effects }`, and enforces configurable max-iteration guards on loops.
- Alternatives considered:
  - Directly interpreting the AST without an IR: rejected due to tighter coupling with parser schema and less opportunity for validation.
  - Transpiling SCL to JavaScript and evaluating: rejected over security, debuggability, and testability concerns.

## Architecture and Design

- `src/emulator/ir/types.ts`: defines IR nodes for statements, expressions, and control-flow metadata.
- `src/emulator/ir/builder.ts`: walks `SclAst`, validates supported constructs, and emits IR; includes error reporting with source locations.
- `src/emulator/interpreter.ts`: executes IR against a provided `PlcState`, handling expression evaluation, control flow, and loop guards.
- `src/emulator/index.ts`: public API exposing `executeSclProgram`, option schemas, and the `ExecutionResult` shape that wraps final state snapshots from the simulator.
- Reuse `tests/fixtures/runtime/` (or add `tests/fixtures/emulator/`) to store AST fixtures for repeatable tests.
- `tests/emulator/*.spec.ts`: Vitest suites for interpreter logic, error handling, and parse+execute scenarios verifying final state/output traces.
- `docs/scl-emulator.md`: documentation with examples, supported constructs, and instructions for extending coverage.

## Performance and Complexity

- Execution complexity is O(n) per scan cycle where n equals the number of IR statements executed; loops bounded by configured max iterations.
- Performance budget: execute a 200-statement program within 100 ms and ≤128 MB RSS on Node.js 20 in the Nix shell.
- Trace generation should add minimal overhead (<20% runtime impact) and remain optional via `ExecutionOptions`, defaulting to off.

## Compatibility and Platforms

- Target Node.js 20.x, TypeScript 5.x strict mode; modules remain ESM-compatible.
- No browser support required yet, but API outputs should stay JSON-serializable for potential UI consumption.
- No feature flags necessary; consumers control execution via options.

## Security, Privacy, and Compliance

- Emulator operates in-memory on provided PLC states; no external I/O.
- Avoid dynamic code execution (`eval`, `Function` constructors) for safety.
- Ensure documentation clarifies that user-supplied SCL is executed deterministically within the sandboxed PLC state.

## Test Plan

- Unit tests for expression evaluation, control flow (IF/CASE/WHILE), loop guard enforcement, and data type interactions.
- Tests verifying descriptive errors when encountering unsupported AST nodes or exceeding loop limits.
- Integration tests chaining `parseScl`, `createPlcState`, and `executeSclProgram`, asserting final PLC state and trace contents.
- Coverage target ≥85% across `src/emulator/` modules using `pnpm test -- --coverage`.

## Rollout and Monitoring

- Delivered as part of the library package; no deployment required.
- Document example usage scripts for developers to run emulator scenarios locally.
- Rollback plan: revert emulator modules; PLC simulator and parser remain intact.

## Risks and Mitigations

- Risk: AST schema evolution breaks emulator — mitigation: version IR builder, wrap integration tests around canonical fixtures.
- Risk: Loop guard parameters too restrictive or permissive — mitigation: expose configuration in `ExecutionOptions` with sane defaults and tests.
- Risk: Complex data type operations (e.g., STRING manipulation) produce incorrect semantics — mitigation: add focused unit tests per data type and log known limitations.
- Risk: Optional trace collection may introduce runtime overhead when enabled — mitigation: lazily allocate trace buffers and document expected costs.

## Open Questions

- None.

## References

- [01-SPEC-scl-parser](01-SPEC-scl-parser.md)
- [02-SPEC-plc-simulator](02-SPEC-plc-simulator.md)

## History

- 2025-10-30: Spec proposed following split from PLC state simulator scope.
