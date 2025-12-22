# Contributing to Stellar Viewer

## Project Structure
This project is a Single Page Application (SPA) served by Caddy.
- `site/index.html`: The main entry point for the SPA.
- `site/pages/`: Contains HTML template partials for each view (e.g., `account.html`, `asset.html`). These are loaded dynamically by the router.
- `site/js/`: Contains all JavaScript modules, including the main router (`router.js`), view-specific logic (`views/`), and common utilities (`common.js`, `i18n.js`, `operation-view.js`).
  - Note: All common logic for rendering Stellar operations (details, formatting, etc.) is centralized in `site/js/operation-view.js`. When working with operations, start there.
- `site/lang/`: Contains JSON files for internationalization (translations).
- `Caddyfile`: Configures serving the static files and potentially rewrites all requests to `index.html` for client-side routing.
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

### Cache Busting & Versioning (Critical)
The project relies on manual cache-busting via query parameters. Bump versions **only for assets you touched**; it is fine for different files to carry different version numbers.

Current working version for updated assets: `14` (older untouched files may still use `7/8/9`).

#### Checklist for Updates:
1.  **Run JSON Validation**: Before committing, ensure all JSON files are valid by running:
    ```bash
    node scripts/validate-json.js
    ```
2.  **If you change CSS** (e.g., `site/common.css`), bump its query in `site/index.html`:
    ```html
    <link id="common-css" rel="stylesheet" href="/common.css?v=13">
    ```
2.  **If you change JS**:
    - Bump the import in `site/index.html` for the entry files you modified (e.g., `router.js`, `common.js`, `i18n.js`).
    - Update dynamic imports in `site/js/router.js` for view templates/scripts when you change view code, so the new versions are fetched:
      ```javascript
      const tplRes = await fetch(`/pages/${viewName}.html?v=13`);
      const module = await import(`./views/${viewName}.js?v=13`);
      ```
3.  **If you change translations**, ensure the translation fetch in `site/js/i18n.js` points to the bumped version for those files.
4.  Avoid blanket version bumps across untouched files; only update what you changed in the commit.

## Coding Style
- Use 2-space indentation for HTML, CSS, and JS.
- Prefer `const`/`let`.
- Use `import` / `export` (ES Modules).
- Prefer Bulma utility classes over custom CSS.
