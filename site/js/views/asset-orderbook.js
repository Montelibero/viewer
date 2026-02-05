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
    const btnSwapPair = document.getElementById('btn-swap-pair');
    const container = document.getElementById('orderbook-container');
    const errorBox = document.getElementById('error-box');
    const errorMsg = document.getElementById('error-message');
    const bidsBody = document.getElementById('bids-body');
    const asksBody = document.getElementById('asks-body');
    const spreadEl = document.getElementById('orderbook-spread');
    const spreadPriceEl = document.getElementById('spread-price');
    const spreadPercentEl = document.getElementById('spread-percent');
    const obBaseCode = document.getElementById('ob-base-code');
    const obCounterCode = document.getElementById('ob-counter-code');
    const obTotalCode = document.getElementById('ob-total-code');
    const priceStepSelect = document.getElementById('price-step-select');
    const swapBaseLabel = document.getElementById('swap-base-label');
    const swapCounterLabel = document.getElementById('swap-counter-label');
    const swapSellBody = document.getElementById('swap-sell-body');
    const swapBuyBody = document.getElementById('swap-buy-body');
    const swapNote = document.getElementById('swap-note');

    if (btnBack) btnBack.href = `/asset/${encodeURIComponent(assetParam)}`;
    if (baseCodeDisplay) baseCodeDisplay.textContent = shorten(baseCode);
    if (selectWrapper && !baseCode) selectWrapper.classList.add('is-loading');
    if (btnSwapPair) btnSwapPair.disabled = true;

    let currentCounter = null;
    let charts = [];
    let lastBids = [];
    let lastAsks = [];
    const TOP_LEVELS = 30;
    const LEVEL_BARS = 20;
    const LOG_EPS = 0.000001;
    const chartPalette = {
        bidLine: '#20b96b',
        bidFill: 'rgba(32, 185, 107, 0.2)',
        askLine: '#ff4f6d',
        askFill: 'rgba(255, 79, 109, 0.2)',
        bidBar: 'rgba(32, 185, 107, 0.55)',
        askBar: 'rgba(255, 79, 109, 0.55)'
    };
    const logToggles = {
        depth5: document.getElementById('depth-log-5')
    };
    const xBalanceToggle6 = document.getElementById('depth-x-balance-6');

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

    function formatAssetParam(asset) {
        if (!asset) return '';
        if (asset.type === 'native' || asset.code === 'XLM') return 'XLM';
        if (!asset.code || !asset.issuer) return '';
        return `${asset.code}-${asset.issuer}`;
    }

    if (btnSwapPair) {
        btnSwapPair.addEventListener('click', () => {
            if (!currentCounter || !baseCode) return;
            const baseAsset = getAssetDetails(baseCode, baseIssuer);
            const counterAsset = getAssetDetails(currentCounter.code, currentCounter.issuer);
            const newBase = formatAssetParam(counterAsset);
            const newCounter = formatAssetParam(baseAsset);
            if (!newBase || !newCounter) return;
            const url = new URL(window.location);
            url.pathname = `/asset/${encodeURIComponent(newBase)}/orderbook`;
            url.searchParams.set('counter', newCounter);
            window.history.pushState(null, '', url);
            window.dispatchEvent(new Event('popstate'));
        });
    }

    Object.values(logToggles).forEach(toggle => {
        if (!toggle) return;
        toggle.addEventListener('change', () => {
            if (lastBids.length || lastAsks.length) {
                renderCharts(lastBids, lastAsks);
            }
        });
    });

    if (priceStepSelect) {
        priceStepSelect.addEventListener('change', () => {
            if (lastBids.length || lastAsks.length) {
                renderOrderbookTables(lastBids, lastAsks);
            }
        });
    }
    if (xBalanceToggle6) {
        xBalanceToggle6.addEventListener('change', () => {
            if (lastBids.length || lastAsks.length) {
                renderCharts(lastBids, lastAsks);
            }
        });
    }

    function triggerLoad(counter) {
        currentCounter = counter;
        if (btnSwapPair) btnSwapPair.disabled = false;
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
        lastBids = bids;
        lastAsks = asks;

        // Update column headers
        if (obBaseCode) obBaseCode.textContent = shorten(baseCode);
        if (obCounterCode) obCounterCode.textContent = currentCounter ? shorten(currentCounter.code) : '';
        if (obTotalCode) obTotalCode.textContent = currentCounter ? shorten(currentCounter.code) : '';

        renderOrderbookTables(bids, asks);
        renderCharts(bids, asks);
        renderSwapQuotes(bids, asks);
    }

    function getPriceStep() {
        if (!priceStepSelect) return 0;
        return parseFloat(priceStepSelect.value) || 0;
    }

    function calculateAutoStep(bids, asks) {
        // Get best bid and ask prices
        const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
        const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
        const midPrice = (bestBid && bestAsk) ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk);

        if (!midPrice) return 0.01;

        // Calculate step as ~0.5-1% of price, rounded to nice number
        const rawStep = midPrice * 0.005;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const normalized = rawStep / magnitude;

        // Round to 1, 2, or 5
        let nice;
        if (normalized < 1.5) nice = 1;
        else if (normalized < 3.5) nice = 2;
        else if (normalized < 7.5) nice = 5;
        else nice = 10;

        return nice * magnitude;
    }

    function groupOrdersByPrice(list, step, isBid) {
        if (step <= 0 || list.length === 0) return list;

        const groups = new Map();

        list.forEach(item => {
            const price = parseFloat(item.price);
            const amount = parseFloat(item.amount);

            // Round price to step
            // For bids: round down (floor) - buyer wants lower price
            // For asks: round up (ceil) - seller wants higher price
            let groupPrice;
            if (isBid) {
                groupPrice = Math.floor(price / step) * step;
            } else {
                groupPrice = Math.ceil(price / step) * step;
            }

            const key = groupPrice.toFixed(10);
            if (groups.has(key)) {
                const existing = groups.get(key);
                existing.amount = (parseFloat(existing.amount) + amount).toString();
            } else {
                groups.set(key, {
                    price: groupPrice.toString(),
                    amount: amount.toString()
                });
            }
        });

        // Convert back to array and sort
        const result = Array.from(groups.values());
        if (isBid) {
            result.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
        } else {
            result.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
        }

        return result;
    }

    function renderOrderbookTables(bids, asks) {
        let step = getPriceStep();
        if (step === 0) {
            step = calculateAutoStep(bids, asks);
        }

        const groupedBids = groupOrdersByPrice(bids, step, true);
        const groupedAsks = groupOrdersByPrice(asks, step, false);

        // Calculate max totals for depth bars
        const bidTotals = calculateTotals(groupedBids);
        const askTotals = calculateTotals(groupedAsks);
        const maxBidTotal = bidTotals.length > 0 ? bidTotals[bidTotals.length - 1] : 0;
        const maxAskTotal = askTotals.length > 0 ? askTotals[askTotals.length - 1] : 0;
        const maxTotal = Math.max(maxBidTotal, maxAskTotal);

        // Render asks (reversed so best ask is at bottom, near spread)
        renderTable(groupedAsks, asksBody, false, maxTotal, true);
        // Render bids (normal order, best bid at top, near spread)
        renderTable(groupedBids, bidsBody, true, maxTotal, false);

        // Update spread display (use original data for accurate spread)
        renderSpread(bids, asks);
    }

    function calculateTotals(list) {
        const totals = [];
        let sum = 0;
        list.forEach(item => {
            const amount = parseFloat(item.amount);
            const price = parseFloat(item.price);
            sum += amount * price;
            totals.push(sum);
        });
        return totals;
    }

    function renderSpread(bids, asks) {
        if (!spreadPriceEl || !spreadPercentEl) return;

        const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : null;
        const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : null;

        if (bestBid && bestAsk) {
            const midPrice = (bestBid + bestAsk) / 2;
            const spreadPercent = ((bestAsk - bestBid) / midPrice) * 100;

            spreadPriceEl.textContent = midPrice.toFixed(7);
            spreadPercentEl.textContent = `${spreadPercent.toFixed(2)}%`;
        } else {
            spreadPriceEl.textContent = '--';
            spreadPercentEl.textContent = '';
        }
    }

    function renderTable(list, tbody, isBid, maxTotal, reverse) {
        tbody.innerHTML = '';

        // Calculate per-row totals and cumulative for depth bars
        const rows = [];
        let cumSum = 0;
        list.forEach(item => {
            const amount = parseFloat(item.amount);
            const price = parseFloat(item.price);
            const total = amount * price;  // per-row total
            cumSum += total;
            rows.push({ amount, price, total, cumSum });
        });

        // Reverse for asks so best ask (lowest price) appears at bottom
        if (reverse) {
            rows.reverse();
        }

        rows.forEach(item => {
            const row = document.createElement('tr');
            row.className = 'orderbook-row';

            // Depth bar via CSS gradient background on the row
            const depthPercent = maxTotal > 0 ? (item.cumSum / maxTotal) * 100 : 0;
            const bgColor = isBid ? 'rgba(32, 185, 107, 0.15)' : 'rgba(255, 79, 109, 0.15)';
            row.style.background = `linear-gradient(to left, ${bgColor} ${depthPercent}%, transparent ${depthPercent}%)`;

            // Amount column
            const aCell = document.createElement('td');
            aCell.className = 'is-mono';
            aCell.textContent = item.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 7});

            // Price column (colored)
            const pCell = document.createElement('td');
            pCell.className = 'has-text-centered is-mono';
            pCell.classList.add(isBid ? 'has-text-success' : 'has-text-danger');
            pCell.textContent = item.price.toFixed(7);

            // Total column (per-row value in counter asset: amount * price)
            const tCell = document.createElement('td');
            tCell.className = 'has-text-right is-mono has-text-grey-light';
            tCell.textContent = item.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 7});

            row.appendChild(aCell);
            row.appendChild(pCell);
            row.appendChild(tCell);
            tbody.appendChild(row);
        });
    }

    function parseLevels(list) {
        return list.map(item => {
            const price = parseFloat(item.price);
            const amount = parseFloat(item.amount);
            if (Number.isNaN(price) || Number.isNaN(amount)) return null;
            return { price, amount, value: price * amount };
        }).filter(Boolean);
    }

    function sortLevels(levels, side) {
        const sorted = [...levels];
        if (side === 'bid') {
            sorted.sort((a, b) => b.price - a.price);
        } else {
            sorted.sort((a, b) => a.price - b.price);
        }
        return sorted;
    }

    function sliceLevels(levels, side, limit) {
        return sortLevels(levels, side).slice(0, limit);
    }

    function accumulate(levels, side) {
        const sorted = sortLevels(levels, side);
        let sum = 0;
        let sumValue = 0;
        return sorted.map(level => {
            sum += level.amount;
            sumValue += level.value;
            return { level, sum, sumValue };
        });
    }

    function toPoints(accum, xMapper, yMapper, sortByX = false) {
        const points = accum.map(item => {
            const x = xMapper(item);
            const y = yMapper(item);
            if (Number.isNaN(x) || Number.isNaN(y)) return null;
            return { x, y };
        }).filter(Boolean);
        if (sortByX) points.sort((a, b) => a.x - b.x);
        return points;
    }

    function isLogEnabled(toggle) {
        return Boolean(toggle && toggle.checked);
    }

    function clampLogValue(value) {
        if (!Number.isFinite(value)) return value;
        return value <= 0 ? LOG_EPS : value;
    }

    function clampLogSeries(values, isLog) {
        if (!isLog) return values;
        return values.map(value => clampLogValue(value));
    }

    function pickBestPrice(levels, side) {
        return levels.reduce((best, level) => {
            if (best === null) return level.price;
            return side === 'bid' ? Math.max(best, level.price) : Math.min(best, level.price);
        }, null);
    }

    function destroyCharts() {
        charts.forEach(item => item.destroy());
        charts = [];
    }

    function makeDepthDataset(label, points, color, fillColor, options = {}) {
        return {
            label,
            data: points,
            borderColor: color,
            backgroundColor: fillColor,
            fill: options.fill ?? true,
            stepped: options.stepped ?? false,
            tension: options.tension ?? 0,
            pointRadius: options.pointRadius ?? 0,
            borderWidth: 2
        };
    }

    function createLineChart(id, datasets, options = {}) {
        const ctx = document.getElementById(id);
        if (!ctx) return;
        const chart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    x: {
                        type: options.xType || 'linear',
                        title: options.xTitle ? { display: true, text: options.xTitle } : undefined,
                        max: options.xMax
                    },
                    y: {
                        type: options.yType || 'linear',
                        title: options.yTitle ? { display: true, text: options.yTitle } : undefined,
                        suggestedMin: options.yMin,
                        suggestedMax: options.yMax
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: options.tooltipFormatter || ((ctx) => {
                                const value = ctx.parsed?.y;
                                return `${ctx.dataset.label}: ${formatNumber(value, { maximumFractionDigits: 6 })}`;
                            })
                        }
                    }
                }
            }
        });
        charts.push(chart);
    }

    function createBarChart(id, labels, datasets, options = {}) {
        const ctx = document.getElementById(id);
        if (!ctx) return;
        const chart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: { display: true, text: 'Level' }
                    },
                    y: {
                        type: options.yType || 'linear',
                        beginAtZero: options.yType !== 'logarithmic',
                        title: options.yTitle ? { display: true, text: options.yTitle } : undefined
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y, { maximumFractionDigits: 6 })}`
                        }
                    }
                }
            }
        });
        charts.push(chart);
    }

    function renderCharts(bids, asks) {
        destroyCharts();

        const bidLevels = parseLevels(bids);
        const askLevels = parseLevels(asks);
        const topBids = sliceLevels(bidLevels, 'bid', TOP_LEVELS);
        const topAsks = sliceLevels(askLevels, 'ask', TOP_LEVELS);
        const bidAccum = accumulate(topBids, 'bid');
        const askAccum = accumulate(topAsks, 'ask');

        const bidsLabel = t('bids');
        const asksLabel = t('asks');
        const volumeLabel = `Volume (${baseCode})`;
        const logDepth5 = isLogEnabled(logToggles.depth5);

        const barBidLevels = sliceLevels(bidLevels, 'bid', LEVEL_BARS);
        const barAskLevels = sliceLevels(askLevels, 'ask', LEVEL_BARS);
        const barDepth = Math.max(barBidLevels.length, barAskLevels.length);
        const barLabels = [];
        for (let i = barDepth; i >= 1; i -= 1) barLabels.push(`-${i}`);
        barLabels.push('0');
        for (let i = 1; i <= barDepth; i += 1) barLabels.push(`${i}`);

        const barSize = barLabels.length || 1;
        const bidSeries = Array(barSize).fill(null);
        const askSeries = Array(barSize).fill(null);

        barBidLevels.forEach((level, idx) => {
            const position = barDepth - 1 - idx;
            if (position >= 0 && position < bidSeries.length) bidSeries[position] = level.amount;
        });
        barAskLevels.forEach((level, idx) => {
            const position = barDepth + 1 + idx;
            if (position >= 0 && position < askSeries.length) askSeries[position] = level.amount;
        });

        const barBidAmounts = clampLogSeries(bidSeries, logDepth5);
        const barAskAmounts = clampLogSeries(askSeries, logDepth5);
        createBarChart('depth-chart-5', barLabels, [
            {
                label: bidsLabel,
                data: barBidAmounts,
                backgroundColor: chartPalette.bidBar,
                borderRadius: 4
            },
            {
                label: asksLabel,
                data: barAskAmounts,
                backgroundColor: chartPalette.askBar,
                borderRadius: 4
            }
        ], { yTitle: volumeLabel, yType: logDepth5 ? 'logarithmic' : 'linear' });

        const impactBidPoints = toPoints(
            bidAccum,
            item => item.sum,
            item => (item.sum ? item.sumValue / item.sum : 0)
        );
        const impactAskPoints = toPoints(
            askAccum,
            item => item.sum,
            item => (item.sum ? item.sumValue / item.sum : 0)
        );
        let xMax = undefined;
        if (xBalanceToggle6 && xBalanceToggle6.checked) {
            const bidMaxVolume = bidAccum.length > 0 ? bidAccum[bidAccum.length - 1].sum : 0;
            const askMaxVolume = askAccum.length > 0 ? askAccum[askAccum.length - 1].sum : 0;
            const minVolume = Math.min(bidMaxVolume, askMaxVolume);
            if (minVolume > 0) {
                xMax = minVolume * 1.05;
            }
        }
        createLineChart('depth-chart-6', [
            makeDepthDataset(bidsLabel, impactBidPoints, chartPalette.bidLine, chartPalette.bidFill, { fill: false, tension: 0.2 }),
            makeDepthDataset(asksLabel, impactAskPoints, chartPalette.askLine, chartPalette.askFill, { fill: false, tension: 0.2 })
        ], {
            xTitle: `Size (${baseCode})`,
            yTitle: `Avg price (${currentCounter.code})`,
            xMax: xMax,
            tooltipFormatter: (ctx) => `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y, { maximumFractionDigits: 7 })}`
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
            priceCell.className = 'has-text-right is-mono has-text-success';
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
            priceCell.className = 'has-text-right is-mono has-text-danger';
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
