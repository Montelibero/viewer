import { shorten } from '/js/common.js?v=12';

const horizonBase = 'https://horizon.stellar.org';

function formatAssetLabel(asset) {
    if (!asset || asset === 'native') return 'XLM';
    const [code, issuer] = asset.split(':');
    return `${code || '—'} · ${issuer ? shorten(issuer) : '—'}`;
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [poolId] = params;

    // UI References
    const statusLabel = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const poolIdEl = document.getElementById('pool-id');
    const holdersBox = document.getElementById('holders-box');
    const holdersList = document.getElementById('holders-list');
    const holdersLoader = document.getElementById('holders-loader');

    let holdersData = null;
    let holdersVisible = false;

    if (poolIdEl) poolIdEl.textContent = poolId;

    function setStatus(state) {
        if (!statusLabel) return;
        statusLabel.classList.remove('is-danger', 'is-success', 'is-info');
        let key = 'status-loading';
        if (state === 'ok') {
            statusLabel.classList.add('is-success');
            key = 'status-ok';
        } else if (state === 'error') {
            statusLabel.classList.add('is-danger');
            key = 'status-error';
        } else {
            statusLabel.classList.add('is-info');
        }
        statusLabel.textContent = t(key);
    }

    function showLoading(on) {
        if (loader) {
            loader.textContent = t('loader-text');
            loader.classList.toggle('is-hidden', !on);
        }
    }

    function showError(messageKey, { detail = '' } = {}) {
        if (!errorBox || !errorText) return;
        const base = messageKey ? t(messageKey) : '';
        const msg = detail ? `${base ? base + ': ' : ''}${detail}` : base;
        errorText.textContent = msg || detail || '';
        errorBox.classList.remove('is-hidden');
        setStatus('error');
    }

    function clearError() {
        if (errorBox) errorBox.classList.add('is-hidden');
    }

    function renderReserves(reserves) {
        const listEl = document.getElementById('reserves');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (!reserves?.length) {
            listEl.textContent = t('reserves-empty');
            return;
        }

        reserves.forEach(r => {
            const li = document.createElement('li');
            li.className = 'mb-2';

            let assetLabelStr = '';
            if (r.asset === 'native') {
                assetLabelStr = 'XLM';
            } else {
                const [code, issuer] = r.asset.split(':');
                const display = `${code || '—'} · ${issuer ? shorten(issuer) : '—'}`;
                assetLabelStr = display;
                if (code && issuer) {
                    const link = document.createElement('a');
                    link.href = `/asset/${encodeURIComponent(`${code}-${issuer}`)}`;
                    link.textContent = display;
                    link.className = 'has-text-weight-semibold';
                    li.appendChild(link);
                }
            }

            if (!li.childNodes.length) {
                const strong = document.createElement('strong');
                strong.textContent = assetLabelStr;
                li.appendChild(strong);
            }

            const amount = document.createElement('div');
            amount.innerHTML = `${t('amount-label')}: <span class="has-text-weight-semibold">${r.amount}</span>`;
            li.appendChild(amount);

            listEl.appendChild(li);
        });
    }

    function renderPool(pool) {
        if (poolIdEl) poolIdEl.textContent = pool.id;
        const typeEl = document.getElementById('pool-type');
        const feeEl = document.getElementById('pool-fee');
        const sharesEl = document.getElementById('pool-shares');
        const tlEl = document.getElementById('pool-tl');
        const updatedEl = document.getElementById('pool-updated');

        if(typeEl) typeEl.textContent = pool.type || '—';
        if(feeEl) feeEl.textContent = pool.fee_bp ?? '—';
        if(sharesEl) sharesEl.textContent = pool.total_shares ?? '—';
        if(tlEl) tlEl.textContent = pool.total_trustlines ?? '—';
        if(updatedEl) updatedEl.textContent = pool.last_modified_time ? `${t('updated-label')}: ${pool.last_modified_time}` : '';

        setStatus('ok');

        renderReserves(pool.reserves);

        const btnOps = document.getElementById('btn-operations');
        const btnTx = document.getElementById('btn-transactions');
        if(btnOps) btnOps.href = `${horizonBase}/liquidity_pools/${pool.id}/operations?limit=20&order=desc`;
        if(btnTx) btnTx.href = `${horizonBase}/liquidity_pools/${pool.id}/transactions?limit=20&order=desc`;

        // External links
        const stellarXBtn = document.getElementById('btn-stellarx');
        const scopulyBtn = document.getElementById('btn-scopuly');
        const expertBtn = document.getElementById('btn-expert');

        const reserves = Array.isArray(pool.reserves) ? pool.reserves : [];
        const assetPathPart = (asset) => {
            if (!asset) return null;
            if (asset === 'native') return 'native';
            const [code, issuer] = asset.split(':');
            if (!code || !issuer) return null;
            return `${code}:${issuer}`;
        };
        let stellarXPath = null;
        if (reserves.length === 2) {
            const parts = reserves.map(r => assetPathPart(r.asset)).filter(Boolean);
            if (parts.length === 2) {
                parts.sort((a, b) => {
                    if (a === 'native') return -1;
                    if (b === 'native') return 1;
                    return a.localeCompare(b);
                });
                stellarXPath = `https://www.stellarx.com/amm/analytics/${parts[0]}/${parts[1]}`;
            }
        }
        if (stellarXBtn) {
            if (stellarXPath) {
                stellarXBtn.href = stellarXPath;
                stellarXBtn.classList.remove('is-static');
                stellarXBtn.target = '_blank';
                stellarXBtn.rel = 'noreferrer';
            } else {
                stellarXBtn.href = '#';
                stellarXBtn.classList.add('is-static');
            }
        }

        if (scopulyBtn) {
            scopulyBtn.href = `https://scopuly.com/pool/${pool.id}`;
            scopulyBtn.target = '_blank';
            scopulyBtn.rel = 'noreferrer';
        }

        if (expertBtn) {
            expertBtn.href = `https://stellar.expert/explorer/public/liquidity-pool/${pool.id}`;
            expertBtn.target = '_blank';
            expertBtn.rel = 'noreferrer';
        }
    }

    async function loadPool() {
        if (!poolId) {
            showError('error-no-pool-id');
            return;
        }

        clearError();
        setStatus('loading');
        showLoading(true);

        try {
            const res = await fetch(`${horizonBase}/liquidity_pools/${poolId}`);
            if (!res.ok) {
                throw new Error(`Horizon error ${res.status}`);
            }
            const data = await res.json();
            renderPool(data);
        } catch (e) {
            console.error(e);
            showError('error-load-pool', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    }

    async function fetchAllHolders() {
        const holders = [];
        let nextUrl = `${horizonBase}/accounts?liquidity_pool=${poolId}&limit=200&order=asc`;
        let lastCursor = null;

        while (nextUrl) {
            const res = await fetch(nextUrl);
            if (!res.ok) throw new Error(`Horizon error ${res.status}`);

            const data = await res.json();
            const records = data?._embedded?.records || [];

            records.forEach(r => {
                const assetBalance = r.balances.find(b => b.liquidity_pool_id === poolId);
                holders.push({
                    id: r.id,
                    balance: parseFloat(assetBalance?.balance || 0)
                });
            });

            if (!records.length) break;

            const nextHref = data?._links?.next?.href;
            if (!nextHref) break;
            const parsed = new URL(nextHref);
            const cursor = parsed.searchParams.get('cursor');
            if (!cursor || cursor === lastCursor) break;
            lastCursor = cursor;
            nextUrl = nextHref;
        }

        return holders;
    }

    function renderHolders(holders) {
        if (!holdersList) return;
        holdersList.innerHTML = '';

        if (!holders.length) {
            holdersList.textContent = t('holders-empty');
            return;
        }

        const table = document.createElement('table');
        table.className = 'table is-fullwidth is-striped is-hoverable is-size-7';

        const thead = document.createElement('thead');
        thead.innerHTML = `<tr><th>${t('holders-th-account')}</th><th class="has-text-right">${t('holders-th-balance')}</th></tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        holders.forEach(h => {
            const row = document.createElement('tr');

            const cellId = document.createElement('td');
            const idLink = document.createElement('a');
            idLink.href = `/account/${h.id}`;
            idLink.textContent = shorten(h.id);
            idLink.className = 'is-mono';
            cellId.appendChild(idLink);

            const cellBalance = document.createElement('td');
            cellBalance.className = 'has-text-right is-mono';
            cellBalance.textContent = h.balance.toFixed(7);

            row.appendChild(cellId);
            row.appendChild(cellBalance);
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        holdersList.appendChild(table);
    }

    async function loadHolders() {
        if (!poolId || !holdersBox) return;

        holdersBox.classList.remove('is-hidden');
        holdersVisible = true;

        if (holdersLoader) {
            holdersLoader.textContent = t('loader-text');
            holdersLoader.classList.remove('is-hidden');
        }

        try {
            const holders = (await fetchAllHolders())
                .sort((a, b) => b.balance - a.balance);

            holdersData = holders;
            renderHolders(holders);
        } catch (e) {
            console.error(e);
            showError('error-load-holders', { detail: e.message || t('error-unknown') });
        } finally {
            if (holdersLoader) holdersLoader.classList.add('is-hidden');
        }
    }

    const btnHolders = document.getElementById('btn-holders');
    if (btnHolders) {
        btnHolders.addEventListener('click', (e) => {
            e.preventDefault();
            loadHolders();
        });
    }

    loadPool();
}