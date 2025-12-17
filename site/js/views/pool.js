
export async function init(params, i18n) {
    const [poolId] = params;
    document.getElementById('pool-id').textContent = poolId;
    document.getElementById('btn-ops').href = `/pool/${poolId}/operations`;

    const container = document.getElementById('pool-details');
    try {
        const res = await fetch(`https://horizon.stellar.org/liquidity_pools/${poolId}`);
        if (res.status === 404) {
            container.textContent = 'Pool not found.';
            return;
        }
        const pool = await res.json();

        // Show reserves
        const r = pool.reserves;
        const a1 = r[0].asset === 'native' ? 'XLM' : (r[0].asset.split(':')[0] || 'Asset A');
        const a2 = r[1].asset === 'native' ? 'XLM' : (r[1].asset.split(':')[0] || 'Asset B');

        container.innerHTML = `
            <p><strong>Reserves:</strong> ${r[0].amount} ${a1} / ${r[1].amount} ${a2}</p>
            <p><strong>Fee:</strong> ${pool.fee_bp} bp</p>
            <p><strong>Shares:</strong> ${pool.total_shares}</p>
        `;
    } catch(e) {
        container.textContent = 'Error: ' + e.message;
    }
}
