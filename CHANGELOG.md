# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-14

### Added

- `/testgen` slash command: generate, run, and fix unit tests for files,
  directories, and globs; `--runner`, `--generator`, `--iterations`,
  `--model`, `--no-run`, `--json`, `--help` options.
- `generate_tests` model tool: the same pipeline with a validated JSON
  input/output schema, cooperative cancellation, and a never-parallel
  concurrency classification.
- LLM generator: streams through `ctx.llm` (`BlockAssembler`), bounded source
  truncation, fenced-block extraction, provider/model resolution with
  graceful `deepseek-chat` fallback.
- Deterministic template generator: zero-dependency structural smoke tests
  scaffolded from exported symbols (works offline, no API key).
- Generate → run → fix loop: per-framework failure parsing (vitest, jest,
  mocha, node:test) fed back to the LLM, bounded by `maxIterations`.
- Runner autodetect from project dependencies with `node --test` fallback;
  unconditional-ESM `.mts`/`.mjs` emission for node:test targets.
- Hot-reloaded `testgen:` settings namespace (schema defaults → composition
  entry → user section), with request-level overrides per invocation.
- Target resolution with include/exclude glob policy, language detection, and
  hard walk caps; JSX targets under node:test are skipped with a warning.
- Safety: refuses to overwrite existing test files; the fix loop rewrites
  only files this plugin generated; dispose-time abort of in-flight runs.
- Stable `TESTGEN_*` error taxonomy extending `HarnessError`.
- Full engineering rig: 78 vitest unit tests (including a real cordis
  lifecycle test and a real end-to-end `node --test` run), typecheck, lint,
  tsdown build, `dsh.bundle` manifest verification script, GitHub Actions CI.
- Bilingual documentation (README en/zh), input/output specification,
  configuration reference, contributing guide, code of conduct, issue/PR
  templates, demo fixture project.
