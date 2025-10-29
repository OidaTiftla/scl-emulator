# Project Parameters

## Project

- Name: {project-name}
- Summary: {one-liner of what this project does and for whom}
- Primary owners: {names/roles}
- Versioning: SemVer (x.y.z)

## Scope

- Goals: {top 3 measurable goals}
- Non-goals: {explicit exclusions}
- UI scope: {CLI/API/GUI; supported UX surfaces}

## Stack

- Language: {e.g., Python 3.12, TypeScript 5.x, Go 1.23}
- Frameworks: {e.g., FastAPI, React, pytest}
- Package manager: {e.g., pip/uv, npm/pnpm, go modules}
- Min runtime/SDK versions: {list}
- Build tooling: {formatter, linter, test runner}

## Platforms and Compatibility

- Target OS/browsers: {with min versions}
- CPU/Memory assumptions: {if any}
- Internationalization/localization: {if any}

## Licensing and Compliance

- License: {SPDX id, e.g., MIT, Apache-2.0}
- Third-party policy: {allowed licenses, review process}
- Security/Privacy: {data handling expectations, secrets policy}

## Repository Layout

- src/: application/library code
- tests/: unit/integration/UI tests
- specs/: feature specs (SPEC-{short-title}.md); include _TEMPLATE_SPEC.md
- docs/: user and developer docs
- tools/: helper scripts, local dev tooling
- .ci/: CI scripts/config (or .github/workflows/)
- .config files: formatter, linter, test, pre-commit (as applicable)

## Conventions

- Branching: {e.g., trunk-based with short-lived feature branches}
- Code style: {formatter/linter names and strictness}
- Testing: {frameworks}; required coverage threshold: {e.g., 85%}
- Commits/PRs: small, focused; include spec ID in title/body
- Issue labels: feature, bug, tech-debt, perf, docs
- Spec naming: SPEC-{short-title}.md (kebab-case short-title)

## Performance and Quality

- Default budgets: {latency/throughput/memory targets or "N/A"}
- Big-O targets: {expected complexity of core ops}
- CI policy: lint+tests must pass; benchmarks optional/required: {state}

## Developer Quickstart

- Prereqs: {runtimes, package manager}
- Setup:
  - git clone {repo}
  - {package-manager} install
  - Run tests: {command}
  - Run linter/formatter: {commands}
- Create a new spec:
  - Copy specs/_TEMPLATE_SPEC.md to specs/SPEC-{short-title}.md
  - Fill fields; get review from Reviewer-for-Planner (optional)
- Implement:
  - Follow SPEC; add tests in tests/
  - Ensure all acceptance criteria are met
- Verify and Profile:
  - Run full suite and benchmarks; record results

## Release

- Version bump rules: {SemVer policy}
- Release notes owner: Documentation persona
- Distribution/Packaging: {how artifacts are built and published}
