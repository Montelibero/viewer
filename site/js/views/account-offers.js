import { shorten } from '/js/common.js?v=7';

const horizonBase = 'https://horizon.stellar.org';

function accountLink(acc) {
    return acc ? `/account/${encodeURIComponent(acc)}` : null;
}

function assetLabel(asset) {
    if (!asset) return '—';
    if (asset.asset_type === 'native') return 'XLM';
    const code = asset.asset_code || '—';
    const issuer = asset.asset_issuer || '';
    const text = `${code} · ${issuer ? shorten(issuer) : '—'}`;
    const href = issuer ? `/asset/${encodeURIComponent(`${code}-${issuer}`)}` : null;
    return href ? `<a href="${href}">${text}</a>` : text;
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
    const container = document.getElementById('offers-container');
    const loadMoreBtn = document.getElementById('btn-load-more');

    if (accountIdEl) accountIdEl.textContent = accountId;

    let offers = [];
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

    function renderOffers(list) {
        if (!container) return;
        
        // Append to existing if cursor was used (handled by logic below), 
        // but here we might just re-render everything or append. 
        // The original logic was: offers = offers.concat(batch); renderOffers(offers);
        // So we clear and re-render all.
        container.innerHTML = '';

        if (!list.length) {
            container.innerHTML = `<p class="has-text-grey">${t('offers-empty')}</p>`;
            return;
        }

        list.forEach(offer => {
            const box = document.createElement('div');
            box.className = 'box is-size-7 offer-card';

            const price = offer.price || (offer.price_r ? `${offer.price_r.n}/${offer.price_r.d}` : '—');

            box.innerHTML = `
                <p class="mb-1">
                  <strong><a href="/offer/${offer.id}">${t('offer-label')}${offer.id}</a></strong>
                  · ${offer.last_modified_time || ''}
                </p>
                <p class="is-size-7">
                  ${t('seller-label')}: ${accountLink(offer.seller) ? `<a class="is-mono" href="${accountLink(offer.seller)}">${shorten(offer.seller)}</a>` : '—'}
                </p>
                <p class="mt-2">${t('selling-label')}: ${assetLabel(offer.selling)}</p>
                <p>${t('buying-label')}: ${assetLabel(offer.buying)}</p>
                <p>${t('amount-label')}: <span class="has-text-weight-semibold">${offer.amount || '—'}</span></p>
                <p>${t('price-label')}: ${price}</p>
                <p class="is-size-7 has-text-grey">${t('ledger-label')}: ${offer.last_modified_ledger || '—'}</p>
            `;

            container.appendChild(box);
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
            
            renderOffers(offers);
            
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

    if (!accountId) {
        showError('error-no-account-id');
    } else {
        // Initial load
        await loadBatch({ limit: 50 });
    }
}
