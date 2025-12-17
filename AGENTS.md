# Repository Guidelines

## Project Structure & Module Organization
- Single Page Application served from `site/index.html`; Bulma 1.0.4 is loaded from CDN with shared styles in `site/common.css`.
- `site/pages/` stores HTML partials for each view (no `<html>/<body>` tags) that are injected by the client router; matching view logic lives in `site/js/views/` with `export async function init(params, i18n)` (and optional `cleanup`).
- `site/js/router.js` defines the `routes` array and performs dynamic imports of templates and view modules; `site/js/operation-view.js` centralizes operation rendering; `site/js/i18n.js` handles translations; `site/lang/` holds per-view JSON locale files.
- `Caddyfile` rewrites all requests to `index.html` (SPA routing) and serves static assets.
- `docker-compose.yml` builds/runs the Caddy container (ports `8080:80` exposed) with `caddy_data` and `caddy_config` volumes; network `web` is external.

## Build, Test, and Development Commands
- Run locally: `docker compose up viewer-caddy`, then open `http://localhost:8080`.
- Rebuild to pick up changes under `site/`: `docker compose up --build viewer-caddy`.
- Tear down containers with `docker compose down` (`--volumes` only when intentionally clearing cached Caddy data).
- No build pipeline; edit files in `site/` directly and refresh/rebuild.

## Coding Style & Naming Conventions
- Use 2-space indentation and ES modules with `const`/`let`.
- Add new views by creating matching files in `site/pages/` and `site/js/views/` and wiring a route in `site/js/router.js`.
- Keep custom CSS minimal (prefer Bulma utilities) and scoped in `site/common.css` or small per-view blocks.
- Maintain kebab-case for IDs/file names and keep translations aligned across locales.

## Cache Busting & Versioning
- Static assets use a manual version query (currently `v=8`). When changing JS/CSS/translation files, bump the version in `site/index.html` imports/links and in `site/js/router.js` dynamic imports to avoid stale caches.

## Testing Guidelines
- No automated tests; perform manual checks: home search flow, account view, transaction view, offers/operations lists (including pagination) and navigation without full reloads.
- When changing regexes or routing logic, test valid/invalid inputs and ensure error messages stay localized.
- Verify translations load after version bumps and spot-check mobile viewport layout.

## Commit & Pull Request Guidelines
- Follow the existing history: short, imperative commit subjects (e.g., "update transaction view").
- Keep PRs small and focused; include a brief summary of what changed, manual test notes, and screenshots for visible UI updates.
- Link to related issues when available and call out any configuration changes (e.g., Caddy routes or compose port mappings).

## Security & Configuration Tips
- Do not bake secrets into HTML or the Caddy config; all pages are static.
- Traefik labels in `docker-compose.yml` are examples only—coordinate with ops before enabling or modifying them.

## Task Intake Protocol
- For each new task, first analyze the requirements and explicitly state which files or directories need to change.
- Do not edit any files until there is direct permission that names the specific file(s) or directory that may be modified—no exceptions.
- Before editing any file, estimate the chance the request can be interpreted in multiple ways; if there is more than a ~20% chance of ambiguity, ask the user to clarify the exact change.
