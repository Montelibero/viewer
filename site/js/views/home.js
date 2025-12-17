
import { shorten } from '../common.js?v=11';

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

        const doFetch = async (c) => {
            const url = new URL(`${horizonBase}/assets`);
            url.searchParams.set('asset_code', c);
            url.searchParams.set('limit', 100);
            url.searchParams.set('order', 'desc');
            const res = await fetch(url);
            if (!res.ok) throw new Error('Horizon error');
            return await res.json();
        };

        try {
            let data = await doFetch(code);
            let records = data?._embedded?.records || [];

            // Fallback: if no results and code has lowercase, try uppercase
            if (records.length === 0 && /[a-z]/.test(code)) {
                const upper = code.toUpperCase();
                // Avoid redundant request if logic somehow passed here with all caps (unlikely with regex check but safe)
                if (upper !== code) {
                    const dataUp = await doFetch(upper);
                    const recordsUp = dataUp?._embedded?.records || [];
                    if (recordsUp.length > 0) {
                        records = recordsUp;
                    }
                }
            }

            if (!records.length) {
                 assetResultsEl.textContent = t('assets-empty');
            } else {
                 records.sort((a, b) => (b.accounts?.authorized || 0) - (a.accounts?.authorized || 0));

                 records.forEach(asset => {
                    const li = document.createElement('li');
                    li.className = 'mb-1';
                    
                    const assetLink = document.createElement('a');
                    assetLink.href = `/asset/${asset.asset_code}-${asset.asset_issuer}`;
                    assetLink.textContent = `${asset.asset_code} · ${shorten(asset.asset_issuer)}`;
                    assetLink.className = 'is-mono has-text-weight-semibold mr-2';
                    li.appendChild(assetLink);

                    const toml = asset._links?.toml?.href;
                    if (toml) {
                        try {
                            const domain = new URL(toml).hostname;
                            const domainLink = document.createElement('a');
                            domainLink.href = `https://${domain}`;
                            domainLink.target = '_blank';
                            domainLink.textContent = domain;
                            domainLink.className = 'is-size-7 mr-2';
                            li.appendChild(domainLink);
                        } catch (_) {}
                    }

                    const holders = asset.accounts?.authorized || 0;
                    const holdersSpan = document.createElement('span');
                    holdersSpan.className = 'is-size-7 has-text-grey';
                    holdersSpan.textContent = `(${holders} ${t('holders-label')})`;
                    li.appendChild(holdersSpan);

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
        const upperVal = val.toUpperCase();

        // Regex checks
        if (/^G[A-Z2-7]{55}$/.test(upperVal)) {
            saveHistory(upperVal);
            // Router handles pushState, we just navigate
            history.pushState(null, '', '/account/' + upperVal);
            import('../router.js?v=11').then(m => m.router());
            return;
        }
        if (/^C[A-Z2-7]{55}$/.test(upperVal)) {
            history.pushState(null, '', '/contract/' + upperVal);
            import('../router.js?v=11').then(m => m.router());
            return;
        }
        if (/^[0-9a-f]{64}$/i.test(val)) {
            history.pushState(null, '', '/tx/' + val.toLowerCase());
            import('../router.js?v=11').then(m => m.router());
            return;
        }
        // Allow lowercase letters in asset code
        if (/^[a-zA-Z0-9]{3,12}$/.test(val)) {
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
