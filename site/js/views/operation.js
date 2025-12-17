
export async function init(params, i18n) {
    const [opId] = params;
    document.getElementById('op-id').textContent = opId;
    const container = document.getElementById('op-details');

    try {
        const res = await fetch(`https://horizon.stellar.org/operations/${opId}`);
        if (res.status === 404) {
            container.textContent = 'Operation not found.';
            return;
        }
        const op = await res.json();

        container.innerHTML = `
            <p><strong>Type:</strong> ${op.type}</p>
            <p><strong>Created At:</strong> ${op.created_at}</p>
            <p><strong>Transaction:</strong> <a href="/tx/${op.transaction_hash}">${op.transaction_hash.substr(0,8)}...</a></p>
        `;
    } catch(e) {
        container.textContent = 'Error: ' + e.message;
    }
}
