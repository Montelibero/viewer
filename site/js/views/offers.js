
export async function init(params, i18n) {
    const [accountId] = params;
    document.getElementById('account-id').textContent = accountId;

    // Update back button
    const backBtn = document.querySelector('a[data-i18n="back-home"]');
    if (backBtn) {
        backBtn.href = `/account/${accountId}`;
        backBtn.textContent = i18n.t('back-account') || 'Back to Account';
    }

    const container = document.getElementById('offers-list');

    try {
        const res = await fetch(`https://horizon.stellar.org/accounts/${accountId}/offers`);
        if (!res.ok) {
             container.textContent = 'Error loading offers or account not found.';
             return;
        }
        const data = await res.json();
        const records = data._embedded?.records || [];

        container.innerHTML = '';
        if (!records.length) {
            container.textContent = 'No offers found.';
            return;
        }

        const ul = document.createElement('ul');
        records.forEach(o => {
            const li = document.createElement('li');
            const buying = o.buying.asset_type === 'native' ? 'XLM' : o.buying.asset_code;
            const selling = o.selling.asset_type === 'native' ? 'XLM' : o.selling.asset_code;
            li.textContent = `Sell ${o.amount} ${selling} for ${buying} @ ${o.price}`;
            ul.appendChild(li);
        });
        container.appendChild(ul);
    } catch(e) {
        container.textContent = 'Error: ' + e.message;
    }
}
