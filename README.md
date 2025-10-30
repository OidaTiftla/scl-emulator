## SCL Emulator

This package wraps the Siemens SCL ANTLR grammar and exposes a strict TypeScript helper for building an abstract syntax tree (AST) from SCL source text. Tooling relies entirely on Node.js (via `antlr-ng` and the `antlr4ng` runtime), so no local Java installation is required.

### Usage

```ts
import { parseScl } from "scl-parser";

const program = `
  FUNCTION_BLOCK Counter
  VAR
    count : INT;
  END_VAR
  BEGIN
    count := count + 1;
  END_FUNCTION_BLOCK
`;

const ast = parseScl(program);
console.log(ast.root.type); // "r"
```

`parseScl` throws an `SclParseError` when the source contains lexical or syntax errors. The returned AST preserves rule names, matched text, and zero-based source ranges for downstream analysis.

### Regenerating the parser

1. Enter the reproducible environment (`./shell.sh` or `./scripts/run-nix-container.sh`). The Nix shell bundles Node.js 22 LTS, pnpm, Vitest, and the Node-based `antlr-ng` CLI. If you work outside the shell, ensure `node` (v22+) is available on your `PATH`.
2. Install dependencies if needed: `pnpm install`
3. Generate the lexer/parser TypeScript artifacts (Java-free): `pnpm antlr:generate`

Generated files land in `src/generated/` and are intentionally ignored by git. Regenerate after updating `Siemens-SCL-Antlr-Grammar/scl.g4`.

### Development scripts

- `pnpm build` — regenerates the ANTLR output and compiles TypeScript to `dist/`
- `pnpm test` — regenerates the parser and executes the Vitest suite
- `pnpm lint` — runs ESLint with TypeScript-aware rules

Refer to `specs/SPEC-scl-parser.md` for implementation details and acceptance criteria.
