import { shorten } from '/js/common.js?v=7';

export async function init(params, i18n) {
    const { t } = i18n;
    const [contractId] = params;
    
    const idEl = document.getElementById('contract-id');
    if (idEl) idEl.textContent = contractId;
    
    const container = document.getElementById('contract-details');
    const errorBox = document.getElementById('error-box');
    
    function showError(msg) {
        if (errorBox) {
            errorBox.classList.remove('is-hidden');
            const txt = document.getElementById('error-text');
            if (txt) txt.textContent = msg;
        }
        if (container) container.innerHTML = '';
    }

    const labUrlTemplate = `https://lab.stellar.org/smart-contracts/contract-explorer?$=network$id=mainnet&label=Mainnet&horizonUrl=https:////horizon.stellar.org&rpcUrl=https:////soroban-rpc.mainnet.stellar.gateway.fm&passphrase=Public%20Global%20Stellar%20Network%20/;%20September%202015;&smartContracts$explorer$contractId=`;
    const btnStellarLab = document.getElementById('btn-stellar-lab');
    if (btnStellarLab) {
        btnStellarLab.href = `${labUrlTemplate}${contractId}`;
    }

    try {
        const res = await fetch(`https://api.stellar.expert/explorer/public/contract/${contractId}`);
        if (!res.ok) throw new Error(`Stellar Expert API error: ${res.status}`);
        const data = await res.json();

        let html = '<table class="table is-fullwidth is-striped is-size-7">';
        html += '<tbody>';
        
        const addRow = (label, val) => {
            html += `<tr><td><strong>${label}</strong></td><td class="is-mono" style="word-break: break-all;">${val}</td></tr>`;
        };

        if (data.created) addRow('Created', new Date(data.created * 1000).toLocaleString());
        if (data.creator) addRow('Creator', `<a href="/account/${data.creator}">${shorten(data.creator)}</a>`);
        if (data.asset) {
             const parts = data.asset.split('-');
             if (parts.length >= 2) {
                 const code = parts[0];
                 const issuer = parts[1];
                 addRow('Wrapped Asset', `<a href="/asset/${encodeURIComponent(`${code}-${issuer}`)}">${code}</a>`);
             } else {
                 addRow('Wrapped Asset', data.asset);
             }
        }
        if (data.storage_entries !== undefined) addRow('Storage Entries', data.storage_entries);
        if (data.payments !== undefined) addRow('Payments', data.payments);
        if (data.trades !== undefined) addRow('Trades', data.trades);
        
        if (data.functions && Array.isArray(data.functions)) {
             const funcs = data.functions.map(f => `${f.function} (${f.invocations})`).join(', ');
             addRow('Functions', funcs);
        }

        html += '</tbody></table>';
        
        html += `<div class="buttons mt-4">
            <a class="button is-small is-link is-light" href="https://stellar.expert/explorer/public/contract/${contractId}" target="_blank">View on Stellar.Expert</a>
        </div>`;

        if (container) container.innerHTML = html;

    } catch (e) {
        console.error(e);
        showError(e.message || 'Unknown error');
    }
}
