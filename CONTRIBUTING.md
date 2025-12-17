# Contributing to Stellar Viewer

## Project Structure
This project is a static website served by Caddy.
- `site/`: Contains all static assets (HTML, JS, CSS, JSON). Each page is a standalone HTML file.
- `Caddyfile`: Configures routing and URL rewrites.
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

### Adding New Features
1.  **Static Files**: Use standard HTML, CSS, and vanilla JavaScript (ES Modules). Avoid build tools/bundlers.
2.  **Routing**: If you add a new HTML file (e.g., `newpage.html`) that handles a specific route (e.g., `/newpage/123`), you **must** add a rewrite rule in `Caddyfile`.

### Cache Busting & Versioning (Critical)
The project relies on aggressive caching strategies. To ensure users receive the latest code and translations immediately, we use manual versioning via query parameters.

**Whenever you modify any JS file, CSS file, or Translation (JSON) file, you must update the version number everywhere.**

Current Version: `8`

#### Checklist for Updates:
1.  **CSS**: Update the link in `<head>` of **all** HTML files:
    ```html
    <link id="common-css" rel="stylesheet" href="/common.css?2">
    ```
2.  **JavaScript Imports**: Update dynamic imports in **all** HTML files and JS files:
    ```javascript
    import('./common.js?2')
    import('./i18n.js?2')
    import('./operation-view.js?2')
    ```
3.  **Translations**: The file `site/i18n.js` appends the version to translation requests. Ensure `buildLangUrl` uses the correct version (e.g., `?v=2`).

## Coding Style
- Use 2-space indentation for HTML, CSS, and JS.
- Prefer `const`/`let`.
- Use `import` / `export` (ES Modules).
- Prefer Bulma utility classes over custom CSS.
