# SPEC-scl-parser

## Status

- Implemented

## Owners

- Codex (Planner-Architect)

## Date

- 2025-10-29

## Summary

- Introduce a minimal TypeScript-only package that wraps the Siemens SCL ANTLR grammar to produce an abstract syntax tree (AST) from SCL source text, exposing a `parseScl` helper and validating it with Vitest, while keeping the entire toolchain (including ANTLR code generation) runnable via Node.js 22 LTS without requiring a local Java installation.

## Context

- The repository now tracks the upstream Siemens SCL ANTLR grammar as a git submodule at `Siemens-SCL-Antlr-Grammar/scl.g4`, but no TypeScript tooling consumes it yet.
- Product wants a simple proof that SCL input can be parsed in TypeScript with an inspectable AST to unblock follow-on tooling decisions.
- Scope is limited to an internal game prototype, so we can iterate quickly on the newer `antlr-ng` stack and tolerate occasional manual grammar regeneration.
- Constraints: follow repo conventions (pnpm, Vitest, specs-first). Keep scope to a minimal parser facade without additional language services.

## Goals (Acceptance criteria)

- Provide a TypeScript function `parseScl(source: string): SclAst` that returns a deterministic, serializable object representing the grammar-derived tree for valid SCL programs; invalid input throws a descriptive error.
- Add a `pnpm antlr:generate` script that regenerates TypeScript lexer/parser artifacts from `Siemens-SCL-Antlr-Grammar/scl.g4` during the build via the `antlr-ng` CLI; outputs land in `src/generated/` but are not committed.
- Ensure `pnpm build` invokes generation before TypeScript compilation so fresh parser artifacts exist without manual steps and the pipeline runs inside Node.js tooling (Node.js 22 LTS) with no local Java dependency.
- Provide Vitest unit tests that parse at least one representative SCL snippet (verifying AST shape) and assert graceful error handling for invalid input.
- Document parser usage, regeneration steps, and the Java-free workflow in `README.md` (or equivalent) and ensure `pnpm build` and `pnpm test` succeed locally inside the Nix shell.

## Non-goals

- Building a full compiler, evaluator, or language server for SCL.
- Providing a CLI or web UI; library-only delivery is in scope.
- Normalizing or transforming the grammar beyond what ANTLR generates (no custom AST simplification in this milestone).

## Decision

- Use the `antlr-ng` CLI to generate TypeScript lexer/parser sources directly under Node.js, paired with the `antlr4ng` runtime, so the entire toolchain stays TypeScript-first and avoids a JVM requirement while still matching ANTLR 4 semantics.
- Wrap generated classes in a thin adapter (`parseScl`) that configures the lexer, parser, error listeners, and converts the parse tree to a JSON-friendly AST that preserves rule structure needed for future emulator work.
- Alternatives considered:
  - Continue relying on the Java-based `antlr4` tool (either via `antlr4ts-cli` or the upstream jar): rejected because it forces a local JVM dependency that conflicts with our portability requirement.
  - Use the Python `antlr4-tools` wrapper, which downloads a JRE on demand: rejected as a primary path because it still embeds Java assets and increases tooling complexity, but we can keep it as a contingency if `antlr-ng` gaps emerge.
  - Use a custom parser combinator in TypeScript: rejected because the existing grammar would need to be reimplemented, adding risk and delaying validation.

## Architecture and Design

- `src/generated/`: build-time TypeScript lexer/parser artifacts created by `pnpm antlr:generate` (running `npx antlr-ng generate --visitor --out src/generated Siemens-SCL-Antlr-Grammar/scl.g4`) and ignored by git; consuming modules import from this path after generation.
- `src/parser/parseScl.ts`: exports `parseScl`, configuring `SCLLexer`, `SCLParser`, a custom error listener, and a tree visitor that builds `SclAst`.
- `src/parser/astTypes.ts`: defines serializable interfaces mirroring the parse tree nodes we expose (rule name, text span, children).
- Build tooling:
  - `pnpm antlr:generate` invokes the Node-based CLI shipped with `antlr-ng`; no Java prerequisite.
  - `pnpm build` ensures generation runs (via lifecycle hook or explicit dependency) before TypeScript compilation into `dist/`.
- Public API documented in `src/index.ts` exporting `parseScl`.

## Performance and Complexity

- Parsing is linear in source length (ANTLR guarantees O(n) for this grammar assuming no backtracking).
- Budget: parse ≤1,000 SCL lines within 500 ms and 128 MB RSS on Node.js 22 LTS inside the provided Nix shell (baseline measurement logged in README).
- No additional caching or streaming in this iteration.

## Compatibility and Platforms

- Target Node.js 22 LTS (update Nix shell configuration as needed); TypeScript 5.x strict mode enabled.
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

- Risk: Grammar updates upstream may break type generation — pin submodule commit and document regeneration steps; updates are expected to be infrequent so schedule manual validation when new grammar features are required.
- Risk: `antlr-ng` is newer than the legacy `antlr4ts` stack — run smoke tests against representative SCL samples; if blockers surface, fall back temporarily to the Python `antlr4-tools` wrapper that bootstraps Java automatically.
- Risk: AST shape too verbose for consumers — expose visitor output in a documented format and gather feedback before stabilization.

## Open Questions

- None at this time (will add if semantic enrichment requirements emerge).

## References

- `Siemens-SCL-Antlr-Grammar/scl.g4`
- https://www.antlr.org/ (ANTLR 4 overview)
- https://soft-gems.net/blog/2024/01/19/A-new-ANTLR-is-in-the-House/ (ANTLR-ng overview)
- https://www.antlr-ng.org/docs/getting-started (ANTLR-ng CLI usage)
- https://github.com/davidbrownell/antlr4-tools (Python wrapper with bundled JRE fallback)

## History

- 2025-10-29: Spec proposed.
- 2025-10-29: Spec accepted.
