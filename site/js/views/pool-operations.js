import { assetLabelFull, renderOperationComponent } from '../operation-view.js';
import { getHorizonURL } from '../common.js';

const horizonBase = getHorizonURL();

function parseAmountFilter(value, t) {
    if (!value.trim()) return null;
    const re = /^([<>])?\s*(\d+(?:\.\d+)?)$/;
    const m = value.trim().match(re);
    if (!m) return { error: t('filter-amount-error') };
    return { op: m[1] || '=', value: parseFloat(m[2]) };
}

function matchesAmount(op, filter) {
    if (!filter) return true;
    let matched = false;
    const visit = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        Object.entries(obj).forEach(([key, val]) => {
            if (typeof val === 'object') {
                visit(val);
                return;
            }
            if (typeof val !== 'string') return;
            if (!/(amount|balance|limit|price|reserve)/i.test(key)) return;
            if (!/^\d+(?:\.\d+)?$/.test(val)) return;
            const num = parseFloat(val);
            if (filter.op === '>' && num > filter.value) matched = true;
            else if (filter.op === '<' && num < filter.value) matched = true;
            else if (filter.op === '=' && num === filter.value) matched = true;
        });
    };
    visit(op);
    return matched;
}

function matchesAsset(op, assetCode) {
    if (!assetCode) return true;
    const needle = assetCode.trim().toUpperCase();
    let found = false;
    const visit = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        Object.entries(obj).forEach(([key, val]) => {
            if (typeof val === 'object') {
                visit(val);
                return;
            }
            if (typeof val !== 'string') return;
            if (!/(asset|selling|buying)/i.test(key)) return;
            const upper = val.toUpperCase();
            if (upper.includes(needle)) found = true;
        });
    };
    visit(op);
    return found;
}

function matchesType(op, typeTokens) {
    if (!typeTokens || !typeTokens.length) return true;
    const opType = (op.type || '').toLowerCase();
    const plus = typeTokens.filter(t => t.startsWith('+')).map(t => t.slice(1).toLowerCase()).filter(Boolean);
    const minus = typeTokens.filter(t => t.startsWith('-')).map(t => t.slice(1).toLowerCase()).filter(Boolean);

    if (plus.length && !plus.some(t => opType.includes(t))) return false;
    if (minus.length && minus.some(t => opType.includes(t))) return false;
    return true;
}

function applyFilters(list, filters) {
    return list.filter(op =>
        matchesAmount(op, filters.amount) &&
        matchesAsset(op, filters.asset) &&
        matchesType(op, filters.types)
    );
}

function parseTypeTokens(raw) {
    if (!raw.trim()) return [];
    return raw.trim().split(/\s+/).filter(Boolean);
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [poolId] = params;

    const poolEl = document.getElementById('pool-id');
    const filterErrorEl = document.getElementById('filter-error');
    const loadMoreBtn = document.getElementById('btn-load-more');
    const statusLabel = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const container = document.getElementById('operations-container');

    if (poolEl) poolEl.textContent = poolId;

    let operations = [];
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

    async function fetchOperations(pid, { cursor = null, limit = 50 } = {}) {
        const url = new URL(`${horizonBase}/liquidity_pools/${pid}/operations`);
        url.searchParams.set('order', 'desc');
        url.searchParams.set('limit', limit);
        url.searchParams.set('include_failed', 'true');
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`Horizon error ${res.status}`);
        }
        const data = await res.json();
        return data?._embedded?.records || [];
    }

    function renderOperations(list) {
        if (!container) return;
        container.innerHTML = '';

        if (!list.length) {
            container.innerHTML = `<p class="has-text-grey">${t('ops-empty')}</p>`;
            return;
        }

        list.forEach(op => {
            const box = renderOperationComponent(op, t, {
                showTransactionLink: true,
                showSource: true,
                allowLoadEffects: true
            });
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
            asset: document.getElementById('filter-asset').value.trim().toUpperCase() || null,
            types: parseTypeTokens(document.getElementById('filter-type').value)
        };
        const list = applyFilters(operations, filters);
        renderOperations(list);
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
            const batch = await fetchOperations(poolId, { limit: 200 });
            operations = batch;
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
            const batch = await fetchOperations(poolId, { limit: 50 });
            operations = batch;
            nextCursor = batch.length ? batch[batch.length - 1].paging_token : null;
            setStatus('ok');
            renderOperations(operations);
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
                const batch = await fetchOperations(poolId, { cursor: nextCursor, limit: 50 });
                if (!batch.length) {
                    nextCursor = null;
                    loadMoreBtn.disabled = true;
                } else {
                    operations = operations.concat(batch);
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
            document.getElementById('filter-type').value = '';
            applyAndRender();
        });
    }

    ['filter-amount', 'filter-asset', 'filter-type'].forEach(id => {
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

    if (!poolId) {
        showError('error-no-account');
    } else {
        await loadInitial();
    }
}
