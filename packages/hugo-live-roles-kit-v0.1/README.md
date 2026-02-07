# Hugo Live Roles Kit v0.1

A portable, config-driven jobs pipeline you can drop into any Hugo site.

This v0.1 is designed to be:
- Boring reliable
- Fully pluggable
- Non-tech friendly (edit YAML knobs, no code required)
- Germany-first with EU coverage by profile, not hardcoded logic

## Provider compatibility (integrated)

Direct integrations in code:
- Greenhouse
- Lever
- Personio XML feeds
- SmartRecruiters
- Teamtailor
- Recruitee
- Ashby
- StepStone feeds (URL feed mode)
- Arbeitnow
- Remotive
- Jobicy
- Adzuna (API key)
- Jooble (API key)
- SerpAPI Google Jobs + Google organic discovery (API key)

Major boards covered through SerpAPI query pipeline:
- LinkedIn Jobs
- Indeed
- XING
- Naukri
- StepStone and other board links found in search results

Official company websites:
- You can add direct career URLs in `official_career_pages`
- SerpAPI official-site queries discover more career pages over time
- JSON-LD (`JobPosting`) is parsed from official pages when enabled

## API keys and where to get them

Set these as GitHub repo secrets for CI and/or local env vars:

| Provider | Secret/env key | Where to get it |
| --- | --- | --- |
| SerpAPI | `SERPAPI_API_KEY` | https://serpapi.com/manage-api-key |
| Adzuna | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | https://developer.adzuna.com/ |
| Jooble | `JOOBLE_API_KEY` | https://jooble.org/api/about |

Non-secret runtime settings now live in repo file:
- `roles-kit/providers.runtime.yml`
- use it for locale, countries, and extra source/query lists

## Design principles (applied from your docs)

Applicable principles from `content/posts/2026/02/code-review-operating-system/index.md` + Effect notes:
- Configuration boundary: config/profile/registry only, no scattered env reads.
- Explicit contracts: predictable YAML structure and typed interfaces.
- Structured concurrency: bounded parallel fetches (`Effect.all` / `Effect.forEach`).
- Boundary error handling: each source isolated; one source failing does not fail whole run.
- Boring reliability: deterministic merge/dedupe/stale/archive lifecycle.
- OCP/plugin style: add sources by extending source lists and plugin fetchers.

## Folder layout

```text
packages/hugo-live-roles-kit-v0.1/
  src/
    cli.ts
    config.ts
    http.ts
    pipeline.ts
    plugins.ts
    types.ts
    util.ts
  examples/
    roles.config.yml
    roles-sources.yml
    profiles/data-engineer-de-eu.yml
    live-roles-shortcode.html
```

## Quick start (inside this repo)

1. Install toolkit deps
```bash
cd packages/hugo-live-roles-kit-v0.1
npm install
```

2. Initialize config into project root
```bash
npm run check -- --config ../../packages/hugo-live-roles-kit-v0.1/examples/roles.config.yml --profiles ../../packages/hugo-live-roles-kit-v0.1/examples/profiles
```

3. Copy examples into site root
```bash
mkdir -p ../../roles-kit/profiles
cp examples/roles.config.yml ../../roles-kit/roles.config.yml
cp examples/roles-sources.yml ../../roles-kit/roles-sources.yml
cp examples/profiles/data-engineer-de-eu.yml ../../roles-kit/profiles/data-engineer-de-eu.yml
```

4. Run fetch
```bash
npm run fetch -- --config ../../roles-kit/roles.config.yml --profiles ../../roles-kit/profiles
```

Output is written to `data/roles.yml` by default.

## Knobs non-tech users can edit

In `roles-kit/roles.config.yml`:
- `profile_id`
- `knobs.stale_after_days`
- `knobs.inactive_after_days`
- `knobs.inactive_action` (`archive` or `hard_delete`)
- `knobs.max_concurrency`
- `discovery.enabled`
- source arrays under `sources.*`

In `roles-kit/profiles/<id>.yml`:
- skills
- simple location controls (`locations.countries`, `locations.cities`)
- keyword controls (`keywords.must_have`, `keywords.nice_to_have`, `keywords.exclude`)
- advanced geography patterns
- bucket definitions (title patterns, thresholds, limits)

In `roles-kit/roles-sources.yml`:
- `explicit.*` manual inputs
- `discovered.*` auto-appended by pipeline

## Hugo integration

1. Copy `examples/live-roles-shortcode.html` to your Hugo site:
- `layouts/shortcodes/live-roles.html`

2. Use shortcode in content:
```markdown
{{</* live-roles */>}}
```

## CI example

Run daily and commit:
```bash
npm --prefix packages/hugo-live-roles-kit-v0.1 run fetch -- --config roles-kit/roles.config.yml --profiles roles-kit/profiles
```
Then commit `data/roles.yml` and `roles-kit/roles-sources.yml`.

## Portable to another Hugo site

Copy this folder and keep the same commands. Only update:
- `roles-kit/roles.config.yml`
- `roles-kit/profiles/*.yml`
- Hugo shortcode location
