import { initI18n } from './i18n.js';

const routes = [
  { pattern: /^\/$/, view: 'home' },
  { pattern: /^\/account\/([^/]+)$/, view: 'account' },
  { pattern: /^\/account\/([^/]+)\/operations$/, view: 'account-operations', mixins: ['operation-types', 'operations'] },
  { pattern: /^\/pool\/([^/]+)$/, view: 'pool' },
  { pattern: /^\/pool\/([^/]+)\/operations$/, view: 'pool-operations', mixins: ['operation-types', 'operations'] },
  { pattern: /^\/transaction\/([0-9a-f]{64})$/, view: 'transaction', mixins: ['operation-types', 'operations'] },
  { pattern: /^\/tx\/([0-9a-f]{64})$/, view: 'transaction', mixins: ['operation-types', 'operations'] },
  { pattern: /^\/operation\/(\d+)$/, view: 'operation', mixins: ['operation-types', 'operations'] },
  { pattern: /^\/offer\/(\d+)$/, view: 'offer' },
  { pattern: /^\/offer\/(\d+)\/trades$/, view: 'offer-trades' },
  { pattern: /^\/contract\/([A-Z0-9]{56})$/, view: 'contract' },
  { pattern: /^\/ledger\/(\d+)$/, view: 'ledger' },
  { pattern: /^\/asset\/(.+)$/, view: 'asset' },
  { pattern: /^\/account\/([^/]+)\/offers$/, view: 'account-offers' },
  { pattern: /^\/account\/([^/]+)\/(2025)$/, view: 'account-year-stats' }
];

let currentView = null;

async function loadView(route, params) {
    const viewName = route.view;
    const mixins = route.mixins || [];
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
        // Use import.meta.url to resolve the path relative to THIS file (router.js),
        // preserving the version prefix (e.g. /v15/js/router.js -> /v15/pages/view.html).
        const tplUrl = new URL(`../pages/${viewName}.html`, import.meta.url).href;
        const tplRes = await fetch(tplUrl);
        if (!tplRes.ok) throw new Error(`Template ${viewName} not found`);
        const html = await tplRes.text();
        app.innerHTML = html;

        // Load Script
        // Relative import works automatically with the versioned base
        const module = await import(`./views/${viewName}.js`);
        if (module && typeof module.init === 'function') {
            currentView = module;
            // Get i18n instance from window or re-init
            // Ideally pass a localized helper
            const baseName = viewName === 'home' ? 'index' : viewName;
            const i18n = await initI18n({ baseName, mixins });
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
            await loadView(route, params);
            return;
        }
    }

    // 404
    await loadView({ view: '404' });
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
