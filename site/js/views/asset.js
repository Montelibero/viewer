
export async function init(params, i18n) {
    const [assetParam] = params; // CODE-ISSUER
    document.getElementById('asset-id').textContent = assetParam;
    const container = document.getElementById('asset-details');

    const parts = assetParam.split('-');
    if (parts.length < 2) {
        container.textContent = 'Invalid asset format';
        return;
    }
    const code = parts[0];
    const issuer = parts[1];

    try {
        const res = await fetch(`https://horizon.stellar.org/assets?asset_code=${code}&asset_issuer=${issuer}`);
        const data = await res.json();
        const records = data._embedded?.records || [];

        if (!records.length) {
            container.textContent = 'Asset not found.';
            return;
        }

        const asset = records[0];
        container.innerHTML = `
            <p><strong>Type:</strong> ${asset.asset_type}</p>
            <p><strong>Amount:</strong> ${asset.amount}</p>
            <p><strong>Num Accounts:</strong> ${asset.num_accounts}</p>
            <p><strong>Flags:</strong> ${JSON.stringify(asset.flags)}</p>
        `;
    } catch(e) {
        container.textContent = 'Error: ' + e.message;
    }
}
