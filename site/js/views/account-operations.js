import { assetLabelFull, createOperationCard } from '../operation-view.js';
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

function exportToCsv(list, accountId) {
    const header = 'Transaction hash,Date,Operation,From,Token,Amount,To,Token 2,Amount 2,Successful';
    const rows = list.map(op => {
        let from = op.source_account || '';
        let to = '',
            token1 = '', amount1 = '',
            token2 = '', amount2 = '';

        if (op.type === 'payment' || op.type === 'path_payment_strict_receive' || op.type === 'path_payment_strict_send') {
            from = op.from || from;
            to = op.to || '';
            token1 = assetLabelFull(op.asset_code || op.asset_type, op.asset_issuer);
            amount1 = op.amount || '';
        } else if (op.type === 'create_account') {
            to = op.account || '';
            token1 = 'XLM';
            amount1 = op.starting_balance || '';
        } else if (op.type === 'manage_sell_offer' || op.type === 'manage_buy_offer' || op.type === 'create_passive_sell_offer') {
            token1 = assetLabelFull(op.selling_asset_code || op.selling_asset_type, op.selling_asset_issuer);
            amount1 = op.amount || '';
            token2 = assetLabelFull(op.buying_asset_code || op.buying_asset_type, op.buying_asset_issuer);
            amount2 = op.price ? (parseFloat(op.amount) * parseFloat(op.price)).toFixed(7) : '';
        }

        const fields = [
            op.transaction_hash || '',
            op.created_at || '',
            op.type || '',
            from,
            token1,
            amount1,
            to,
            token2,
            amount2,
            op.transaction_successful,
        ];
        return fields.map(field => `"${String(field ?? '').replace(/"/g, '""')}"`).join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${accountId}_operations.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [accountId] = params;

    const accountEl = document.getElementById('account-id');
    const filterErrorEl = document.getElementById('filter-error');
    const loadMoreBtn = document.getElementById('btn-load-more');
    const statusLabel = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const container = document.getElementById('operations-container');

    if (accountEl) accountEl.textContent = accountId;

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

    async function fetchOperations(accId, { cursor = null, limit = 50 } = {}) {
        const url = new URL(`${horizonBase}/accounts/${accId}/operations`);
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
            const box = createOperationCard(op, t);
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
            const batch = await fetchOperations(accountId, { limit: 200 });
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
            const batch = await fetchOperations(accountId, { limit: 50 });
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
                const batch = await fetchOperations(accountId, { cursor: nextCursor, limit: 50 });
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

    const btnExport = document.getElementById('btn-export-csv');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            const amountVal = document.getElementById('filter-amount').value;
            const amountFilter = parseAmountFilter(amountVal, t);
            const filters = {
                amount: amountFilter?.error ? null : amountFilter,
                asset: document.getElementById('filter-asset').value.trim().toUpperCase() || null,
                types: parseTypeTokens(document.getElementById('filter-type').value)
            };
            const list = applyFilters(operations, filters);
            exportToCsv(list, accountId);
        });
    }

    if (!accountId) {
        showError('error-no-account');
    } else {
        await loadInitial();
    }
}
