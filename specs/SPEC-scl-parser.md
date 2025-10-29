# SPEC-scl-parser

## Status

- Accepted

## Owners

- Codex (Planner-Architect)

## Date

- 2025-10-29

## Summary

- Introduce a minimal TypeScript-only package that wraps the Siemens SCL ANTLR grammar to produce an abstract syntax tree (AST) from SCL source text, exposing a `parseScl` helper and validating it with unit tests executed via Vitest.

## Context

- The repository now tracks the upstream Siemens SCL ANTLR grammar as a git submodule at `Siemens-SCL-Antlr-Grammar/scl.g4`, but no TypeScript tooling consumes it yet.
- Product wants a simple proof that SCL input can be parsed in TypeScript with an inspectable AST to unblock follow-on tooling decisions.
- Constraints: follow repo conventions (pnpm, Vitest, specs-first). Keep scope to a minimal parser facade without additional language services.

## Goals (Acceptance criteria)

- Provide a TypeScript function `parseScl(source: string): SclAst` that returns a deterministic, serializable object representing the grammar-derived tree for valid SCL programs; invalid input throws a descriptive error.
- Add a `pnpm antlr:generate` script that regenerates TypeScript lexer/parser artifacts from `Siemens-SCL-Antlr-Grammar/scl.g4` during the build; outputs land in `src/generated/` but are not committed.
- Ensure `pnpm build` invokes generation before TypeScript compilation, so fresh parser artifacts exist without manual steps.
- Provide Vitest unit tests that parse at least one representative SCL snippet (verifying AST shape) and assert graceful error handling for invalid input.
- Document parser usage and regeneration steps in `README.md` (or equivalent) and ensure `pnpm build` and `pnpm test` succeed locally inside the Nix shell.

## Non-goals

- Building a full compiler, evaluator, or language server for SCL.
- Providing a CLI or web UI; library-only delivery is in scope.
- Normalizing or transforming the grammar beyond what ANTLR generates (no custom AST simplification in this milestone).

## Decision

- Use the `antlr4ts` runtime and `antlr4ts-cli` code generator to produce strongly-typed lexer/parser sources that integrate cleanly with TypeScript strict mode.
- Wrap generated classes in a thin adapter (`parseScl`) that configures the lexer, parser, error listeners, and converts the parse tree to a JSON-friendly AST that preserves rule structure needed for future emulator work.
- Alternatives considered:
  - Generate JavaScript targets with the Java-based `antlr4` tool and rely on the JS runtime: rejected due to lack of TypeScript types and more manual glue code.
  - Use a custom parser combinator in TypeScript: rejected because the existing grammar would need to be reimplemented, adding risk and delaying validation.

## Architecture and Design

- `src/generated/`: build-time TypeScript lexer/parser artifacts created by `pnpm antlr:generate` and ignored by git; consuming modules import from this path after generation.
- `src/parser/parseScl.ts`: exports `parseScl`, configuring `SCLLexer`, `SCLParser`, a custom error listener, and a tree visitor that builds `SclAst`.
- `src/parser/astTypes.ts`: defines serializable interfaces mirroring the parse tree nodes we expose (rule name, text span, children).
- Build tooling:
  - `scripts/generate-antlr.ts` (or direct CLI invocation) to run `antlr4ts -visitor -no-listener`.
  - `pnpm build` compiles TypeScript via `tsc` into `dist/`.
- Public API documented in `src/index.ts` exporting `parseScl`.

## Performance and Complexity

- Parsing is linear in source length (ANTLR guarantees O(n) for this grammar assuming no backtracking).
- Budget: parse ≤1,000 SCL lines within 500 ms and 128 MB RSS on Node.js 20 inside the provided Nix shell (baseline measurement logged in README).
- No additional caching or streaming in this iteration.

## Compatibility and Platforms

- Target Node.js 20.x (as provided by project Nix shell); TypeScript 5.x strict mode enabled.
- Outputs plain JSON-compatible objects; no browser bundling required but code should remain ESM-compatible.
- No feature flags needed; module exports directly.

## Security, Privacy, and Compliance

- Parser operates on in-memory source strings only; no I/O or sensitive data storage.
- Generated code is produced locally at build time (not committed); ensure upstream license (likely BSD-3-Clause) is documented in NOTICE if required.

## Test Plan

- Vitest unit tests in `tests/parser/parseScl.spec.ts` covering:
  - Happy path: parse known SCL example and snapshot or assert key AST nodes (rule names, spans).
  - Error path: invalid token sequence triggers a thrown syntax error with message assertion.
  - Smoke test to confirm root node type aligns with grammar rule `r`.
- Coverage reporting is optional for this iteration; focus on validating successful parsing and error handling.

## Rollout and Monitoring

- No deployment; library consumed internally.
- Document `pnpm antlr:generate` and regeneration workflow for future grammar updates.
- Rollback: revert generated files and package changes; grammar submodule remains untouched.

## Risks and Mitigations

- Risk: Grammar updates upstream may break type generation — pin submodule commit and document regeneration steps.
- Risk: `antlr4ts` tooling lag behind upstream ANTLR 4 — validate grammar compatibility and fall back to JavaScript target if generation fails.
- Risk: AST shape too verbose for consumers — expose visitor output in a documented format and gather feedback before stabilization.

## Open Questions

- How much semantic enrichment beyond rule names is necessary in `SclAst` to support the future emulator? (Owner: PO; Due: 2025-11-12)

## References

- `Siemens-SCL-Antlr-Grammar/scl.g4`
- https://www.antlr.org/ (ANTLR 4 overview)

## History

- 2025-10-29: Spec proposed.
- 2025-10-29: Spec accepted.
