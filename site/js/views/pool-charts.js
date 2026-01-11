import { getHorizonURL, shorten } from '../common.js';

const horizonBase = getHorizonURL();

// Dynamically load Chart.js if not already present
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
    const [poolId] = params;
    const backBtn = document.getElementById('btn-back');
    const poolIdDisplay = document.getElementById('pool-id-display');
    const loader = document.getElementById('loader');
    const errorBox = document.getElementById('error-box');
    const errorMessage = document.getElementById('error-message');
    const chartsContainer = document.getElementById('charts-container');

    if (backBtn) backBtn.href = `/pool/${poolId}`;
    if (poolIdDisplay) poolIdDisplay.textContent = shorten(poolId);

    function showError(msg) {
        if (loader) loader.classList.add('is-hidden');
        if (chartsContainer) chartsContainer.classList.add('is-hidden');
        if (errorBox) {
            errorBox.classList.remove('is-hidden');
            if (errorMessage) errorMessage.textContent = msg;
        }
    }

    try {
        await loadChartJs();
    } catch (e) {
        console.error('Failed to load Chart.js', e);
        showError('Failed to load charting library.');
        return;
    }

    // Fetch pool info to know assets
    let poolInfo = null;
    try {
        const res = await fetch(`${horizonBase}/liquidity_pools/${poolId}`);
        if (!res.ok) throw new Error('Failed to load pool info');
        poolInfo = await res.json();
    } catch (e) {
        showError(e.message);
        return;
    }

    // Determine Asset Codes
    // poolInfo.reserves[0].asset and poolInfo.reserves[1].asset
    // Format is "native" or "CODE:ISSUER"
    function getAssetCode(assetStr) {
        if (assetStr === 'native') return 'XLM';
        return assetStr.split(':')[0];
    }
    const assetA = poolInfo.reserves[0].asset;
    const assetB = poolInfo.reserves[1].asset;
    const codeA = getAssetCode(assetA);
    const codeB = getAssetCode(assetB);

    // Fetch trades
    const trades = [];
    // We want last 7 days.
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let nextUrl = `${horizonBase}/liquidity_pools/${poolId}/trades?limit=200&order=desc`;

    try {
        while (nextUrl) {
            const res = await fetch(nextUrl);
            if (!res.ok) throw new Error('Failed to load trades');
            const data = await res.json();
            const records = data._embedded?.records || [];

            let stop = false;
            for (const r of records) {
                const date = new Date(r.ledger_close_time);
                if (date < cutoff) {
                    stop = true;
                    // We still include this record if it's within range?
                    // Wait, if date < cutoff, it's older than 7 days.
                    // Since order is desc, we can stop.
                    break;
                }
                trades.push(r);
            }

            if (stop || records.length < 200) break;
            nextUrl = data._links?.next?.href;
        }
    } catch (e) {
        console.error(e);
        // If we have some trades, maybe show them? But for now just error.
        showError(e.message);
        return;
    }

    if (loader) loader.classList.add('is-hidden');
    if (chartsContainer) chartsContainer.classList.remove('is-hidden');

    if (trades.length === 0) {
        // Show "no data" message?
        // Reuse error box for simplicity or just leave empty charts.
        errorMessage.textContent = 'No trades in the last 7 days.';
        errorBox.classList.remove('is-hidden');
        return;
    }

    // Process data for charts
    // Trades are desc, reverse for charts (time ascending)
    trades.reverse();

    const labels = trades.map(t => new Date(t.ledger_close_time).toLocaleString());

    // Price: Counter / Base
    // API returns base_amount and counter_amount.
    // Also price object.
    // We need to match assetA/assetB to base/counter in the trade record to be consistent.
    // The trade record has base_asset_type/code/issuer etc.
    // We'll normalize to Price of Asset A in terms of Asset B (B/A) or vice versa.
    // Let's stick to "Price of Base Asset in Counter Asset" as per trade record logic usually?
    // Actually, let's try to keep it consistent with the pool's reserve order if possible,
    // or just use what the trade says.
    // For simplicity, let's use the trade's defined price, but label it "1 {BaseCode} = X {CounterCode}"

    // However, base/counter roles can swap per trade?
    // Horizon doc: "base_asset_..." and "counter_asset_..." are fields.
    // Does the pool always have fixed base/counter?
    // Usually pool reserves are just A and B.
    // Trades in Horizon for LP:
    // "base_amount": ... "counter_amount": ...
    // "base_asset_code": ...
    // We should check if base_asset is always the same for a given pool in Horizon responses?
    // It usually sorts assets alphanumerically.

    // Let's grab the first trade's base/counter codes for the label.
    const sample = trades[0];
    const baseCode = sample.base_asset_code || 'XLM'; // if native, code is undefined?
    const counterCode = sample.counter_asset_code || 'XLM';

    // Note: If 'native', Horizon might not send base_asset_code.
    // Sample response in memory: "base_asset_type": "credit_alphanum12", "base_asset_code": "AEURMTL"

    const chartDataPrice = trades.map(t => {
        const p = parseFloat(t.price.n) / parseFloat(t.price.d);
        return p;
    });

    const chartDataVolume = trades.map(t => parseFloat(t.base_amount)); // Volume in Base Asset

    // Setup Price Chart
    const ctxPrice = document.getElementById('price-chart');
    new Chart(ctxPrice, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${baseCode}/${counterCode}`,
                data: chartDataPrice,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false } // Hide dense labels
            },
            interaction: {
                intersect: false,
                mode: 'index',
            }
        }
    });

    // Setup Volume Chart
    const ctxVol = document.getElementById('volume-chart');
    new Chart(ctxVol, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `Volume (${baseCode})`,
                data: chartDataVolume,
                backgroundColor: 'rgba(54, 162, 235, 0.5)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
             scales: {
                x: { display: false }
            }
        }
    });

}
