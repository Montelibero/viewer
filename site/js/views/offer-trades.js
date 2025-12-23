import { shorten, getHorizonURL } from '../common.js';

const horizonBase = getHorizonURL();

function parseAmountFilter(value, t) {
    if (!value.trim()) return null;
    const re = /^([<>])?\s*(\d+(?:\.\d+)?)$/;
    const m = value.trim().match(re);
    if (!m) return { error: t('filter-amount-error') };
    return { op: m[1] || '=', value: parseFloat(m[2]) };
}

function matchesAmount(trade, filter) {
    if (!filter) return true;
    const amounts = [
        parseFloat(trade.base_amount),
        parseFloat(trade.counter_amount)
    ];
    let matched = false;
    amounts.forEach(num => {
        if (filter.op === '>' && num > filter.value) matched = true;
        else if (filter.op === '<' && num < filter.value) matched = true;
        else if (filter.op === '=' && num === filter.value) matched = true;
    });
    return matched;
}

function matchesAsset(trade, assetCode) {
    if (!assetCode) return true;
    const needle = assetCode.trim().toUpperCase();
    const assets = [
        trade.base_asset_code,
        trade.base_asset_issuer,
        trade.counter_asset_code,
        trade.counter_asset_issuer
    ].filter(Boolean).map(s => s.toUpperCase());

    // Also handle 'native' which might not be explicitly 'XLM' in some fields but 'native' type
    if (trade.base_asset_type === 'native') assets.push('XLM');
    if (trade.counter_asset_type === 'native') assets.push('XLM');

    return assets.some(val => val.includes(needle));
}

function applyFilters(list, filters) {
    return list.filter(trade =>
        matchesAmount(trade, filters.amount) &&
        matchesAsset(trade, filters.asset)
    );
}

function assetLabel(code, issuer) {
    if (!code && !issuer) return 'XLM'; // Native
    if (!issuer) return code || 'XLM';
    return `${code} <span class="is-size-7 has-text-grey is-mono">(${shorten(issuer)})</span>`;
}

function createTradeCard(trade, t) {
    const box = document.createElement('div');
    box.className = 'box mb-2 p-3';

    const dateStr = trade.ledger_close_time ? new Date(trade.ledger_close_time).toLocaleString() : '—';
    const baseAmount = trade.base_amount;
    const counterAmount = trade.counter_amount;
    const baseAsset = assetLabel(trade.base_asset_code, trade.base_asset_issuer);
    const counterAsset = assetLabel(trade.counter_asset_code, trade.counter_asset_issuer);

    const priceN = trade.price?.n || trade.price;
    const priceD = trade.price?.d || 1;
    const price = (typeof trade.price === 'object') ? (priceN / priceD).toFixed(7) : trade.price;

    const soldLabel = t('trade-sold') || 'Sold';
    const boughtLabel = t('trade-bought') || 'Bought';
    const priceLabel = t('trade-price') || 'Price';
    const counterpartyLabel = t('trade-counterparty') || 'Counterparty';

    // Determine direction if possible?
    // Horizon /offers/{id}/trades returns trades where the offer is involved.
    // If base_is_seller is true, the base asset was sold.
    // However, the context is "Trades for Offer X".
    // We can just list "Sold X for Y" or "Bought X with Y".
    // Or just "Base: ... Counter: ..."

    // Let's stick to a simple visual:
    // Left: Base Amount Asset
    // Right: Counter Amount Asset
    // And indication of "Sold" or "Bought" ?

    // Actually, `base_is_seller` tells us if the base asset seller is the maker or something.
    // But simply showing both sides is safest.

    box.innerHTML = `
        <div class="level is-mobile mb-1">
             <div class="level-left">
                <span class="tag is-light is-info is-family-monospace mr-2">${shorten(trade.id)}</span>
                <span class="is-size-7 has-text-grey">${dateStr}</span>
             </div>
             <div class="level-right">
                <span class="is-size-7">${priceLabel}: <span class="has-text-weight-semibold">${price}</span></span>
             </div>
        </div>
        <div class="columns is-mobile is-vcentered">
            <div class="column is-5 has-text-right">
                <div class="has-text-weight-bold">${baseAmount}</div>
                <div class="is-size-7">${baseAsset}</div>
            </div>
            <div class="column is-2 has-text-centered">
                <span class="icon has-text-grey-light">
                    <i class="fas fa-exchange-alt"></i> <!-- You might need fontawesome or just text -->
                    ↔
                </span>
            </div>
            <div class="column is-5">
                <div class="has-text-weight-bold">${counterAmount}</div>
                <div class="is-size-7">${counterAsset}</div>
            </div>
        </div>
        <div class="is-size-7 mt-1">
             <span class="has-text-grey">${counterpartyLabel}:</span>
             <a href="/account/${trade.counter_account}" class="is-mono">${shorten(trade.counter_account)}</a>
             <span class="has-text-grey mx-1">/</span>
             <a href="/account/${trade.base_account}" class="is-mono">${shorten(trade.base_account)}</a>
        </div>
    `;

    return box;
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [offerId] = params;

    const offerEl = document.getElementById('offer-id');
    const filterErrorEl = document.getElementById('filter-error');
    const loadMoreBtn = document.getElementById('btn-load-more');
    const statusLabel = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const container = document.getElementById('trades-container');

    if (offerEl) offerEl.textContent = offerId;

    let trades = [];
    let nextCursor = null;

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

    async function fetchTrades(oid, { cursor = null, limit = 50 } = {}) {
        const url = new URL(`${horizonBase}/offers/${oid}/trades`);
        url.searchParams.set('order', 'desc');
        url.searchParams.set('limit', limit);
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`Horizon error ${res.status}`);
        }
        const data = await res.json();
        return data?._embedded?.records || [];
    }

    function renderTrades(list) {
        if (!container) return;
        container.innerHTML = '';

        if (!list.length) {
            container.innerHTML = `<p class="has-text-grey">${t('trades-empty') || 'No trades found'}</p>`;
            return;
        }

        list.forEach(trade => {
            const box = createTradeCard(trade, t);
            container.appendChild(box);
        });
    }

    const applyAndRender = (opts = {}) => {
        const amountVal = document.getElementById('filter-amount').value;
        const amountFilter = parseAmountFilter(amountVal, t);

        if (amountFilter?.error) {
            if (filterErrorEl) {
                filterErrorEl.textContent = amountFilter.error;
                filterErrorEl.classList.remove('is-hidden');
            }
            return;
        }
        if (filterErrorEl) filterErrorEl.classList.add('is-hidden');

        const filters = {
            amount: amountFilter,
            asset: document.getElementById('filter-asset').value.trim().toUpperCase() || null
        };
        const list = applyFilters(trades, filters);
        renderTrades(list);
        if (opts.resetCursor !== undefined && loadMoreBtn) {
            loadMoreBtn.disabled = !nextCursor;
        }
    };

    const applyFilterAndReload = async () => {
        const amountVal = document.getElementById('filter-amount').value;
        const amountFilter = parseAmountFilter(amountVal, t);

        if (amountFilter?.error) {
            if (filterErrorEl) {
                filterErrorEl.textContent = amountFilter.error;
                filterErrorEl.classList.remove('is-hidden');
            }
            return;
        }
        if (filterErrorEl) filterErrorEl.classList.add('is-hidden');

        showLoading(true);
        try {
            const batch = await fetchTrades(offerId, { limit: 200 });
            trades = batch;
            nextCursor = batch.length ? batch[batch.length - 1].paging_token : null;
            applyAndRender();
            if (loadMoreBtn) loadMoreBtn.disabled = !nextCursor;
        } catch (e) {
            console.error(e);
            showError('error-apply-filter', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    };

    const loadInitial = async () => {
        clearError();
        showLoading(true);
        try {
            const batch = await fetchTrades(offerId, { limit: 50 });
            trades = batch;
            nextCursor = batch.length ? batch[batch.length - 1].paging_token : null;
            setStatus('ok');
            renderTrades(trades);
            if (loadMoreBtn) loadMoreBtn.disabled = !nextCursor;
        } catch (e) {
            console.error(e);
            showError('error-load-ops', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    };

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', async () => {
            if (!nextCursor) {
                loadMoreBtn.disabled = true;
                return;
            }
            showLoading(true);
            try {
                const batch = await fetchTrades(offerId, { cursor: nextCursor, limit: 50 });
                if (!batch.length) {
                    nextCursor = null;
                    loadMoreBtn.disabled = true;
                } else {
                    trades = trades.concat(batch);
                    nextCursor = batch[batch.length - 1].paging_token;
                    applyAndRender();
                }
            } catch (e) {
                console.error(e);
                showError('error-load-more', { detail: e.message || t('error-unknown') });
            } finally {
                showLoading(false);
            }
        });
    }

    const btnApply = document.getElementById('btn-apply-filter');
    if (btnApply) btnApply.addEventListener('click', applyFilterAndReload);

    const btnClear = document.getElementById('btn-clear-filter');
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            document.getElementById('filter-amount').value = '';
            document.getElementById('filter-asset').value = '';
            applyAndRender();
        });
    }

    ['filter-amount', 'filter-asset'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyFilterAndReload();
                }
            });
        }
    });

    if (!offerId) {
        showError('error-no-offer-id'); // Reusing or need new key
    } else {
        await loadInitial();
    }
}
