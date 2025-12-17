
import { shorten } from '../../common.js?v=6';

export async function init(params, i18n) {
    const [accountId] = params;
    document.getElementById('entity-id').textContent = accountId;
    const backBtn = document.querySelector('a[data-i18n="back-home"]');
    if (backBtn) {
        backBtn.href = `/account/${accountId}`;
        backBtn.textContent = i18n.t('back-account') || 'Back to Account';
    }

    const container = document.getElementById('operations-container');
    const { t } = i18n;

    async function loadOps() {
        try {
            const res = await fetch(`https://horizon.stellar.org/accounts/${accountId}/operations?order=desc&limit=20&join=transactions`);
            if (res.status === 404) {
                container.textContent = 'Account not found.';
                return;
            }
            if (!res.ok) {
                container.textContent = `Error loading operations: ${res.status}`;
                return;
            }

            const data = await res.json();
            const records = data._embedded?.records || [];

            container.innerHTML = '';
            if(!records.length) {
                container.textContent = 'No operations found.';
                return;
            }

            const table = document.createElement('table');
            table.className = 'table is-fullwidth is-striped';
            table.innerHTML = `<thead><tr><th>ID</th><th>Type</th><th>Time</th></tr></thead><tbody></tbody>`;
            const tbody = table.querySelector('tbody');

            records.forEach(op => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><span class="is-mono is-size-7">${op.id}</span></td>
                    <td>${op.type}</td>
                    <td>${op.created_at}</td>
                `;
                tbody.appendChild(tr);
            });
            container.appendChild(table);

        } catch(e) {
            container.textContent = 'Error loading operations: ' + e.message;
        }
    }

    loadOps();
}
