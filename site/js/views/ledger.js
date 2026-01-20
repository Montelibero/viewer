import { shorten, getHorizonURL, setPageTitle } from '../common.js';

export async function init(params, i18n) {
    const { t } = i18n;
    const [ledgerSeq] = params;
    const horizonBase = getHorizonURL();

    setPageTitle('Ledger ' + ledgerSeq);

    // DOM Elements
    const seqEl = document.getElementById('ledger-seq');
    const timeEl = document.getElementById('ledger-time');
    const protocolEl = document.getElementById('ledger-protocol');
    const opsEl = document.getElementById('ledger-ops');
    const feeEl = document.getElementById('ledger-fee');
    const hashEl = document.getElementById('ledger-hash');
    const prevEl = document.getElementById('ledger-prev');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const txListEl = document.getElementById('tx-list');
    const noTxMsg = document.getElementById('no-tx-msg');

    if (seqEl) seqEl.textContent = ledgerSeq;

    function showError(msg) {
        if (errorBox) {
            errorBox.classList.remove('is-hidden');
            errorText.textContent = msg;
        }
    }

    async function loadLedger() {
        try {
            const url = `${horizonBase}/ledgers/${ledgerSeq}`;
            const res = await fetch(url);
            if (!res.ok) {
                if (res.status === 404) throw new Error(t('not_found'));
                throw new Error(`Horizon error: ${res.status}`);
            }
            const data = await res.json();
            renderLedger(data);

            // Load transactions
            loadTransactions(data);
        } catch (e) {
            console.error(e);
            showError(e.message);
        }
    }

    function renderLedger(data) {
        if (timeEl) timeEl.textContent = new Date(data.closed_at).toLocaleString();
        if (protocolEl) protocolEl.textContent = data.protocol_version;
        if (opsEl) opsEl.textContent = data.operation_count;
        if (feeEl) feeEl.textContent = data.base_fee_in_stroops;
        if (hashEl) hashEl.textContent = data.hash;

        if (prevEl) {
            const prevSeq = parseInt(ledgerSeq) - 1;

            if (data.prev_hash) {
                prevEl.textContent = data.prev_hash;
                if (prevSeq > 0) {
                    prevEl.href = `/ledger/${prevSeq}`;
                } else {
                    prevEl.removeAttribute('href');
                }
            } else {
                prevEl.textContent = '-';
                prevEl.removeAttribute('href');
            }
        }
    }

    async function loadTransactions(ledgerData) {
        // Use the link provided in the resource if available, or construct standard one
        // Standard: /ledgers/{seq}/transactions
        const url = `${horizonBase}/ledgers/${ledgerSeq}/transactions?limit=200&order=desc`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to load transactions');
            const data = await res.json();
            const records = data._embedded?.records || [];

            renderTransactions(records);
        } catch (e) {
            console.error(e);
            // Don't block the UI, just show empty or error in console
        }
    }

    function renderTransactions(txs) {
        txListEl.innerHTML = '';
        if (txs.length === 0) {
            noTxMsg.classList.remove('is-hidden');
            return;
        }

        txs.forEach(tx => {
            const row = document.createElement('tr');

            // Hash
            const tdHash = document.createElement('td');
            const link = document.createElement('a');
            link.href = `/tx/${tx.hash}`;
            link.className = 'is-mono';
            link.textContent = shorten(tx.hash);
            tdHash.appendChild(link);

            // Source
            const tdSource = document.createElement('td');
            const sourceLink = document.createElement('a');
            sourceLink.href = `/account/${tx.source_account}`;
            sourceLink.className = 'is-mono';
            sourceLink.textContent = shorten(tx.source_account);
            tdSource.appendChild(sourceLink);

            // Ops
            const tdOps = document.createElement('td');
            tdOps.textContent = tx.operation_count;

            // Status
            const tdStatus = document.createElement('td');
            if (tx.successful) {
                tdStatus.innerHTML = `<span class="tag is-success is-light">${t('status_success')}</span>`;
            } else {
                tdStatus.innerHTML = `<span class="tag is-danger is-light">${t('status_failed')}</span>`;
            }

            row.appendChild(tdHash);
            row.appendChild(tdSource);
            row.appendChild(tdOps);
            row.appendChild(tdStatus);

            txListEl.appendChild(row);
        });
    }

    // Apply static translations
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });

    loadLedger();
}
