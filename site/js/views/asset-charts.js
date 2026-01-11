import { getHorizonURL, shorten } from '../common.js';

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

// Reuse logic from asset.js but we only need the counter assets
async function fetchAssetPools(code, issuer) {
    const assetId = `${code}:${issuer}`;
    let nextUrl = `${horizonBase}/liquidity_pools?reserves=${assetId}&limit=200&order=asc`;
    let lastCursor = null;
    const pools = [];

    while (nextUrl) {
        const res = await fetch(nextUrl);
        if (!res.ok) throw new Error(`Horizon error ${res.status}`);

        const data = await res.json();
        const records = data?._embedded?.records || [];
        pools.push(...records);

        if (!records.length) break;

        const nextHref = data?._links?.next?.href;
        if (!nextHref) break;
        const parsed = new URL(nextHref);
        const cursor = parsed.searchParams.get('cursor');
        if (!cursor || cursor === lastCursor) break;
        lastCursor = cursor;
        nextUrl = `${horizonBase}/liquidity_pools?reserves=${assetId}&limit=200&order=asc&cursor=${encodeURIComponent(cursor)}`;
    }

    return pools;
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

    // UI Elements are already in DOM via router
    const btnBack = document.getElementById('btn-back');
    const baseCodeDisplay = document.getElementById('base-code-display');
    const selectWrapper = document.getElementById('select-wrapper');
    const selectEl = document.getElementById('counter-select');
    const manualInput = document.getElementById('manual-input');
    const btnShow = document.getElementById('btn-show');
    const chartsContainer = document.getElementById('charts-container');
    const errorBox = document.getElementById('error-box');
    const errorMsg = document.getElementById('error-message');
    const tabs = document.querySelectorAll('.tabs li');
    const btnLoadMore = document.getElementById('btn-load-more');
    const volumeLogToggle = document.getElementById('volume-log-toggle');

    // Init UI text
    if (btnBack) btnBack.href = `/asset/${encodeURIComponent(assetParam)}`;
    if (baseCodeDisplay) baseCodeDisplay.textContent = shorten(baseCode);
    if (selectWrapper && !baseCode) selectWrapper.classList.add('is-loading');

    let currentCounter = null; // { code, issuer, type }
    let currentResolution = 3600000; // 1h
    let oldestTime = Date.now();
    let allRecords = [];

    // Charts
    let priceChart, volumeChart, countChart;

    function showError(msg) {
        if (errorMsg) errorMsg.textContent = msg;
        if (errorBox) errorBox.classList.remove('is-hidden');
    }

    function clearError() {
        if (errorBox) errorBox.classList.add('is-hidden');
    }

    // Load Pools to populate dropdown
    fetchAssetPools(baseCode, baseIssuer).then(pools => {
        selectEl.innerHTML = `<option value="" selected disabled>${t('select-counter') || 'Select Pair'}</option>`;
        if (selectWrapper) selectWrapper.classList.remove('is-loading');

        const pairs = new Map(); // Key: "CODE:ISSUER", Value: details

        pools.forEach(p => {
            // Find the other asset
            const res = p.reserves;
            const myAssetId = `${baseCode}:${baseIssuer}`;
            const other = res.find(r => r.asset !== myAssetId) || (res[0].asset === myAssetId ? res[1] : res[0]);

            // Check if other is same (should not happen in valid pool)
            if (!other) return;

            let cCode, cIssuer, cType;
            if (other.asset === 'native') {
                cCode = 'XLM';
                cIssuer = null;
                cType = 'native';
            } else {
                [cCode, cIssuer] = other.asset.split(':');
                cType = 'credit_alphanum4'; // Simplified
            }

            const key = other.asset;
            if (!pairs.has(key)) {
                pairs.set(key, { code: cCode, issuer: cIssuer, type: cType, count: 1 });
            } else {
                pairs.get(key).count++;
            }
        });

        // Convert map to options
        // Sort by 'native' first, then alphanumeric
        const sorted = [...pairs.values()].sort((a, b) => {
            if (a.type === 'native') return -1;
            if (b.type === 'native') return 1;
            return a.code.localeCompare(b.code);
        });

        sorted.forEach(p => {
            const opt = document.createElement('option');
            // Store as JSON in value
            opt.value = JSON.stringify(p);
            const issuerShort = p.issuer ? ` (${shorten(p.issuer)})` : '';
            opt.textContent = `${p.code}${issuerShort}`;
            selectEl.appendChild(opt);
        });

        // Handle pre-selection from URL
        const urlParams = new URLSearchParams(window.location.search);
        const counterParam = urlParams.get('counter');
        if (counterParam) {
            // Try to match dropdown
            // Param format: CODE-ISSUER or XLM
            let targetCode = counterParam;
            let targetIssuer = null;
            if (counterParam.includes('-')) {
                const parts = counterParam.split('-');
                targetCode = parts[0];
                targetIssuer = parts[1];
            } else {
                targetCode = counterParam; // XLM
            }

            // Find in pairs
            // Special case XLM
            if (targetCode === 'XLM' && !targetIssuer) {
                 const found = [...selectEl.options].find(o => o.value && JSON.parse(o.value).type === 'native');
                 if (found) {
                     selectEl.value = found.value;
                     triggerLoad(JSON.parse(found.value));
                     return;
                 }
            } else {
                const found = [...selectEl.options].find(o => {
                    if (!o.value) return false;
                    const v = JSON.parse(o.value);
                    return v.code === targetCode && v.issuer === targetIssuer;
                });
                if (found) {
                    selectEl.value = found.value;
                    triggerLoad(JSON.parse(found.value));
                    return;
                }
            }

            // If not found in dropdown, use manual load logic
            manualInput.value = counterParam;
            btnShow.click();
        }

    }).catch(e => {
        console.error(e);
        selectEl.innerHTML = `<option>${t('error-loading-pools') || 'Error loading pools'}</option>`;
    });

    // Interaction
    selectEl.addEventListener('change', () => {
        if (!selectEl.value) return;
        const p = JSON.parse(selectEl.value);
        manualInput.value = ''; // clear manual
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
            // Check for hyphen
            if (val.includes('-')) {
                const parts = val.split('-');
                code = parts[0];
                issuer = parts[1];
                type = 'credit_alphanum'; // approximate
            } else {
                // Invalid format usually, or maybe just code?
                showError('Invalid format. Use CODE-ISSUER');
                return;
            }
        }

        const p = { code, issuer, type };
        triggerLoad(p);
    });

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            const newRes = parseInt(tab.dataset.res);
            if (newRes !== currentResolution) {
                currentResolution = newRes;
                reloadCharts();
            }
        });
    });

    btnLoadMore.addEventListener('click', () => {
        if (!currentCounter) return;
        loadData(true);
    });

    if (volumeLogToggle) {
        volumeLogToggle.addEventListener('change', () => {
             // Just update chart config without reload if data exists
             if (allRecords.length > 0) renderCharts();
        });
    }

    function triggerLoad(counter) {
        currentCounter = counter;

        // Update URL
        const url = new URL(window.location);
        const id = counter.type === 'native' ? 'XLM' : `${counter.code}-${counter.issuer}`;
        url.searchParams.set('counter', id);
        window.history.replaceState(null, '', url);

        reloadCharts();
    }

    function reloadCharts() {
        allRecords = [];
        oldestTime = Date.now();
        chartsContainer.classList.remove('is-hidden');
        if (priceChart) priceChart.destroy();
        if (volumeChart) volumeChart.destroy();
        if (countChart) countChart.destroy();
        priceChart = null;
        volumeChart = null;
        countChart = null;

        loadData(false);
    }

    async function loadData(append = false) {
        if (!currentCounter) return;
        clearError();
        btnLoadMore.classList.add('is-loading');

        try {
            await loadChartJs();

            const params = new URLSearchParams();

            function setAssetParams(prefix, code, issuer) {
                if (code === 'XLM') {
                    params.set(`${prefix}_asset_type`, 'native');
                } else {
                    params.set(`${prefix}_asset_code`, code);
                    params.set(`${prefix}_asset_issuer`, issuer);
                    params.set(`${prefix}_asset_type`, code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12');
                }
            }

            setAssetParams('base', baseCode, baseIssuer);
            setAssetParams('counter', currentCounter.code, currentCounter.issuer);

            params.set('resolution', currentResolution);
            params.set('limit', 200);
            params.set('order', 'desc');

            if (append && allRecords.length > 0) {
                // To page backwards: end_time = timestamp_of_oldest_record
                params.set('end_time', oldestTime);
            }

            const url = `${horizonBase}/trade_aggregations?${params.toString()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch data');
            const data = await res.json();
            const records = data._embedded?.records || [];

            if (records.length === 0) {
                btnLoadMore.setAttribute('disabled', 'true');
                btnLoadMore.textContent = t('no-more-data') || 'No more data';
            } else {
                // Update oldest time
                const last = records[records.length - 1];
                oldestTime = parseInt(last.timestamp);

                // Add to allRecords. Note: records are desc (New -> Old).
                allRecords.push(...records);

                renderCharts();
            }

        } catch (e) {
            console.error(e);
            showError(e.message);
        } finally {
            btnLoadMore.classList.remove('is-loading');
        }
    }

    function renderCharts() {
        // Data is Newest -> Oldest. Chart needs Oldest -> Newest.
        const chron = [...allRecords].reverse();

        const labels = chron.map(r => {
            const d = new Date(parseInt(r.timestamp));
            // DD.MM HH:mm
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            return `${day}.${month} ${hours}:${mins}`;
        });

        // Price: usually 'close' or 'avg'. Let's use avg
        const dataPrice = chron.map(r => parseFloat(r.avg));
        // Volume: base_volume
        const dataVol = chron.map(r => parseFloat(r.base_volume));
        // Count: trade_count
        const dataCount = chron.map(r => parseInt(r.trade_count));

        if (!priceChart) {
            // Init
            const ctxPrice = document.getElementById('price-chart');
            priceChart = new Chart(ctxPrice, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: `Price (${currentCounter.code})`,
                        data: dataPrice,
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.1,
                        pointRadius: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: 'index' },
                    scales: { x: { display: false } } // Hide X on top chart
                }
            });

            const ctxVol = document.getElementById('volume-chart');
            const isLog = volumeLogToggle && volumeLogToggle.checked;
            volumeChart = new Chart(ctxVol, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: `Volume (${baseCode})`,
                        data: dataVol,
                        backgroundColor: 'rgba(54, 162, 235, 0.5)'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { display: false },
                        y: { type: isLog ? 'logarithmic' : 'linear' }
                    }
                }
            });

            const ctxCount = document.getElementById('count-chart');
            countChart = new Chart(ctxCount, {
                type: 'bar', // or line? Bar is good for counts
                data: {
                    labels: labels, // Show labels here
                    datasets: [{
                        label: `Trades`,
                        data: dataCount,
                        backgroundColor: 'rgba(255, 159, 64, 0.5)'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { x: { display: true, ticks: { maxTicksLimit: 8 } } }
                }
            });

        } else {
            // Update
            priceChart.data.labels = labels;
            priceChart.data.datasets[0].data = dataPrice;
            priceChart.update();

            volumeChart.data.labels = labels;
            volumeChart.data.datasets[0].data = dataVol;
            const isLog = volumeLogToggle && volumeLogToggle.checked;
            volumeChart.options.scales.y.type = isLog ? 'logarithmic' : 'linear';
            volumeChart.update();

            countChart.data.labels = labels;
            countChart.data.datasets[0].data = dataCount;
            countChart.update();
        }
    }
}
