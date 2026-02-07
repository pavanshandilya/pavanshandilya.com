# pavanshandilya.com

Shared Hugo website for Pavan and Pooja using the `ink-free` theme.

## What this repo includes

- Common site content: About, Blog, Notes, Playbook
- Two independent live roles pipelines:
  - Pavan: `data/roles/pavan.yml`
  - Pooja: `data/roles/pooja.yml`
- Daily CI role refresh and GitHub Pages deployment

## First-time setup

1. Initialize submodules
- `git submodule update --init --recursive`

2. Install live roles kit dependencies
- `npm --prefix packages/hugo-live-roles-kit-v0.1 install`

3. Validate roles setup
- `npm run roles:check`

4. Run both role fetch pipelines
- `npm run fetch:roles`

5. Build Hugo
- `npm run build:hugo`

6. Local server
- `npm run dev`

## Important paths

- Site config: `hugo.toml`
- Shared playbook page: `content/playbook/_index.md`
- Shared about page: `content/about.md`
- Blog posts: `content/posts/`
- Notes: `content/notes/`
- Live roles page: `content/live-roles.md`

### Roles setup

- Pavan profile: `roles-kit/profiles/pavan.yml`
- Pooja profile: `roles-kit/profiles/pooja.yml`
- Pavan config: `roles-kit/configs/pavan.roles.config.yml`
- Pooja config: `roles-kit/configs/pooja.roles.config.yml`
- Pavan source registry: `roles-kit/sources/pavan.roles-sources.yml`
- Pooja source registry: `roles-kit/sources/pooja.roles-sources.yml`

## Role customization (no code changes)

Each profile controls role focus via `active_bucket_ids`.

Example switches:
- Pooja to EM:
```yml
active_bucket_ids: [em_tech]
```
- Pavan to PM + Scrum:
```yml
active_bucket_ids: [pm_product, scrum_agile]
```

Other easy custom knobs in profile YAML:
- `locations.countries` and `locations.cities`
- `keywords.must_have`, `keywords.nice_to_have`, `keywords.exclude`
- bucket-level `include_title_keywords`, `include_text_keywords`

Then run:
- `npm run fetch:roles`

## CI workflows

- Deploy: `.github/workflows/deploy.yml`
- Live roles refresh: `.github/workflows/live-roles.yml`

## Hosting modes (built in)

Deploy workflow supports two modes:

1. Same-repo GitHub Pages (default)
- Set optional repo variable: `SITE_BASE_URL`
- If not set, URL is auto-derived.

2. Separate hosting repo (project Pages or user-site)
- Set repo variable: `USER_SITE_REPOSITORY` (for you: `pavanshandilya/pavanshandilya`)
- Optional repo variable: `USER_SITE_BASE_URL` (for you: `https://pavanshandilya.github.io/pavanshandilya/`)
- Add secret: `PERSONAL_TOKEN` (PAT with contents write on target repo)

When `USER_SITE_REPOSITORY` is set, workflow auto-publishes built `public/` to that external repo `gh-pages` branch.

## Base URL behavior (best practice)

- `hugo.toml` keeps a canonical placeholder: `https://example.org/`
- Local dev uses `http://localhost:1313/` via `npm run dev`
- CI deploy always injects the final URL dynamically in `.github/workflows/deploy.yml`
  - same-repo mode: `SITE_BASE_URL` or computed fallback (`https://<owner>.github.io/<repo>/`)
  - separate repo mode:
    - if target repo is `<username>.github.io`: `https://<username>.github.io/`
    - if target repo is normal repo `<username>/<repo>`: `https://<username>.github.io/<repo>/`
