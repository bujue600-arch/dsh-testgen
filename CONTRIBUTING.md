# Contributing to dsh-testgen

Thanks for your interest! This is a small, focused plugin — contributions of
any size are welcome: bug reports, docs, tests, and features.

## Ground rules

- **Respect the seam.** The plugin composes through one `cordis.patch.yml`
  insert row and hard-injects only `commands` and `tools`. Keep it that way —
  no core patches, no monkey-patching framework internals.
- **Keep the contract.** The `TestgenReport` shape is the plugin's public
  contract. Changes to it must update `src/types.ts`, the tool schema in
  `src/tool.ts`, and `docs/io-spec.md` together.
- **Tests are part of the change.** New behavior ships with unit tests; the
  engine modules (`src/engine/*`) stay pure and injectable for exactly that
  reason.

## Development setup

```sh
git clone https://github.com/bujue600-arch/dsh-testgen.git
cd dsh-testgen
pnpm install
```

Requires Node ≥ 22 and pnpm 10.

## Quality gates (all must pass)

```sh
pnpm run typecheck     # strict TypeScript
pnpm run lint          # eslint
pnpm test              # vitest, 78 tests
pnpm run build         # tsdown → lib/
pnpm run verify:manifest  # dsh.bundle / exports / files contract
```

## Making a change

1. Open an issue first (use the templates) for anything beyond a trivial fix,
   so design discussion happens before code.
2. Branch from `main`, keep commits focused and conventionally worded
   (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
3. Add/update tests, docs, and the changelog as needed.
4. Run the full quality-gate list above.
5. Open a pull request with a summary of what changed and why.

## Project layout

| Path | Purpose |
|---|---|
| `src/index.ts` | cordis entry: `name` / `inject` / `Config` / `apply` |
| `src/engine/` | pure core: resolve, template generator, LLM generator, runner, pipeline |
| `src/schema.ts` | config + settings namespace schemas |
| `cordis.patch.yml` | bundle patch (one insert row) |
| `docs/` | io-spec and configuration reference |
| `examples/fixture/` | demo project used by `pnpm run demo` |
| `test/` | vitest unit tests |

## Release process (maintainers)

1. Update `CHANGELOG.md` under a new heading.
2. Bump `version` in `package.json` (SemVer — no `v` prefix there).
3. `pnpm run build && pnpm run verify:manifest`
4. Commit, tag (`vX.Y.Z`), push; CI publishes nothing automatically — npm
   publishing is a manual step.

## Code of conduct

All participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
