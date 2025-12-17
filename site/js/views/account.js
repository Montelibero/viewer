
export async function init(params, i18n) {
    const [accountId] = params;
    document.getElementById('account-id').textContent = accountId;
    document.getElementById('btn-ops').href = `/account/${accountId}/operations`;
    document.getElementById('btn-offers').href = `/offers/${accountId}`;

    const balancesList = document.getElementById('balances-list');

    try {
        const res = await fetch(`https://horizon.stellar.org/accounts/${accountId}`);
        if (res.status === 404) {
             balancesList.textContent = 'Account not found.';
             return;
        }
        const data = await res.json();

        balancesList.innerHTML = '';
        const ul = document.createElement('ul');
        data.balances.forEach(b => {
            const li = document.createElement('li');
            const code = b.asset_type === 'native' ? 'XLM' : b.asset_code;
            li.textContent = `${b.balance} ${code}`;
            ul.appendChild(li);
        });
        balancesList.appendChild(ul);
    } catch(e) {
        balancesList.textContent = 'Error: ' + e.message;
    }
}
