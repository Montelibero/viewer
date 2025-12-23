import { shorten, getHorizonURL } from '../common.js';

const horizonBase = getHorizonURL();

function accountLink(acc) {
    return acc ? `/account/${encodeURIComponent(acc)}` : null;
}

function assetLabel(asset) {
    if (!asset) return '—';
    if (asset.asset_type === 'native') return 'XLM';
    const code = asset.asset_code || '—';
    const issuer = asset.asset_issuer || '';
    const text = `${code}`;
    const href = issuer ? `/asset/${encodeURIComponent(`${code}-${issuer}`)}` : null;
    return href ? `<a href="${href}">${text}</a>` : text;
}

function getAssetCode(asset) {
    if (!asset) return '—';
    if (asset.asset_type === 'native') return 'XLM';
    return asset.asset_code || '—';
}

function formatDate(isoStr) {
    if (!isoStr) return '—';
    try {
        const d = new Date(isoStr);
        return d.toLocaleString();
    } catch (e) {
        return isoStr;
    }
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [accountId] = params;
    
    // UI References
    const accountIdEl = document.getElementById('account-id');
    const statusLabel = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const tbody = document.getElementById('offers-tbody');
    const emptyMsg = document.getElementById('offers-empty-msg');
    const loadMoreBtn = document.getElementById('btn-load-more');
    const table = document.getElementById('offers-table');

    if (accountIdEl) accountIdEl.textContent = accountId;

    let offers = [];
    let nextCursor = null;
    let currentSort = { column: null, direction: 'asc' }; // 'asc' or 'desc'

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

    async function fetchOffers(accId, { cursor = null, limit = 50 } = {}) {
        const url = new URL(`${horizonBase}/accounts/${accId}/offers`);
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

    // Sorting Logic
    function handleSort(column) {
        if (currentSort.column === column) {
            // Toggle direction
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.column = column;
            currentSort.direction = 'asc'; // Default new sort to asc
        }
        updateSortIcons();
        renderOffers();
    }

    function updateSortIcons() {
        const headers = table.querySelectorAll('th[data-sort]');
        headers.forEach(th => {
            const iconSpan = th.querySelector('.icon');
            const icon = th.querySelector('i');
            if (th.dataset.sort === currentSort.column) {
                iconSpan.classList.remove('is-hidden');
                icon.className = currentSort.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
            } else {
                iconSpan.classList.add('is-hidden');
                icon.className = 'fas fa-sort';
            }
        });
    }

    function getSortValue(offer, column) {
        switch (column) {
            case 'id':
                return parseInt(offer.id, 10);
            case 'sell_amount':
                // Sort by amount
                return parseFloat(offer.amount);
            case 'sell_asset':
                return getAssetCode(offer.selling).toUpperCase();
            case 'buy_amount':
                // Sort by buying amount
                const p = parseFloat(offer.price);
                const amt = parseFloat(offer.amount);
                return p * amt;
            case 'buy_asset':
                 return getAssetCode(offer.buying).toUpperCase();
            case 'price':
                return parseFloat(offer.price);
            case 'price_inv':
                return 1.0 / parseFloat(offer.price);
            case 'date':
                return new Date(offer.last_modified_time || 0).getTime();
            default:
                return 0;
        }
    }

    function renderOffers() {
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!offers.length) {
            table.classList.add('is-hidden');
            if (emptyMsg) emptyMsg.classList.remove('is-hidden');
            return;
        }

        table.classList.remove('is-hidden');
        if (emptyMsg) emptyMsg.classList.add('is-hidden');

        // Apply Sort
        let displayList = [...offers];
        if (currentSort.column) {
            displayList.sort((a, b) => {
                const valA = getSortValue(a, currentSort.column);
                const valB = getSortValue(b, currentSort.column);
                if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        displayList.forEach(offer => {
            const tr = document.createElement('tr');

            // Calculations
            const amountSelling = parseFloat(offer.amount);
            const price = parseFloat(offer.price);
            const amountBuying = amountSelling * price;
            const invPrice = 1 / price;

            const buyingAssetLabel = assetLabel(offer.buying);
            const sellingAssetLabel = assetLabel(offer.selling);

            tr.innerHTML = `
                <td><a href="/offer/${offer.id}">${offer.id}</a></td>

                <td><span class="has-text-weight-medium">${offer.amount}</span></td>
                <td><small>${sellingAssetLabel}</small></td>

                <td><span class="has-text-weight-medium">${amountBuying.toFixed(7).replace(/\.?0+$/, '')}</span></td>
                <td><small>${buyingAssetLabel}</small></td>

                <td>${price}</td>
                <td>${invPrice.toFixed(7).replace(/\.?0+$/, '')}</td>
                <td class="is-size-7">${formatDate(offer.last_modified_time)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const loadBatch = async (opts = {}) => {
        clearError();
        showLoading(true);
        try {
            const batch = await fetchOffers(accountId, opts);
            if (opts.cursor) {
                offers = offers.concat(batch);
            } else {
                offers = batch;
            }
            nextCursor = batch.length ? batch[batch.length - 1].paging_token : null;
            
            renderOffers();
            
            if (loadMoreBtn) {
                loadMoreBtn.disabled = !nextCursor;
            }
            setStatus('ok');
        } catch (e) {
            console.error(e);
            showError('error-load-offers', { detail: e.message || t('error-unknown') });
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
            await loadBatch({ cursor: nextCursor, limit: 50 });
        });
    }

    // Init Sort Listeners
    if (table) {
        const headers = table.querySelectorAll('th[data-sort]');
        headers.forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                handleSort(col);
            });
        });
    }

    if (!accountId) {
        showError('error-no-account-id');
    } else {
        // Initial load
        await loadBatch({ limit: 50 });
    }
}
