# Contributing to Stellar Viewer

## Project Structure
This project is a Single Page Application (SPA) served by Caddy.
- `site/index.html`: The main entry point for the SPA.
- `site/pages/`: Contains HTML template partials for each view (e.g., `account.html`, `asset.html`). These are loaded dynamically by the router.
- `site/js/`: Contains all JavaScript modules, including the main router (`router.js`), view-specific logic (`views/`), and common utilities (`common.js`, `i18n.js`, `operation-view.js`).
  - Note: All common logic for rendering Stellar operations (details, formatting, etc.) is centralized in `site/js/operation-view.js`. When working with operations, start there.
- `site/lang/`: Contains JSON files for internationalization (translations).
- `site/VERSION`: Contains the current global version number of the application.
- `Caddyfile`: Configures serving the static files, rewrites for versioning, and SPA routing.
- `Dockerfile` & `docker-compose.yml`: For containerized deployment.

## Development

### Running Locally
To run the project locally:
```bash
docker compose up viewer-caddy
```
The site will be available at `http://localhost:8080`.

**Important:** The `site/` directory is **copied** into the container during the build process. If you modify files in `site/`, you must rebuild the container to see the changes:
```bash
docker compose up --build viewer-caddy
```

### Adding New Features (Views)
To add a new page or view:
1.  **Create HTML Template**: Create a new file in `site/pages/` (e.g., `newpage.html`). This file should only contain the HTML structure for your view, without `<html>`, `<head>`, or `<body>` tags.
2.  **Create JavaScript Logic**: Create a corresponding file in `site/js/views/` (e.g., `newpage.js`). This file must `export async function init(params, i18n)` which will be called by the router.
3.  **Define Route**: Add a new entry to the `routes` array in `site/js/router.js`. For example:
    ```javascript
    { pattern: /^\/mynewpage\/([^/]+)$/, view: 'newpage' },
    ```
4.  **Add Translations**: Create `site/lang/newpage.en.json`, `site/lang/newpage.ru.json`, etc., for your new view's translation keys.

### Cache Busting & Versioning
The project uses a global versioning system powered by Caddy templates and path rewriting. The version is stored in a single file: `site/VERSION`.

#### How it works
- `site/index.html` loads the version from `site/VERSION` using Caddy templates.
- It constructs paths for CSS and JS assets using this version (e.g., `/v15/js/router.js`).
- `Caddyfile` rewrites any request starting with `/v<number>/` to the actual file path (stripping the version prefix).
- All internal imports in JS files should be **relative** (e.g., `import ... from '../common.js'`) so they automatically inherit the versioned path.

#### Checklist for Updates:
1.  **Run JSON Validation**: Before committing, ensure all JSON files are valid by running:
    ```bash
    node scripts/validate-json.js
    ```
2.  **Bump Version**: If you made any changes to JS, CSS, HTML, or translations, **increment the number in `site/VERSION`**.
    - This will automatically invalidate the cache for all users and load the new assets.
3.  **Do NOT** manually add `?v=...` to imports in code. Rely on the global versioning.

## Coding Style
- Use 2-space indentation for HTML, CSS, and JS.
- Prefer `const`/`let`.
- Use `import` / `export` (ES Modules).
- **Use relative imports** (e.g., `./module.js`, `../common.js`) instead of absolute paths in JS files.
- Prefer Bulma utility classes over custom CSS.
