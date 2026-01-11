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

export async function init(params, i18n) {
    const { t } = i18n;
    const [poolId] = params;

    // UI Elements
    const backBtn = document.getElementById('btn-back');
    const poolIdDisplay = document.getElementById('pool-id-display');
    const loader = document.getElementById('loader');
    const errorBox = document.getElementById('error-box');
    const errorMessage = document.getElementById('error-message');
    const chartsContainer = document.getElementById('charts-container');
    const loadMoreBtn = document.getElementById('btn-load-more');

    if (backBtn) backBtn.href = `/pool/${poolId}`;
    if (poolIdDisplay) poolIdDisplay.textContent = shorten(poolId);

    // State
    const allTrades = []; // Stores trades in chronological order (Oldest -> Newest) after processing
    let nextUrl = `${horizonBase}/liquidity_pools/${poolId}/trades?limit=200&order=desc`;
    let oldestLoadedTime = new Date();

    // Chart instances
    let priceChart = null;
    let volumeChart = null;

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

    // Fetch Logic
    async function loadMoreData() {
        if (!nextUrl) return;

        loadMoreBtn.classList.add('is-loading');

        const targetTime = new Date(oldestLoadedTime.getTime() - 7 * 24 * 60 * 60 * 1000);
        let fetchedAny = false;

        try {
            while (nextUrl) {
                const res = await fetch(nextUrl);
                if (!res.ok) throw new Error('Failed to load trades');
                const data = await res.json();
                const records = data._embedded?.records || [];

                if (records.length === 0) {
                    nextUrl = null;
                    break;
                }

                allTrades.push(...records);
                fetchedAny = true;

                const lastRecord = records[records.length - 1];
                const lastDate = new Date(lastRecord.ledger_close_time);

                if (lastDate < oldestLoadedTime) oldestLoadedTime = lastDate;

                nextUrl = data._links?.next?.href;

                // Stop if we passed target or reached end
                if (lastDate < targetTime || records.length < 200) {
                     if (records.length < 200) nextUrl = null;
                     break;
                }
            }

            if (fetchedAny) updateCharts();

            if (!nextUrl) {
                loadMoreBtn.setAttribute('disabled', 'true');
                loadMoreBtn.textContent = t('no-more-data') || 'End of history';
            }

        } catch (e) {
            console.error(e);
            showError(e.message);
        } finally {
            loadMoreBtn.classList.remove('is-loading');
            loader.classList.add('is-hidden');
            chartsContainer.classList.remove('is-hidden');
        }
    }

    function updateCharts() {
        if (allTrades.length === 0) {
            errorMessage.textContent = 'No trades found.';
            errorBox.classList.remove('is-hidden');
            return;
        }

        // Prepare data: Reverse to be Chronological (Oldest -> Newest)
        const chronTrades = [...allTrades].reverse();

        const labels = chronTrades.map(t => {
            const d = new Date(t.ledger_close_time);
            // Short format: DD.MM HH:mm
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            return `${day}.${month} ${hours}:${mins}`;
        });

        // Infer assets
        const sample = allTrades[0];
        const baseCode = sample.base_asset_code || 'XLM';
        const counterCode = sample.counter_asset_code || 'XLM';

        const dataPrice = chronTrades.map(t => parseFloat(t.price.n) / parseFloat(t.price.d));
        const dataVolume = chronTrades.map(t => parseFloat(t.base_amount));

        // Create or Update Charts
        if (!priceChart) {
            const ctxPrice = document.getElementById('price-chart');
            priceChart = new Chart(ctxPrice, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: `${baseCode}/${counterCode}`,
                        data: dataPrice,
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.1,
                        pointRadius: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: 'index' },
                    scales: {
                        x: { display: true, ticks: { maxTicksLimit: 8 } }
                    }
                }
            });

            const ctxVol = document.getElementById('volume-chart');
            volumeChart = new Chart(ctxVol, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: `Volume (${baseCode})`,
                        data: dataVolume,
                        backgroundColor: 'rgba(54, 162, 235, 0.5)'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { display: true, ticks: { maxTicksLimit: 8 } }
                    }
                }
            });
        } else {
            // Update existing instances
            priceChart.data.labels = labels;
            priceChart.data.datasets[0].data = dataPrice;
            priceChart.update();

            volumeChart.data.labels = labels;
            volumeChart.data.datasets[0].data = dataVolume;
            volumeChart.update();
        }
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => loadMoreData());
    }

    // Initial Load
    await loadMoreData();
}
