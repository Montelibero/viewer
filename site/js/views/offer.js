import { shorten } from '/js/common.js?v=13';

const horizonBase = 'https://horizon.stellar.org';

function accountLink(acc, { short = true } = {}) {
    if (!acc) return '—';
    const label = short ? shorten(acc) : acc;
    return `<a class="is-mono" href="/account/${encodeURIComponent(acc)}" title="${acc}">${label}</a>`;
}

function assetLabel(asset) {
    if (!asset) return '—';
    if (asset.asset_type === 'native') return 'XLM';
    const code = asset.asset_code || '—';
    const issuer = asset.asset_issuer || '';
    const display = `${code} · ${issuer ? shorten(issuer) : '—'}`;
    const href = issuer ? `/asset/${encodeURIComponent(`${code}-${issuer}`)}` : null;
    return href ? `<a href="${href}">${display}</a>` : display;
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [offerId] = params;

    const statusEl = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const offerIdEl = document.getElementById('offer-id');
    
    if (offerIdEl) offerIdEl.textContent = offerId;

    function setStatus(state) {
        if (!statusEl) return;
        statusEl.classList.remove('is-danger', 'is-success', 'is-info');
        let key = 'status-loading';
        if (state === 'ok') {
            statusEl.classList.add('is-success');
            key = 'status-ok';
        } else if (state === 'error') {
            statusEl.classList.add('is-danger');
            key = 'status-error';
        } else {
            statusEl.classList.add('is-info');
        }
        statusEl.textContent = t(key);
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

    async function loadOffer(id) {
        clearError();
        showLoading(true);
        setStatus('loading');

        try {
            const res = await fetch(`${horizonBase}/offers/${encodeURIComponent(id)}`);
            if (!res.ok) {
                let detail = `Horizon error ${res.status}`;
                try {
                    const err = await res.json();
                    if (err?.detail) detail = err.detail;
                } catch (_) {}
                throw new Error(detail);
            }
            const data = await res.json();

            setStatus('ok');

            const sellerEl = document.getElementById('seller');
            const updatedAtEl = document.getElementById('updated-at');
            const ledgerEl = document.getElementById('ledger');
            const detailsEl = document.getElementById('details');
            const rawJsonEl = document.getElementById('raw-json');

            if (offerIdEl) offerIdEl.textContent = data.id || id;
            if (sellerEl) sellerEl.innerHTML = accountLink(data.seller, { short: false });
            if (updatedAtEl) updatedAtEl.textContent = data.last_modified_time || '—';
            if (ledgerEl) ledgerEl.textContent = data.last_modified_ledger || '—';

            const amount = data.amount || '—';
            const price = data.price || (data.price_r ? `${data.price_r.n}/${data.price_r.d}` : '—');
            
            if (detailsEl) {
                detailsEl.innerHTML = `
                    <div>${t('selling-label')}: ${assetLabel(data.selling)}</div>
                    <div>${t('buying-label')}: ${assetLabel(data.buying)}</div>
                    <div>${t('amount-label')}: <span class="has-text-weight-semibold">${amount}</span></div>
                    <div>${t('price-label')}: ${price}</div>
                `;
            }

            if (rawJsonEl) rawJsonEl.textContent = JSON.stringify(data, null, 2);

        } catch (e) {
            console.error(e);
            showError('error-load-offer', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    }

    if (!offerId) {
        showError('error-no-offer-id');
    } else {
        loadOffer(offerId);
    }
}
