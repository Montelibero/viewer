
export async function init(params, i18n) {
    const [hash] = params;
    document.getElementById('tx-hash').textContent = hash;
    const container = document.getElementById('tx-details');

    try {
        const res = await fetch(`https://horizon.stellar.org/transactions/${hash}`);
        if (res.status === 404) {
            container.textContent = 'Transaction not found.';
            return;
        }
        const tx = await res.json();

        container.innerHTML = `
            <p><strong>Status:</strong> ${tx.successful ? 'Success' : 'Failed'}</p>
            <p><strong>Ledger:</strong> ${tx.ledger}</p>
            <p><strong>Fee:</strong> ${tx.fee_charged} stroops</p>
            <p><strong>Operations:</strong> ${tx.operation_count}</p>
        `;
    } catch(e) {
        container.textContent = 'Error: ' + e.message;
    }
}
