import { shorten } from '../common.js';

const rpcUrl = 'https://soroban-rpc.mainnet.stellar.gateway.fm/';
const expertBase = '/api/expert';

export async function init(params, i18n) {
    const { t } = i18n;
    const [contractId] = params;

    const idEl = document.getElementById('contract-id');
    if (idEl) idEl.textContent = contractId;

    const backBtn = document.getElementById('btn-back-contract');
    if (backBtn) backBtn.href = `/contract/${contractId}`;

    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');

    function showError(msg) {
        if (errorBox && errorText) {
            errorText.textContent = msg;
            errorBox.classList.remove('is-hidden');
        }
    }

    function toggleLoader(id, show) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('is-hidden', !show);
    }

    function txLink(hash) {
        const a = document.createElement('a');
        a.href = `https://stellar.expert/explorer/public/tx/${hash}`;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.className = 'is-mono';
        a.textContent = shorten(hash);
        return a;
    }

    function accountLink(id) {
        const a = document.createElement('a');
        a.href = `/account/${id}`;
        a.className = 'is-mono';
        a.textContent = shorten(id);
        return a;
    }

    async function loadEvents() {
        const listEl = document.getElementById('events-list');
        if (!listEl) return;
        toggleLoader('events-loader', true);
        listEl.innerHTML = '';

        try {
            const latestRes = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' })
            });
            if (!latestRes.ok) throw new Error(`RPC ${latestRes.status}`);
            const latestData = await latestRes.json();
            if (latestData.error) throw new Error(latestData.error.message || 'RPC error');
            const sequence = latestData.result?.sequence;
            if (!sequence) throw new Error('No ledger sequence');

            // Start near the oldest-retained ledger to cover the widest window.
            // RPC typically keeps ~17280 ledgers (~1 day). We probe with a safe offset
            // and fall back if the node rejects the range.
            const offsets = [17000, 12000, 6000, 2000];
            let events = null;
            let lastErr = null;
            for (const off of offsets) {
                const startLedger = Math.max(1, sequence - off);
                const res = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0', id: 2, method: 'getEvents',
                        params: {
                            startLedger,
                            filters: [{ type: 'contract', contractIds: [contractId] }],
                            pagination: { limit: 100 }
                        }
                    })
                });
                if (!res.ok) { lastErr = new Error(`RPC ${res.status}`); continue; }
                const data = await res.json();
                if (data.error) {
                    lastErr = new Error(data.error.message || 'RPC error');
                    // "out of range" — retry with smaller offset
                    if (/ledger range/i.test(lastErr.message)) continue;
                    throw lastErr;
                }
                events = data.result?.events || [];
                break;
            }
            if (events === null) throw lastErr || new Error('No RPC response');

            renderEvents(events, listEl);
        } catch (e) {
            console.error(e);
            showError(`${t('error-load-events')}: ${e.message}`);
        } finally {
            toggleLoader('events-loader', false);
        }
    }

    function renderEvents(events, listEl) {
        if (!events.length) {
            const p = document.createElement('p');
            p.className = 'has-text-grey';
            p.textContent = t('events-empty');
            listEl.appendChild(p);
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'table-container';
        const table = document.createElement('table');
        table.className = 'table is-fullwidth is-striped is-hoverable is-size-7';

        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th>${t('events-th-ledger')}</th>
            <th>${t('events-th-time')}</th>
            <th>${t('events-th-tx')}</th>
            <th>${t('events-th-topics')}</th>
        </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        events.forEach(ev => {
            const row = document.createElement('tr');

            const cLedger = document.createElement('td');
            cLedger.textContent = ev.ledger;
            row.appendChild(cLedger);

            const cTime = document.createElement('td');
            cTime.textContent = (ev.ledgerClosedAt || '').replace('T', ' ').replace('Z', '');
            row.appendChild(cTime);

            const cTx = document.createElement('td');
            if (ev.txHash) cTx.appendChild(txLink(ev.txHash));
            row.appendChild(cTx);

            const cTopics = document.createElement('td');
            cTopics.className = 'is-mono';
            const topicCount = Array.isArray(ev.topic) ? ev.topic.length : 0;
            cTopics.textContent = `${topicCount} ${t('events-topic-suffix')}`;
            row.appendChild(cTopics);

            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        listEl.appendChild(wrap);
    }

    async function loadExpert() {
        const listEl = document.getElementById('expert-list');
        const box = document.getElementById('expert-box');
        const btn = document.getElementById('btn-load-expert');
        if (!listEl || !box) return;

        box.classList.remove('is-hidden');
        if (btn) btn.disabled = true;
        toggleLoader('expert-loader', true);
        listEl.innerHTML = '';

        try {
            const url = `${expertBase}/contract/${contractId}/events?limit=50&order=desc`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Expert ${res.status}`);
            const data = await res.json();
            const records = data?._embedded?.records || [];
            renderExpert(records, listEl);
        } catch (e) {
            console.error(e);
            const p = document.createElement('p');
            p.className = 'has-text-danger';
            p.textContent = `${t('error-load-expert')}: ${e.message}`;
            listEl.appendChild(p);
        } finally {
            toggleLoader('expert-loader', false);
        }
    }

    function renderExpert(records, listEl) {
        if (!records.length) {
            const p = document.createElement('p');
            p.className = 'has-text-grey';
            p.textContent = t('expert-empty');
            listEl.appendChild(p);
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'table-container';
        const table = document.createElement('table');
        table.className = 'table is-fullwidth is-striped is-hoverable is-size-7';

        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th>${t('expert-th-date')}</th>
            <th>${t('expert-th-initiator')}</th>
            <th>${t('expert-th-topic')}</th>
        </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        records.forEach(rec => {
            const row = document.createElement('tr');

            const cDate = document.createElement('td');
            cDate.textContent = rec.ts ? new Date(rec.ts * 1000).toISOString().replace('T', ' ').slice(0, 19) : '—';
            row.appendChild(cDate);

            const cInit = document.createElement('td');
            if (rec.initiator) cInit.appendChild(accountLink(rec.initiator));
            else cInit.textContent = '—';
            row.appendChild(cInit);

            const cTopic = document.createElement('td');
            const topics = Array.isArray(rec.topics) ? rec.topics : [];
            cTopic.textContent = topics[0] ? String(topics[0]).replace(/^"|"$/g, '') : '—';
            cTopic.title = topics.join(' / ');
            row.appendChild(cTopic);

            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        listEl.appendChild(wrap);
    }

    // Auto-load RPC events.
    loadEvents();

    const btnExpert = document.getElementById('btn-load-expert');
    if (btnExpert) {
        btnExpert.addEventListener('click', (e) => {
            e.preventDefault();
            loadExpert();
        });
    }
}
