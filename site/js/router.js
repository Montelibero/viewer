
import { initI18n } from '../i18n.js?v=9';

const routes = [
  { pattern: /^\/$/, view: 'home' },
  { pattern: /^\/account\/([^/]+)$/, view: 'account' },
  { pattern: /^\/account\/([^/]+)\/operations$/, view: 'account-operations' },
  { pattern: /^\/pool\/([^/]+)$/, view: 'pool' },
  { pattern: /^\/pool\/([^/]+)\/operations$/, view: 'pool-operations' },
  { pattern: /^\/transaction\/([0-9a-f]{64})$/, view: 'transaction' },
  { pattern: /^\/tx\/([0-9a-f]{64})$/, view: 'transaction' },
  { pattern: /^\/operation\/(\d+)$/, view: 'operation' },
  { pattern: /^\/asset\/(.+)$/, view: 'asset' },
  { pattern: /^\/offers\/([^/]+)$/, view: 'offers' }
];

let currentView = null;

async function loadView(viewName, params) {
    const app = document.getElementById('app');

    // Cleanup previous view
    if (currentView && typeof currentView.cleanup === 'function') {
        currentView.cleanup();
    }
    currentView = null;

    // Show loading or just clear
    app.innerHTML = '<div class="section"><progress class="progress is-small is-primary" max="100">Loading</progress></div>';

    try {
        // Load Template
        const tplRes = await fetch(`/pages/${viewName}.html?v=9`);
        if (!tplRes.ok) throw new Error(`Template ${viewName} not found`);
        const html = await tplRes.text();
        app.innerHTML = html;

        // Load Script
        const module = await import(`./views/${viewName}.js?v=9`);
        if (module && typeof module.init === 'function') {
            currentView = module;
            // Get i18n instance from window or re-init
            // Ideally pass a localized helper
            const baseName = viewName === 'home' ? 'index' : viewName;
            const i18n = await initI18n({ baseName });
            await module.init(params, i18n);
        }
    } catch (err) {
        console.error(err);
        app.innerHTML = `<div class="notification is-danger">Error loading page: ${err.message}</div>`;
    }
}

export async function router() {
    const path = window.location.pathname;

    for (const route of routes) {
        const match = path.match(route.pattern);
        if (match) {
            const params = match.slice(1);
            await loadView(route.view, params);
            return;
        }
    }

    // 404
    document.getElementById('app').innerHTML = '<div class="section"><div class="notification is-warning">Page not found</div></div>';
}

window.addEventListener('popstate', router);
document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', e => {
        if (e.target.matches('a') && e.target.origin === window.location.origin) {
            e.preventDefault();
            history.pushState(null, '', e.target.href);
            router();
        }
    });
    router();
});
