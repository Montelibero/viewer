import { shorten } from '../common.js';

const horizonBase = 'https://horizon.stellar.org';

function buildAssetId(asset) {
    return `${asset.code}:${asset.issuer}`;
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [assetParam] = params;

    // UI elements
    const statusLabel = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');

    let holdersData = null;
    let poolsData = null;
    let holdersVisible = false;
    let poolsVisible = false;

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
        if (loader) loader.classList.toggle('is-hidden', !on);
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

    function renderFlags(flags = {}) {
        const flagsEl = document.getElementById('asset-flags');
        if (!flagsEl) return;
        flagsEl.innerHTML = '';
        const entries = Object.entries(flags);
        if (!entries.length) {
            flagsEl.textContent = t('flags-empty');
            return;
        }
        entries.forEach(([key, val]) => {
            const li = document.createElement('li');
            li.textContent = `${key}: ${val}`;
            flagsEl.appendChild(li);
        });
    }

    function renderAsset(record) {
        const codeEl = document.getElementById('asset-code');
        const issuerEl = document.getElementById('asset-issuer');
        const typeEl = document.getElementById('asset-type');

        if(codeEl) codeEl.textContent = record.asset_code;
        if(issuerEl) {
            issuerEl.textContent = record.asset_issuer;
            issuerEl.href = `/account/${encodeURIComponent(record.asset_issuer)}`;
        }
        if(typeEl) typeEl.textContent = record.asset_type || '—';

        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.textContent = val ?? '—';
        };

        setTxt('asset-circulating', record.balances?.authorized);
        
        let supply = record.amount;
        if (!supply) {
             const auth = parseFloat(record.balances?.authorized || 0);
             const authM = parseFloat(record.balances?.authorized_to_maintain_liabilities || 0);
             const claim = parseFloat(record.claimable_balances_amount || 0);
             const pool = parseFloat(record.liquidity_pools_amount || 0);
             const contracts = parseFloat(record.contracts_amount || 0);
             supply = (auth + authM + claim + pool + contracts).toString();
        }
        setTxt('asset-supply', supply);
        setTxt('asset-pools', record.liquidity_pools_amount);
        setTxt('asset-claims', record.claimable_balances_amount);
        setTxt('asset-contracts', record.contracts_amount ?? record.num_contracts);
        setTxt('asset-num-pools', record.num_liquidity_pools);
        setTxt('asset-num-claims', record.num_claimable_balances);

        const accounts = record.accounts || {};
        setTxt('asset-auth', accounts.authorized);
        setTxt('asset-auth-ml', accounts.authorized_to_maintain_liabilities);
        setTxt('asset-unauth', accounts.unauthorized);

        renderFlags(record.flags);

        const btnIssuer = document.getElementById('btn-issuer');
        if(btnIssuer) btnIssuer.href = `/account/${encodeURIComponent(record.asset_issuer)}`;

        if (record.contract_id) {
            const contractEl = document.getElementById('asset-contract');
            if (contractEl) {
                contractEl.innerHTML = `<span class="has-text-grey">Contract:</span> <a href="/contract/${record.contract_id}">${shorten(record.contract_id)}</a>`;
            }
        }

        const tomlHref = record._links?.toml?.href;
        const tomlBtn = document.getElementById('btn-toml');
        if (tomlBtn) {
            if (tomlHref) {
                tomlBtn.href = tomlHref;
                tomlBtn.classList.remove('is-static');
            } else {
                tomlBtn.href = '#';
                tomlBtn.classList.add('is-static');
            }
        }

        setStatus('ok');
    }

    async function loadAsset(code, issuer) {
        clearError();
        setStatus('loading');
        showLoading(true);

        try {
            const url = `${horizonBase}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}&limit=1`;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`Horizon error ${res.status}`);
            }
            const data = await res.json();
            const record = data?._embedded?.records?.[0];
            if (!record) {
                showError('error-asset-not-found');
                return;
            }
            renderAsset(record);
        } catch (e) {
            console.error(e);
            showError('error-load-asset', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    }

    async function fetchAllHolders(code, issuer) {
        const holders = [];
        const assetId = `${code}:${issuer}`;
        let nextUrl = `${horizonBase}/accounts?asset=${assetId}&limit=200&order=asc`;
        let lastCursor = null;

        while (nextUrl) {
            const res = await fetch(nextUrl);
            if (!res.ok) throw new Error(`Horizon error ${res.status}`);

            const data = await res.json();
            const records = data?._embedded?.records || [];

            records.forEach(r => {
                const assetBalance = r.balances.find(b => b.asset_code === code && b.asset_issuer === issuer);
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
            nextUrl = `${horizonBase}/accounts?asset=${assetId}&limit=200&order=asc&cursor=${encodeURIComponent(cursor)}`;
        }

        return holders;
    }

    function renderHolders(holders) {
        const listEl = document.getElementById('holders-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (!holders.length) {
            listEl.textContent = t('holders-empty');
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
        listEl.appendChild(table);
    }

    async function loadHolders(code, issuer) {
        const holdersBox = document.getElementById('holders-box');
        if (holdersBox) holdersBox.classList.remove('is-hidden');
        holdersVisible = true;

        const loader = document.getElementById('holders-loader');
        if (loader) {
            loader.textContent = t('loader-text');
            loader.classList.remove('is-hidden');
        }

        try {
            const holders = (await fetchAllHolders(code, issuer))
                .sort((a, b) => b.balance - a.balance);

            holdersData = holders;
            renderHolders(holders);
        } catch (e) {
            console.error(e);
            showError('error-load-holders', { detail: e.message || t('error-unknown') });
        } finally {
            if (loader) loader.classList.add('is-hidden');
        }
    }

    async function fetchAllPools(code, issuer) {
        const assetId = `${code}:${issuer}`;
        let nextUrl = `${horizonBase}/liquidity_pools?reserves=${assetId}&limit=200&order=asc`;
        let lastCursor = null;
        const pools = [];

        while (nextUrl) {
            const res = await fetch(nextUrl);
            if (!res.ok) throw new Error(`Horizon error ${res.status}`);

            const data = await res.json();
            const records = data?._embedded?.records || [];
            pools.push(...records);

            if (!records.length) break;

            const nextHref = data?._links?.next?.href;
            if (!nextHref) break;
            const parsed = new URL(nextHref);
            const cursor = parsed.searchParams.get('cursor');
            if (!cursor || cursor === lastCursor) break;
            lastCursor = cursor;
            nextUrl = `${horizonBase}/liquidity_pools?reserves=${assetId}&limit=200&order=asc&cursor=${encodeURIComponent(cursor)}`;
        }

        return pools;
    }

    function renderPools(pools) {
        const listEl = document.getElementById('pools-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (!pools.length) {
            listEl.textContent = t('pools-empty');
            return;
        }

        const table = document.createElement('table');
        table.className = 'table is-fullwidth is-striped is-hoverable is-size-7';

        const thead = document.createElement('thead');
        thead.innerHTML = `<tr><th>${t('pools-th-id')}</th><th>${t('pools-th-reserves')}</th><th class="has-text-right">${t('pools-th-shares')}</th></tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        pools.forEach(p => {
            const row = document.createElement('tr');

            const cellId = document.createElement('td');
            const idLink = document.createElement('a');
            idLink.href = `/pool/${p.id}`;
            idLink.textContent = shorten(p.id);
            idLink.className = 'is-mono';
            cellId.appendChild(idLink);

            const cellReserves = document.createElement('td');
            cellReserves.className = 'is-mono';
            cellReserves.innerHTML = p.reserves.map(r => {
                const assetName = r.asset === 'native' ? 'XLM' : r.asset.split(':')[0];
                return `${r.amount} ${assetName}`;
            }).join('<br>');

            const cellShares = document.createElement('td');
            cellShares.className = 'has-text-right is-mono';
            cellShares.textContent = p.total_shares;

            row.appendChild(cellId);
            row.appendChild(cellReserves);
            row.appendChild(cellShares);
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        listEl.appendChild(table);
    }

    async function loadPools(code, issuer) {
        const poolsBox = document.getElementById('pools-box');
        if (poolsBox) poolsBox.classList.remove('is-hidden');
        poolsVisible = true;

        const loader = document.getElementById('pools-loader');
        if (loader) {
            loader.textContent = t('loader-text');
            loader.classList.remove('is-hidden');
        }

        try {
            const pools = await fetchAllPools(code, issuer);
            poolsData = pools;
            renderPools(pools);
        } catch (e) {
            console.error(e);
            showError('error-load-pools', { detail: e.message || t('error-unknown') });
        } finally {
            if (loader) loader.classList.add('is-hidden');
        }
    }

    // Parsing
    let code = '', issuer = '';
    // Expected params: assetParam = "CODE-ISSUER"
    // Handle the case if the code contains hyphen? Usually Stellar codes are alphanumeric.
    // However, split by first hyphen is safer if issuer is always G...
    // But issuer is 56 chars.
    // Let's stick to simple split for now or lastIndexOf if we want to be safe against code having hyphen (which it shouldn't).
    // Actually, "CODE-ISSUER". 
    // If the router matched /asset/(.+), then params[0] is that string.
    
    // Simple parsing logic matching previous
    const idx = assetParam.lastIndexOf('-');
    if (idx > 0) {
        code = assetParam.slice(0, idx);
        issuer = assetParam.slice(idx + 1);
    }

    if (!code || !issuer) {
        showError('error-invalid-asset');
        return;
    }

    // Listeners
    const btnHolders = document.getElementById('btn-holders');
    if (btnHolders) {
        btnHolders.addEventListener('click', (e) => {
            e.preventDefault();
            loadHolders(code, issuer);
        });
    }

    const btnPools = document.getElementById('btn-pools');
    if (btnPools) {
        btnPools.addEventListener('click', (e) => {
            e.preventDefault();
            loadPools(code, issuer);
        });
    }

    // Init
    loadAsset(code, issuer);
}