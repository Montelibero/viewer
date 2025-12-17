
export async function init(params, i18n) {
    const [poolId] = params;
    document.getElementById('entity-id').textContent = poolId;

    const container = document.getElementById('operations-container');
    container.textContent = 'Loading...';

    try {
        const res = await fetch(`https://horizon.stellar.org/liquidity_pools/${poolId}/operations?order=desc&limit=20`);
        if (res.status === 404) {
             container.textContent = 'Pool not found.';
             return;
        }
        if (!res.ok) {
            container.textContent = `Error loading operations: ${res.status}`;
            return;
        }

        const data = await res.json();
        const records = data._embedded?.records || [];

        container.innerHTML = '';
        if (!records.length) {
             container.textContent = 'No operations found.';
             return;
        }

        const ul = document.createElement('ul');
        records.forEach(op => {
            const li = document.createElement('li');
            li.textContent = `${op.id} - ${op.type}`;
            ul.appendChild(li);
        });
        container.appendChild(ul);

    } catch(e) {
        container.textContent = 'Error: ' + e.message;
    }
}
