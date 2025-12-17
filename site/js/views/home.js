
import { shorten } from '../../common.js?v=6';

export async function init(params, i18n) {
    const { t } = i18n;
    const inputEl = document.getElementById('search-input');
    const buttonEl = document.getElementById('search-btn');
    const messageEl = document.getElementById('message');
    const historyEl = document.getElementById('history');
    const assetResultsEl = document.getElementById('asset-results');

    const STORAGE_KEY = 'viewer_account_history';
    const horizonBase = 'https://horizon.stellar.org';

    // Helper functions (copied from old index logic)
    function showMessage(key) {
        if (!key) {
            messageEl.textContent = '';
            messageEl.classList.add('is-hidden');
            return;
        }
        messageEl.textContent = t(key);
        messageEl.classList.remove('is-hidden');
    }

    function loadHistory() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) { return []; }
    }

    function saveHistory(accountId) {
        const history = loadHistory();
        const next = [accountId, ...history.filter(x => x !== accountId)].slice(0, 10);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        renderHistory();
    }

    function renderHistory() {
        const list = loadHistory();
        historyEl.innerHTML = '';
        if (!list.length) {
            historyEl.textContent = t('history-empty');
            return;
        }
        list.forEach(acc => {
            const li = document.createElement('li');
            const link = document.createElement('a');
            link.href = '/account/' + acc;
            link.textContent = acc;
            link.className = 'is-mono';
            li.appendChild(link);
            historyEl.appendChild(li);
        });
    }

    async function searchAssets(code) {
        assetResultsEl.innerHTML = '';
        showMessage('message-loading-assets');
        try {
            const url = new URL(`${horizonBase}/assets`);
            url.searchParams.set('asset_code', code);
            url.searchParams.set('limit', 100);
            url.searchParams.set('order', 'desc');
            const res = await fetch(url);
            if (!res.ok) throw new Error('Horizon error');
            const data = await res.json();
            const records = data?._embedded?.records || [];

            if (!records.length) {
                 assetResultsEl.textContent = t('assets-empty');
            } else {
                 records.forEach(asset => {
                    const li = document.createElement('li');
                    li.className = 'mb-1';
                    const link = document.createElement('a');
                    link.href = `/asset/${asset.asset_code}-${asset.asset_issuer}`;
                    link.textContent = `${asset.asset_code} · ${shorten(asset.asset_issuer)}`;
                    link.className = 'is-mono';
                    li.appendChild(link);
                    assetResultsEl.appendChild(li);
                 });
            }
            showMessage('');
        } catch (e) {
            console.error(e);
            showMessage('message-asset-error');
        }
    }

    function handleSearch() {
        const val = inputEl.value.trim();
        if (!val) { showMessage('message-empty-input'); return; }

        // Regex checks
        if (/^G[A-Z2-7]{55}$/.test(val)) {
            saveHistory(val);
            // Router handles pushState, we just navigate
            history.pushState(null, '', '/account/' + val);
            import('../router.js?v=6').then(m => m.router());
            return;
        }
        if (/^[0-9a-f]{64}$/i.test(val)) {
            history.pushState(null, '', '/tx/' + val.toLowerCase());
            import('../router.js?v=6').then(m => m.router());
            return;
        }
        if (/^[A-Z0-9]{3,12}$/.test(val)) {
            searchAssets(val);
            return;
        }
        showMessage('message-unknown-format');
    }

    buttonEl.onclick = handleSearch;
    inputEl.onkeydown = (e) => { if(e.key === 'Enter') handleSearch(); };

    renderHistory();

    // Apply translations to static elements in template
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
}
