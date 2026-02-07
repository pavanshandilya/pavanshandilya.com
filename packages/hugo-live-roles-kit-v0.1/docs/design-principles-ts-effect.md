# Design principles used in v0.1 (TS/JS + EffectTS)

This is the subset applied from:
- `content/posts/2026/02/code-review-operating-system/index.md`
- `docs/design/effect-ts-llms-full.txt`

## Applied principles

1. Configuration boundary
- Core pipeline never reads random env values directly.
- All runtime knobs come from one typed config/profile/registry boundary.

2. Error boundary and explicit contracts
- External source calls are wrapped and isolated.
- Failures in one source never crash whole pipeline.

3. Structured concurrency
- Source fetches run with bounded parallelism (`Effect.all`, `Effect.forEach`).
- Discovery probes use bounded concurrency and timeout budgets.

4. Boring reliability over cleverness
- Deterministic merge + dedupe + sort.
- Stable stale/inactive lifecycle policy.

5. OCP/plugin direction
- Source integrations are composable fetcher modules.
- New source should be add-only, minimal core changes.

6. Single responsibility
- `config.ts`: load/resolve config.
- `plugins.ts`: external source adapters.
- `pipeline.ts`: scoring, policy, merge lifecycle.
- `cli.ts`: entrypoint only.

## Deliberately avoided in v0.1

- Heavy framework magic
- Hidden behavior via global mutable state
- Hardcoded user-specific logic in core
