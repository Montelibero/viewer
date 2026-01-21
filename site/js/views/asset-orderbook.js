import { getHorizonURL, shorten } from '../common.js';
import { findCounterAssets } from '../asset-utils.js';

const horizonBase = getHorizonURL();

async function loadChartJs() {
    if (window.Chart) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [assetParam] = params;

    let baseCode = '';
    let baseIssuer = '';
    const idx = assetParam.lastIndexOf('-');
    if (idx > 0) {
        baseCode = assetParam.slice(0, idx);
        baseIssuer = assetParam.slice(idx + 1);
    }

    const btnBack = document.getElementById('btn-back');
    const baseCodeDisplay = document.getElementById('base-code-display');
    const selectWrapper = document.getElementById('select-wrapper');
    const selectEl = document.getElementById('counter-select');
    const manualInput = document.getElementById('manual-input');
    const btnShow = document.getElementById('btn-show');
    const container = document.getElementById('orderbook-container');
    const errorBox = document.getElementById('error-box');
    const errorMsg = document.getElementById('error-message');
    const bidsBody = document.getElementById('bids-body');
    const asksBody = document.getElementById('asks-body');

    if (btnBack) btnBack.href = `/asset/${encodeURIComponent(assetParam)}`;
    if (baseCodeDisplay) baseCodeDisplay.textContent = shorten(baseCode);
    if (selectWrapper && !baseCode) selectWrapper.classList.add('is-loading');

    let currentCounter = null;
    let chart = null;

    function showError(msg) {
        if (errorMsg) errorMsg.textContent = msg;
        if (errorBox) errorBox.classList.remove('is-hidden');
    }

    function clearError() {
        if (errorBox) errorBox.classList.add('is-hidden');
    }

    // Populate Selector
    findCounterAssets(baseCode, baseIssuer).then(counters => {
        selectEl.innerHTML = `<option value="" selected disabled>${t('select-counter') || 'Select Pair'}</option>`;
        if (selectWrapper) selectWrapper.classList.remove('is-loading');

        counters.forEach(c => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify(c);
            const issuerShort = c.issuer ? ` (${shorten(c.issuer)})` : '';
            opt.textContent = `${c.code}${issuerShort}`;
            selectEl.appendChild(opt);
        });

        // Handle URL param 'counter'
        const urlParams = new URLSearchParams(window.location.search);
        const counterParam = urlParams.get('counter');
        if (counterParam) {
            let targetCode = counterParam;
            let targetIssuer = null;
            if (counterParam.includes('-')) {
                const parts = counterParam.split('-');
                targetCode = parts[0];
                targetIssuer = parts[1];
            }

            let found = null;
            // Native check
            if (targetCode === 'XLM' && !targetIssuer) {
                found = [...selectEl.options].find(o => o.value && JSON.parse(o.value).type === 'native');
            } else {
                found = [...selectEl.options].find(o => {
                    if (!o.value) return false;
                    const v = JSON.parse(o.value);
                    return v.code === targetCode && v.issuer === targetIssuer;
                });
            }

            if (found) {
                selectEl.value = found.value;
                triggerLoad(JSON.parse(found.value));
            } else {
                manualInput.value = counterParam;
                btnShow.click();
            }
        }
    }).catch(e => {
        console.error(e);
        selectEl.innerHTML = `<option>${t('error-loading-pairs') || 'Error loading pairs'}</option>`;
    });

    selectEl.addEventListener('change', () => {
        if (!selectEl.value) return;
        const p = JSON.parse(selectEl.value);
        manualInput.value = '';
        triggerLoad(p);
    });

    btnShow.addEventListener('click', () => {
        const val = manualInput.value.trim();
        if (!val) return;
        let code, issuer, type;
        if (val.toUpperCase() === 'XLM') {
            code = 'XLM';
            type = 'native';
        } else {
            if (val.includes('-')) {
                const parts = val.split('-');
                code = parts[0];
                issuer = parts[1];
                type = 'credit_alphanum';
            } else {
                showError('Invalid format. Use CODE-ISSUER');
                return;
            }
        }
        triggerLoad({ code, issuer, type });
    });

    function triggerLoad(counter) {
        currentCounter = counter;
        const url = new URL(window.location);
        const id = counter.type === 'native' ? 'XLM' : `${counter.code}-${counter.issuer}`;
        url.searchParams.set('counter', id);
        window.history.replaceState(null, '', url);
        loadData();
    }

    async function loadData() {
        if (!currentCounter) return;
        clearError();
        container.classList.remove('is-hidden');

        try {
            await loadChartJs();

            const params = new URLSearchParams();
            if (baseCode === 'XLM') {
                params.set('selling_asset_type', 'native');
            } else {
                params.set('selling_asset_code', baseCode);
                params.set('selling_asset_issuer', baseIssuer);
                params.set('selling_asset_type', 'credit_alphanum12');
            }

            if (currentCounter.code === 'XLM') {
                params.set('buying_asset_type', 'native');
            } else {
                params.set('buying_asset_code', currentCounter.code);
                params.set('buying_asset_issuer', currentCounter.issuer);
                params.set('buying_asset_type', 'credit_alphanum12');
            }
            params.set('limit', 200);

            const url = `${horizonBase}/order_book?${params.toString()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch orderbook');
            const data = await res.json();

            renderOrderbook(data.bids, data.asks);

        } catch (e) {
            console.error(e);
            showError(e.message);
        }
    }

    function renderOrderbook(bids, asks) {
        renderTable(bids, bidsBody, true);
        renderTable(asks, asksBody, false);
        renderChart(bids, asks);
    }

    function renderTable(list, tbody, isBid) {
        tbody.innerHTML = '';
        let sum = 0;

        list.forEach(item => {
            const amount = parseFloat(item.amount);
            sum += amount;

            const row = document.createElement('tr');

            const pCell = document.createElement('td');
            pCell.className = 'is-mono';
            pCell.classList.add(isBid ? 'has-text-success' : 'has-text-danger');
            pCell.textContent = parseFloat(item.price).toFixed(7);

            const aCell = document.createElement('td');
            aCell.className = 'has-text-right is-mono';
            aCell.textContent = amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 7});

            const sCell = document.createElement('td');
            sCell.className = 'has-text-right is-mono has-text-grey-light';
            sCell.textContent = sum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 7});

            row.appendChild(pCell);
            row.appendChild(aCell);
            row.appendChild(sCell);
            tbody.appendChild(row);
        });
    }

    function renderChart(bids, asks) {
        const bidsPoints = [];
        let bSum = 0;
        bids.forEach(b => {
            bSum += parseFloat(b.amount);
            bidsPoints.push({ x: parseFloat(b.price), y: bSum });
        });
        bidsPoints.reverse();

        const asksPoints = [];
        let aSum = 0;
        asks.forEach(a => {
            aSum += parseFloat(a.amount);
            asksPoints.push({ x: parseFloat(a.price), y: aSum });
        });

        const ctx = document.getElementById('depth-chart');
        if (chart) chart.destroy();

        chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Bids (Buy)',
                        data: bidsPoints,
                        borderColor: '#48c774', // Green
                        backgroundColor: 'rgba(72, 199, 116, 0.2)',
                        fill: true,
                        stepped: 'before',
                        tension: 0,
                        pointRadius: 0
                    },
                    {
                        label: 'Asks (Sell)',
                        data: asksPoints,
                        borderColor: '#f14668', // Red
                        backgroundColor: 'rgba(241, 70, 104, 0.2)',
                        fill: true,
                        stepped: 'after',
                        tension: 0,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index',
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: `Price (${currentCounter.code})` }
                    },
                    y: {
                        title: { display: true, text: `Volume (${baseCode})` }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.y.toFixed(2)}`
                        }
                    }
                }
            }
        });

    }
}
