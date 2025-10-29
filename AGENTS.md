# Repository Guidelines

## Project Structure & Module Organization
Root planning docs live at `PROJECT.md`, automation scripts under `scripts/`, and container assets under `docker/`. Specs belong in `specs/` using the provided template; every feature should start with a spec copy named `SPEC-<topic>.md`. Application code resides in `src/` once introduced, mirrored by test suites in `tests/`. Keep support assets (`docs/`, `public/`, `tools/`) grouped by purpose and add a README per directory when it first appears.

## Build, Test, and Development Commands
Use `./shell.sh` for a reproducible Nix shell that pre-installs `node`, `pnpm`, and `playwright-test`. To reuse the containerized workflow, run `./scripts/run-nix-container.sh`, which builds `docker/ubuntu-nix.Dockerfile`, reuses `ubuntu-nix-<repo>-dev` when available, and drops you into `/workspace`. Inside either environment, run `pnpm install` to restore dependencies, `pnpm build` for compilation, and `pnpm test` for the suite; add the scripts to `package.json` if missing.

## Coding Style & Naming Conventions
Default to TypeScript with strict mode enabled. Use two-space indentation, camelCase for variables/functions, PascalCase for classes/components, and kebab-case for filenames. Keep module barrels in `src/index.ts` per domain slice. Enforce formatting through Prettier and linting through ESLint; expose `pnpm lint` and ensure rulesets align with the spec decisions. Specs themselves must retain the `SPEC-` prefix and record status/date headers.

## Testing Guidelines
Adopt Playwright for end-to-end coverage and Vitest or Jest for unit layers; place shared fixtures under `tests/fixtures`. Name unit files `<feature>.spec.ts` and integration files `<feature>.int.spec.ts`. Maintain ≥85% statement coverage, documenting any exceptions in the PR checklist. Run `pnpm test -- --coverage` locally and surface results in CI logs. For new specs, outline the test plan before implementation starts.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat:`, `fix:`, `chore:`) with scope reflecting the folder touched (e.g., `feat(src/auth): ...`). Reference spec IDs and linked issues in commit bodies and PR descriptions. Each PR should include: summary, testing evidence (`pnpm test`, `pnpm lint`), and screenshots or logs for UX/CLI changes. Limit PRs to focused changes (<400 modified lines) and request early review for schema or infrastructure updates.

## Specs & Planning
Copy `specs/_TEMPLATE_SPEC.md` into `specs/SPEC-<topic>.md` when proposing work. Track status changes with explicit dates (YYYY-MM-DD) and capture decision rationale, risks, and open questions. Keep specs short, testable, and linked in PR descriptions so reviewers can trace requirements quickly.
