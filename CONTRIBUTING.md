# Contributing to Stellar Viewer

## Project Structure
This project is a Single Page Application (SPA) served by Caddy.
- `site/index.html`: The main entry point for the SPA.
- `site/pages/`: Contains HTML template partials for each view (e.g., `account.html`, `asset.html`). These are loaded dynamically by the router.
- `site/js/`: Contains all JavaScript modules, including the main router (`router.js`), view-specific logic (`views/`), and common utilities (`common.js`, `i18n.js`, `operation-view.js`).
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
The project relies on aggressive caching strategies. To ensure users receive the latest code and translations immediately, we use manual versioning via query parameters.

**Whenever you modify any JS file, CSS file, or Translation (JSON) file, you must update the version number in `site/index.html` and potentially in `site/js/router.js` dynamic imports (if you modify these files directly).**

Current Version: `8`

#### Checklist for Updates:
1.  **CSS**: Update the version query parameter in `site/index.html`:
    ```html
    <link id="common-css" rel="stylesheet" href="/common.css?v=8">
    ```
2.  **JavaScript Imports**: Update the version query parameter for imports in `site/index.html`:
    ```javascript
    import { router } from '/js/router.js?v=8';
    import { initI18n } from '/js/i18n.js?v=8';
    import { appVersion } from '/js/common.js?v=8';
    ```
    And also check dynamic imports in `site/js/router.js` for view templates and view scripts (e.g. `tplRes = await fetch(/pages/${viewName}.html?v=8)` and `module = await import(./views/${viewName}.js?v=8)`).
3.  **Translations**: The `site/js/i18n.js` module handles appending the version to translation requests based on the `router.js`'s configuration.

## Coding Style
- Use 2-space indentation for HTML, CSS, and JS.
- Prefer `const`/`let`.
- Use `import` / `export` (ES Modules).
- Prefer Bulma utility classes over custom CSS.