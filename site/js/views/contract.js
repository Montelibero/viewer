import { shorten, strKeyToBytes, encodeAddress } from '/js/common.js?v=9';

const rpcUrl = 'https://soroban-rpc.mainnet.stellar.gateway.fm/';

function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [contractId] = params;
    
    const idEl = document.getElementById('contract-id');
    if (idEl) idEl.textContent = contractId;
    
    const container = document.getElementById('contract-details');
    const errorBox = document.getElementById('error-box');
    
    // Set external link
    const labUrlTemplate = `https://lab.stellar.org/smart-contracts/contract-explorer?$=network$id=mainnet&label=Mainnet&horizonUrl=https:////horizon.stellar.org&rpcUrl=https:////soroban-rpc.mainnet.stellar.gateway.fm&passphrase=Public%20Global%20Stellar%20Network%20/;%20September%202015;&smartContracts$explorer$contractId=`;
    const btnStellarLab = document.getElementById('btn-stellar-lab');
    if (btnStellarLab) {
        btnStellarLab.href = `${labUrlTemplate}${contractId}`;
    }

    function showError(msg) {
        if (errorBox) {
            errorBox.classList.remove('is-hidden');
            const txt = document.getElementById('error-text');
            if (txt) txt.textContent = msg;
        }
        if (container) container.innerHTML = '';
    }

    async function loadContract() {
        try {
            // 1. Decode Contract ID to Hash
            const contractHash = strKeyToBytes(contractId);
            if (!contractHash || contractHash.length !== 32) {
                throw new Error('Invalid Contract ID');
            }

            // 2. Construct LedgerKey for Contract Instance (Type 6 / CONTRACT_DATA)
            // Template:
            // Type: CONTRACT_DATA (6) -> [0, 0, 0, 6]
            // Contract: SCAddressType CONTRACT (1) -> [0, 0, 0, 1] + [32 bytes hash]
            // Key: SCValType LEDGER_KEY_CONTRACT_INSTANCE (20) -> [0, 0, 0, 20]
            // Durability: PERSISTENT (1) -> [0, 0, 0, 1]
            
            const keyBytes = new Uint8Array(4 + 4 + 32 + 4 + 4);
            const view = new DataView(keyBytes.buffer);
            
            view.setUint32(0, 6); // Type CONTRACT_DATA
            view.setUint32(4, 1); // SCAddress Type CONTRACT
            keyBytes.set(contractHash, 8); // Contract Hash
            view.setUint32(40, 20); // SCVal Type LEDGER_KEY_CONTRACT_INSTANCE
            view.setUint32(44, 1); // Durability PERSISTENT

            const keyXdr = bytesToBase64(keyBytes);

            // 3. Query RPC
            const rpcBody = {
                jsonrpc: "2.0",
                id: 1,
                method: "getLedgerEntries",
                params: {
                    keys: [keyXdr]
                }
            };

            const res = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rpcBody)
            });

            if (!res.ok) throw new Error(`RPC error: ${res.status}`);
            const json = await res.json();
            
            if (json.error) {
                throw new Error(`RPC error: ${json.error.message}`);
            }

            const entry = json.result?.entries?.[0];
            if (!entry) {
                throw new Error('Contract instance not found (or expired).');
            }

            // 4. Decode XDR
            const mod = await import('https://esm.sh/@stellar/stellar-xdr-json');
            const initFn = mod.default || mod.init;
            if (typeof initFn === 'function') await initFn();
            const decodeFn = mod.decode;

            // entry.xdr is LedgerEntryData (base64)
            // We want to decode it.
            const decoded = decodeFn('LedgerEntryData', entry.xdr); // or LedgerEntry
            
            let decodedObj;
            if (typeof decoded === 'string') {
                try {
                    decodedObj = JSON.parse(decoded);
                } catch (_) {
                    decodedObj = { raw: decoded };
                }
            } else {
                decodedObj = decoded;
            }

            // 5. Render
            renderContractData(decodedObj, entry.lastModifiedLedgerSeq);

        } catch (e) {
            console.error(e);
            showError(e.message || 'Unknown error');
        }
    }

    function renderContractData(data, ledgerSeq) {
        let html = `<div class="content"><p><strong>Last Modified Ledger:</strong> ${ledgerSeq}</p>`;

        const contractData = data?.contract_data;
        const contractInstance = contractData?.val?.contract_instance;
        const storage = contractInstance?.storage;

        if (contractInstance) {
            html += `<p><strong>Contract Type:</strong> ${contractInstance.executable}</p>`;
        }

        if (Array.isArray(storage)) {
            let metadata = {};
            let admin = '';
            let assetInfo = {};

            storage.forEach(entry => {
                // METADATA
                if (entry.key?.symbol === 'METADATA' && entry.val?.map) {
                    entry.val.map.forEach(item => {
                        if (item.key?.symbol && item.val) {
                            metadata[item.key.symbol] = item.val.string || item.val.u32;
                        }
                    });
                }
                // Admin
                if (entry.key?.vec?.[0]?.symbol === 'Admin' && entry.val?.address) {
                    admin = entry.val.address;
                }
                // AssetInfo (for SAC)
                if (entry.key?.vec?.[0]?.symbol === 'AssetInfo' && entry.val?.vec?.[1]?.map) {
                    entry.val.vec[1].map.forEach(item => {
                        if (item.key?.symbol && item.val) {
                            let val = item.val.string || item.val.bytes;
                            if (item.key.symbol === 'issuer' && item.val.bytes) {
                                const encoded = encodeAddress(item.val.bytes);
                                if (encoded) val = encoded;
                            }
                            assetInfo[item.key.symbol] = val;
                        }
                    });
                }
            });

            if (metadata.name) html += `<p><strong>Name:</strong> ${metadata.name}</p>`;
            if (metadata.symbol) html += `<p><strong>Symbol:</strong> ${metadata.symbol}</p>`;
            if (metadata.decimal !== undefined) html += `<p><strong>Decimals:</strong> ${metadata.decimal}</p>`;
            if (admin) html += `<p><strong>Admin:</strong> <a href="/account/${admin}">${shorten(admin)}</a></p>`;
            if (assetInfo.asset_code && assetInfo.issuer) {
                html += `<p><strong>Wrapped Asset:</strong> <a href="/asset/${encodeURIComponent(`${assetInfo.asset_code}-${assetInfo.issuer}`)}">${assetInfo.asset_code}</a> by <a href="/account/${assetInfo.issuer}">${shorten(assetInfo.issuer)}</a></p>`;
            }
        }

        html += `<h4 class="title is-6 mt-5">Raw XDR JSON:</h4>`;
        html += `<pre class="is-size-7">${JSON.stringify(data, null, 2)}</pre></div>`;
        
        container.innerHTML = html;
    }

    loadContract();
}