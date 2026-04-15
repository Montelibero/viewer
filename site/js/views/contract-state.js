import { shorten, encodeAddress } from '../common.js';

const expertBase = '/api/expert';

function formatSCVal(val) {
    if (val === null || val === undefined) return 'null';
    if (val.string !== undefined) {
        const s = String(val.string);
        const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `"${escaped}"`;
    }
    if (val.symbol !== undefined) return val.symbol;
    if (val.u32 !== undefined) return val.u32;
    if (val.i32 !== undefined) return val.i32;
    if (val.u64 !== undefined) return val.u64;
    if (val.i64 !== undefined) return val.i64;
    if (val.u128 !== undefined) return JSON.stringify(val.u128);
    if (val.i128 !== undefined) return JSON.stringify(val.i128);
    if (val.bool !== undefined) return val.bool.toString();
    if (val.void !== undefined) return 'void';
    if (val.bytes !== undefined) {
        if (val.bytes.length === 64 && /^[0-9a-fA-F]+$/.test(val.bytes)) {
            const addr = encodeAddress(val.bytes);
            if (addr) return `<a href="/account/${addr}">${shorten(addr)}</a>`;
        }
        return `bytes[${val.bytes.length / 2}]`;
    }
    if (val.address !== undefined) {
        const a = val.address;
        if (typeof a === 'string') {
            return `<a href="/account/${a}">${shorten(a)}</a>`;
        }
        if (a.account_id) {
            return `<a href="/account/${a.account_id}">${shorten(a.account_id)}</a>`;
        }
        if (a.contract) {
            return `<a href="/contract/${a.contract}" class="is-mono">${shorten(a.contract)}</a>`;
        }
        return JSON.stringify(a);
    }
    if (val.vec !== undefined) {
        if (val.vec === null) return '[]';
        return '[' + val.vec.map(formatSCVal).join(', ') + ']';
    }
    if (val.map !== undefined) {
        if (val.map === null) return '{}';
        return '{ ' + val.map.map(e => `${formatSCVal(e.key)}: ${formatSCVal(e.val)}`).join(', ') + ' }';
    }
    if (val.ledger_key_contract_instance !== undefined) return '[LedgerKeyContractInstance]';
    if (val.contract_instance !== undefined) return '[ContractInstance]';
    return JSON.stringify(val);
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

    // Load XDR decoder once.
    let decodeFn = null;
    async function getDecoder() {
        if (decodeFn) return decodeFn;
        const mod = await import('https://esm.sh/@stellar/stellar-xdr-json');
        const initFn = mod.default || mod.init;
        if (typeof initFn === 'function') await initFn();
        decodeFn = mod.decode;
        return decodeFn;
    }

    function decodeScVal(base64) {
        try {
            const raw = decodeFn('ScVal', base64);
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            return { _decodeError: e.message, _raw: base64 };
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
            const keyObj = decodeScVal(rec.key);
            const valObj = decodeScVal(rec.value);

            const tr = document.createElement('tr');

            const tdKey = document.createElement('td');
            tdKey.innerHTML = formatSCVal(keyObj);
            tr.appendChild(tdKey);

            const tdVal = document.createElement('td');
            tdVal.style.wordBreak = 'break-all';
            tdVal.innerHTML = formatSCVal(valObj);
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
            await getDecoder();
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
