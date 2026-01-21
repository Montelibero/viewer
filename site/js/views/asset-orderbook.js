import { getHorizonURL, shorten } from '../common.js';
import { findCounterAssets } from '../asset-utils.js';

const horizonBase = getHorizonURL();
const FIAT_CODES = new Set(['USD', 'USDC', 'USDT', 'EUR', 'EURC', 'GBP', 'JPY', 'AUD', 'CHF', 'CAD', 'BRL', 'MXN', 'CNY', 'HKD']);

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

    if (assetParam === 'XLM') {
        baseCode = 'XLM';
    } else {
        const idx = assetParam.lastIndexOf('-');
        if (idx > 0) {
            baseCode = assetParam.slice(0, idx);
            baseIssuer = assetParam.slice(idx + 1);
        }
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
    const swapBaseLabel = document.getElementById('swap-base-label');
    const swapCounterLabel = document.getElementById('swap-counter-label');
    const swapSellBody = document.getElementById('swap-sell-body');
    const swapBuyBody = document.getElementById('swap-buy-body');
    const swapNote = document.getElementById('swap-note');

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
                params.set('selling_asset_type', baseCode.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12');
            }

            if (currentCounter.code === 'XLM') {
                params.set('buying_asset_type', 'native');
            } else {
                params.set('buying_asset_code', currentCounter.code);
                params.set('buying_asset_issuer', currentCounter.issuer);
                params.set('buying_asset_type', currentCounter.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12');
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
        renderSwapQuotes(bids, asks);
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

    function buildDepthPoints(list) {
        const sorted = [...list].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
        const points = [];
        let sum = 0;
        sorted.forEach(item => {
            const amount = parseFloat(item.amount);
            const price = parseFloat(item.price);
            if (Number.isNaN(amount) || Number.isNaN(price)) return;
            sum += amount;
            points.push({ x: price, y: sum });
        });
        if (points.length) {
            points.unshift({ x: points[0].x, y: 0 });
        }
        return points;
    }

    function renderChart(bids, asks) {
        const bidsPoints = buildDepthPoints(bids);
        const asksPoints = buildDepthPoints(asks);

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

    function getAssetDetails(code, issuer) {
        if (code === 'XLM') {
            return { code: 'XLM', issuer: null, type: 'native' };
        }
        const type = code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
        return { code, issuer, type };
    }

    function formatAssetIdentifier(asset) {
        if (asset.type === 'native') return 'native';
        return `${asset.code}:${asset.issuer}`;
    }

    function appendAssetParams(params, asset, prefix) {
        params.set(`${prefix}_asset_type`, asset.type);
        if (asset.type !== 'native') {
            params.set(`${prefix}_asset_code`, asset.code);
            params.set(`${prefix}_asset_issuer`, asset.issuer);
        }
    }

    function formatNumber(value, options = {}) {
        const safe = Number(value);
        if (Number.isNaN(safe)) return '-';
        return safe.toLocaleString(undefined, options);
    }

    function pickSwapAmounts(assetCode, priceHint) {
        const upper = (assetCode || '').toUpperCase();
        if (FIAT_CODES.has(upper)) {
            return [1, 10, 100, 1000];
        }
        if (priceHint && priceHint >= 100) {
            return [1, 0.1, 0.01, 0.001, 0.0001];
        }
        return [1, 10, 100, 1000];
    }

    async function fetchStrictSendQuote(sourceAsset, destinationAsset, amount) {
        const params = new URLSearchParams();
        appendAssetParams(params, sourceAsset, 'source');
        params.set('source_amount', amount.toString());
        params.set('destination_assets', formatAssetIdentifier(destinationAsset));
        params.set('limit', 1);

        const url = `${horizonBase}/paths/strict-send?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const record = data?._embedded?.records?.[0];
        if (!record) return null;
        return parseFloat(record.destination_amount);
    }

    async function renderSwapQuotes(bids, asks) {
        if (!swapSellBody || !swapBuyBody || !swapBaseLabel || !swapCounterLabel) return;
        swapSellBody.innerHTML = '';
        swapBuyBody.innerHTML = '';
        if (swapNote) swapNote.classList.add('is-hidden');

        const baseAsset = getAssetDetails(baseCode, baseIssuer);
        const counterAsset = getAssetDetails(currentCounter.code, currentCounter.issuer);
        swapBaseLabel.textContent = baseAsset.code;
        swapCounterLabel.textContent = counterAsset.code;

        const bestBid = bids.length ? parseFloat(bids[0].price) : null;
        const bestAsk = asks.length ? parseFloat(asks[0].price) : null;
        const priceHint = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || null;
        const baseAmounts = pickSwapAmounts(baseAsset.code, priceHint);
        const counterPriceHint = priceHint ? 1 / priceHint : null;
        const counterAmounts = pickSwapAmounts(counterAsset.code, counterPriceHint);

        const sellQuotes = await Promise.all(baseAmounts.map(async amount => {
            const received = await fetchStrictSendQuote(baseAsset, counterAsset, amount);
            return { amount, received };
        }));
        const buyQuotes = await Promise.all(counterAmounts.map(async amount => {
            const received = await fetchStrictSendQuote(counterAsset, baseAsset, amount);
            return { amount, received };
        }));

        let hasData = false;

        sellQuotes.forEach(quote => {
            const row = document.createElement('tr');
            const sendCell = document.createElement('td');
            sendCell.className = 'is-mono';
            sendCell.textContent = formatNumber(quote.amount, { maximumFractionDigits: 7 });

            const receiveCell = document.createElement('td');
            receiveCell.className = 'has-text-right is-mono';
            if (quote.received === null) {
                receiveCell.textContent = t('swap-no-path');
            } else {
                hasData = true;
                receiveCell.textContent = formatNumber(quote.received, { maximumFractionDigits: 7 });
            }

            const priceCell = document.createElement('td');
            priceCell.className = 'has-text-right is-mono has-text-grey-light';
            if (quote.received === null) {
                priceCell.textContent = '-';
            } else {
                const price = quote.received / quote.amount;
                priceCell.textContent = formatNumber(price, { maximumFractionDigits: 7 });
            }

            row.appendChild(sendCell);
            row.appendChild(receiveCell);
            row.appendChild(priceCell);
            swapSellBody.appendChild(row);
        });

        buyQuotes.forEach(quote => {
            const row = document.createElement('tr');
            const sendCell = document.createElement('td');
            sendCell.className = 'is-mono';
            sendCell.textContent = formatNumber(quote.amount, { maximumFractionDigits: 7 });

            const receiveCell = document.createElement('td');
            receiveCell.className = 'has-text-right is-mono';
            if (quote.received === null) {
                receiveCell.textContent = t('swap-no-path');
            } else {
                hasData = true;
                receiveCell.textContent = formatNumber(quote.received, { maximumFractionDigits: 7 });
            }

            const priceCell = document.createElement('td');
            priceCell.className = 'has-text-right is-mono has-text-grey-light';
            if (quote.received === null) {
                priceCell.textContent = '-';
            } else {
                const price = quote.amount / quote.received;
                priceCell.textContent = formatNumber(price, { maximumFractionDigits: 7 });
            }

            row.appendChild(sendCell);
            row.appendChild(receiveCell);
            row.appendChild(priceCell);
            swapBuyBody.appendChild(row);
        });

        if (!hasData && swapNote) {
            swapNote.classList.remove('is-hidden');
        }
    }
}
