# Repository Guidelines

## Project Structure & Module Organization
- `site/` holds all static assets; each page is a standalone HTML file with inline ES modules and minimal CSS tweaks layered on top of Bulma 1.0.0 from CDN.
- Current pages in `site/`: `index.html`, `account.html`, `transaction.html`, `operations.html`, `operation.html`, `asset.html`, and `pool.html`.
- `Caddyfile` configures routing so `/account/<id>` rewrites to `account.html`, `/transaction/<hash>` to `transaction.html`, `/operations/<id>` to `operations.html`, `/operation/<id>` to `operation.html`, `/assets/<id>` to `asset.html`, and `/pool/<id>` to `pool.html`; adjust here when adding new pages.
- `docker-compose.yml` runs Caddy with the `site/` directory mounted read-only; volumes `caddy_data` and `caddy_config` store Caddy state.

## Build, Test, and Development Commands
- Run locally via `docker compose up viewer-caddy` after temporarily enabling the `ports: ["8080:80"]` block in `docker-compose.yml`; visit `http://localhost:8080`.
- Tear down containers and volumes with `docker compose down` (use `--volumes` only when you intentionally want to drop cached Caddy data).
- No build pipeline is used; edit files in `site/` directly and refresh the browser.

## Coding Style & Naming Conventions
- Use 2-space indentation for HTML, CSS, and JS; prefer `const`/`let` and small helper functions (see `site/index.html`).
- Keep scripts as `<script type="module">` blocks at the end of each page; use vanilla DOM APIs and avoid bundlers.
- Prefer Bulma utility classes over custom CSS; if custom styles are needed, keep them in the page-level `<style>` blocks and scope narrowly.
- IDs and file names use kebab-case (e.g., `search-input`, `transaction.html`); keep new routes consistent with existing rewrite rules.

## Testing Guidelines
- No automated tests yet; perform manual checks after changes: load the home page search flow, an account view, and a transaction view to verify routing and validation messages.
- When altering regexes or navigation logic, test both valid and invalid inputs to ensure error messaging remains helpful and localized.
- If adding scripts, test on mobile viewport sizes to confirm layout stability with Bulma defaults.

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
