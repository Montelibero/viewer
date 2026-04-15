import { shorten } from '../common.js';

const expertBase = '/api/expert';

let sbPromise = null;
function loadStellarBase() {
    if (!sbPromise) {
        sbPromise = import('https://esm.sh/@stellar/stellar-base?bundle')
            .then(mod => mod.default || mod);
    }
    return sbPromise;
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isContractAddress(s) {
    return typeof s === 'string' && s.length === 56 && s[0] === 'C';
}

function isAccountAddress(s) {
    return typeof s === 'string' && s.length === 56 && s[0] === 'G';
}

function formatNative(v) {
    if (v === null || v === undefined) return '<span class="has-text-grey">null</span>';
    if (typeof v === 'string') {
        if (isAccountAddress(v)) return `<a href="/account/${v}">${shorten(v)}</a>`;
        if (isContractAddress(v)) return `<a href="/contract/${v}" class="is-mono">${shorten(v)}</a>`;
        return `"${escapeHtml(v)}"`;
    }
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v.toString();
    if (typeof v === 'symbol') return v.description || v.toString();
    if (v instanceof Uint8Array) {
        return `bytes[${v.length}]`;
    }
    if (Array.isArray(v)) {
        return '[' + v.map(formatNative).join(', ') + ']';
    }
    if (typeof v === 'object') {
        // scValToNative returns plain objects for maps, keyed by symbol/string
        const entries = Object.entries(v);
        if (!entries.length) return '{}';
        return '{ ' + entries.map(([k, val]) => `${escapeHtml(k)}: ${formatNative(val)}`).join(', ') + ' }';
    }
    return escapeHtml(String(v));
}

function formatScVal(sb, scval) {
    if (!scval) return 'null';
    const t = scval.switch().name;
    // Short labels for types that scValToNative can't handle or that are noisy.
    if (t === 'scvLedgerKeyContractInstance') return '[LedgerKeyContractInstance]';
    if (t === 'scvLedgerKeyNonce') return '[LedgerKeyNonce]';
    if (t === 'scvContractInstance') {
        try {
            const ci = scval.instance();
            const exec = ci.executable();
            const execName = exec.switch().name;
            return `[ContractInstance: ${execName}]`;
        } catch (_) {
            return '[ContractInstance]';
        }
    }
    try {
        const native = sb.scValToNative(scval);
        return formatNative(native);
    } catch (e) {
        return `<span class="has-text-danger">${escapeHtml(t)}: ${escapeHtml(e.message)}</span>`;
    }
}

function formatTs(unixSeconds) {
    if (!unixSeconds) return '—';
    const d = new Date(unixSeconds * 1000);
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [contractId] = params;

    const idEl = document.getElementById('contract-id');
    if (idEl) idEl.textContent = contractId;

    const backBtn = document.getElementById('btn-back-contract');
    if (backBtn) backBtn.href = `/contract/${contractId}`;

    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const listEl = document.getElementById('state-list');
    const moreBox = document.getElementById('more-box');
    const moreBtn = document.getElementById('btn-load-more');

    function showError(msg) {
        if (errorBox && errorText) {
            errorText.textContent = msg;
            errorBox.classList.remove('is-hidden');
        }
    }

    function toggleLoader(show) {
        const el = document.getElementById('state-loader');
        if (el) el.classList.toggle('is-hidden', !show);
    }

    let sb = null;
    function decodeScVal(base64) {
        try {
            return sb.xdr.ScVal.fromXDR(base64, 'base64');
        } catch (e) {
            return null;
        }
    }

    let table = null;
    let tbody = null;

    function ensureTable() {
        if (table) return;
        const wrap = document.createElement('div');
        wrap.className = 'table-container';
        table = document.createElement('table');
        table.className = 'table is-fullwidth is-striped is-hoverable is-size-7';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th>${t('th-key')}</th>
            <th>${t('th-value')}</th>
            <th>${t('th-durability')}</th>
            <th>${t('th-updated')}</th>
        </tr>`;
        table.appendChild(thead);
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
        wrap.appendChild(table);
        listEl.appendChild(wrap);
    }

    function appendRows(records) {
        ensureTable();
        records.forEach(rec => {
            const keyScVal = decodeScVal(rec.key);
            const valScVal = decodeScVal(rec.value);

            const tr = document.createElement('tr');

            const tdKey = document.createElement('td');
            tdKey.innerHTML = keyScVal ? formatScVal(sb, keyScVal)
                : `<span class="has-text-danger">decode error</span>`;
            tr.appendChild(tdKey);

            const tdVal = document.createElement('td');
            tdVal.style.wordBreak = 'break-all';
            tdVal.innerHTML = valScVal ? formatScVal(sb, valScVal)
                : `<span class="has-text-danger">decode error</span>`;
            tr.appendChild(tdVal);

            const tdDur = document.createElement('td');
            tdDur.textContent = rec.durability || '—';
            tr.appendChild(tdDur);

            const tdUpd = document.createElement('td');
            tdUpd.textContent = formatTs(rec.updated);
            tr.appendChild(tdUpd);

            tbody.appendChild(tr);
        });
    }

    let nextUrl = `${expertBase}/contract-state/${contractId}?limit=30&order=asc`;
    let total = 0;

    async function loadPage() {
        if (!nextUrl) return;
        toggleLoader(true);
        if (moreBtn) moreBtn.disabled = true;

        try {
            sb = await loadStellarBase();
            const res = await fetch(nextUrl);
            if (!res.ok) throw new Error(`Expert ${res.status}`);
            const data = await res.json();
            const records = data?._embedded?.records || [];

            if (!records.length && total === 0) {
                const p = document.createElement('p');
                p.className = 'has-text-grey';
                p.textContent = t('empty');
                listEl.appendChild(p);
                nextUrl = null;
                return;
            }

            appendRows(records);
            total += records.length;

            const nextHref = data?._links?.next?.href;
            if (nextHref && records.length >= 30) {
                nextUrl = nextHref.startsWith('/explorer/public/')
                    ? nextHref.replace('/explorer/public/', `${expertBase}/`)
                    : nextHref;
                if (moreBox) moreBox.classList.remove('is-hidden');
            } else {
                nextUrl = null;
                if (moreBox) moreBox.classList.add('is-hidden');
            }
        } catch (e) {
            console.error(e);
            showError(`${t('error-load')}: ${e.message}`);
            nextUrl = null;
            if (moreBox) moreBox.classList.add('is-hidden');
        } finally {
            toggleLoader(false);
            if (moreBtn) moreBtn.disabled = false;
        }
    }

    if (moreBtn) {
        moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadPage();
        });
    }

    loadPage();
}
