import { shorten, getHorizonURL, setPageTitle } from '../common.js';
import { renderOperationComponent, accountLink, formatStroopAmount, cleanXdrJson } from '../operation-view.js';

const horizonBase = getHorizonURL();
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Lookup = {};
for(let i=0; i<base32Alphabet.length; i++) {
  base32Lookup[base32Alphabet[i]] = i;
}

function decodeBase32(input) {
  input = input.replace(/=+$/, '');
  let length = input.length;
  let leftover = (length * 5) % 8;

  let bits = 0;
  let value = 0;
  let output = new Uint8Array(Math.floor(length * 5 / 8));
  let index = 0;

  for (let i = 0; i < length; i++) {
    value = (value << 5) | base32Lookup[input[i]];
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xFF;
      bits -= 8;
    }
  }
  return output;
}

function getHintFromAddress(address) {
   try {
     const bytes = decodeBase32(address);
     if (bytes.length < 33) return null;
     const hintBytes = bytes.slice(29, 33);
     return Array.from(hintBytes).map(b => b.toString(16).padStart(2, '0')).join('');
   } catch (e) {
     console.error('Error decoding address hint', address, e);
     return null;
   }
}

function hexToBytes(hex) {
  if (!hex) return new Uint8Array(0);
  if (/^[0-9a-fA-F]+$/.test(hex)) {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      return bytes;
  }
  try {
      const binString = atob(hex);
      return Uint8Array.from(binString, c => c.charCodeAt(0));
  } catch (e) {
      return new Uint8Array(0);
  }
}

function encodeBase32(data) {
  let output = '';
  let val = 0;
  let bits = 0;
  for (let i = 0; i < data.length; i++) {
      val = (val << 8) | data[i];
      bits += 8;
      while (bits >= 5) {
          output += base32Alphabet[(val >>> (bits - 5)) & 31];
          bits -= 5;
      }
  }
  if (bits > 0) {
      output += base32Alphabet[(val << (5 - bits)) & 31];
  }
  return output;
}

function getMaskedHint(hexHint) {
    try {
        const hintBytes = hexToBytes(hexHint);
        if (hintBytes.length !== 4) return hexHint;

        const bytes = new Uint8Array(35);
        bytes[0] = 48; // Version byte (logical for G)
        bytes.set(hintBytes, 29); // Set last 4 bytes of key

        const fullStr = encodeBase32(bytes);
        return 'G' + '-'.repeat(46) + fullStr.slice(47, 52) + '-'.repeat(4);
    } catch (e) {
        console.error(e);
        return hexHint;
    }
}

function describeMemo(memo, t) {
    if (!memo) return t('memo-none');
    const keys = Object.keys(memo);
    if (!keys.length) return t('memo-none');
    const tkey = keys[0];
    const v = memo[tkey];
    if (tkey === 'text') return t('memo-text').replace('{text}', v);
    if (tkey === 'id') return t('memo-id').replace('{id}', v);
    if (tkey === 'hash') return t('memo-hash').replace('{hash}', v);
    if (tkey === 'ret_hash' || tkey === 'return') return t('memo-return').replace('{hash}', v);
    return `${tkey}: ${JSON.stringify(v)}`;
}

function describeTimeBounds(cond, t) {
    if (!cond || !cond.time) return t('time-bounds-none');
    const { min_time, max_time } = cond.time;
    if ((!min_time || min_time === '0') && (!max_time || max_time === '0')) {
      return t('time-bounds-none');
    }
    return `${t('time-bounds-min')}: ${min_time || '0'}, ${t('time-bounds-max')}: ${max_time || '0'}`;
}

function extractTxObject(decoded) {
  if (decoded.tx && decoded.tx.tx) return decoded.tx.tx;
  if (decoded.v1 && decoded.v1.tx) return decoded.v1.tx;
  if (decoded.tx) return decoded.tx;
  return decoded;
}

function humanizeCode(code) {
  return String(code || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toUpperCase();
}

function resultKey(code) {
  return `result-${String(code).toLowerCase().replace(/_/g, '-')}`;
}

function displayResultCode(code) {
  return String(code || '').toLowerCase();
}

function resultDescription(code, t) {
  const key = resultKey(code);
  const translated = t(key);
  return translated === key ? '' : translated;
}

function formatResultCode(code, t) {
  const normalized = humanizeCode(code);
  const description = resultDescription(normalized, t);
  const displayCode = displayResultCode(normalized);
  return description ? `${displayCode} — ${description}` : displayCode;
}

function opTypeKey(opType) {
  return String(opType || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function candidateOpKeys(opType) {
  const key = opTypeKey(opType);
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return [key, camel, `${camel}Result`, `${key}_result`];
}

function meaningfulKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.keys(obj).filter(k => !['ext', '_attributes'].includes(k));
}

function extractInnerResultCode(inner, opType) {
  if (inner === null || inner === undefined) return null;
  if (typeof inner === 'string' || typeof inner === 'number') {
    const code = humanizeCode(inner);
    return code === 'SUCCESS' ? 'SUCCESS' : `${humanizeCode(opType)}_${code}`;
  }

  if (typeof inner !== 'object') return null;

  const keys = meaningfulKeys(inner);
  const failureKey = keys.find(k => !['success', 'offer', 'offers_claimed'].includes(k));
  const key = failureKey || keys[0];
  if (!key) return null;

  const code = humanizeCode(key);
  return code === 'SUCCESS' ? 'SUCCESS' : `${humanizeCode(opType)}_${code}`;
}

function extractOperationResultCode(opResult, opType) {
  if (!opResult) return null;
  if (typeof opResult === 'string' || typeof opResult === 'number') return humanizeCode(opResult);

  const outer = opResult.op_inner || opResult.tr || opResult;
  if (!outer || typeof outer !== 'object') return null;

  if (outer.code && outer.code !== 'op_inner') return humanizeCode(outer.code);
  if (outer.op_inner || outer.tr) return extractOperationResultCode(outer.op_inner || outer.tr, opType);

  for (const key of candidateOpKeys(opType)) {
    if (Object.prototype.hasOwnProperty.call(outer, key)) {
      return extractInnerResultCode(outer[key], opType);
    }
  }

  const keys = meaningfulKeys(outer);
  const failureKey = keys.find(k => k.startsWith('op_') && k !== 'op_inner');
  if (failureKey) return humanizeCode(failureKey);

  const opKey = keys.find(k => candidateOpKeys(opType).includes(k)) || keys[0];
  if (!opKey) return null;
  return extractInnerResultCode(outer[opKey], opKey);
}

function extractResultDetails(decodedResult, tx, txObj, horizonOps) {
  const result = decodedResult?.result;
  const detail = {
    txCode: null,
    opResults: []
  };

  if (!result || typeof result !== 'object') return detail;

  if (Array.isArray(result.tx_failed)) {
    detail.txCode = 'TX_FAILED';
    detail.opResults = result.tx_failed;
  } else if (Array.isArray(result.tx_success)) {
    detail.txCode = 'TX_SUCCESS';
    detail.opResults = result.tx_success;
  } else if (Array.isArray(result.results)) {
    detail.txCode = tx?.successful === false ? 'TX_FAILED' : null;
    detail.opResults = result.results;
  } else {
    const keys = meaningfulKeys(result);
    const txKey = keys.find(k => k.startsWith('tx_')) || keys[0];
    if (txKey) {
      detail.txCode = humanizeCode(txKey);
      if (Array.isArray(result[txKey])) detail.opResults = result[txKey];
    }
  }

  detail.opFailures = detail.opResults
    .map((opResult, index) => {
      const op = txObj?.operations?.[index] || {};
      const opType = horizonOps?.[index]?.type || op.type || op.type_i || `operation_${index + 1}`;
      const code = extractOperationResultCode(opResult, opType);
      if (!code || code === 'SUCCESS') return null;
      return {
        index,
        opType: opTypeKey(opType),
        code
      };
    })
    .filter(Boolean);

  return detail;
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [txHash] = params;

    setPageTitle('Transaction ' + shorten(txHash));

    // UI References
    const statusEl = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const txHashEl = document.getElementById('tx-hash');
    const ledgerEl = document.getElementById('ledger');
    const createdAtEl = document.getElementById('created-at');
    const sourceAccountEl = document.getElementById('source-account');
    const opCountEl = document.getElementById('op-count');
    const feeChargedEl = document.getElementById('fee-charged');
    const seqEl = document.getElementById('seq-num');
    const memoEl = document.getElementById('memo');
    const timeBoundsEl = document.getElementById('time-bounds');
    const baseFeeEl = document.getElementById('base-fee');
    const operationsList = document.getElementById('operations-list');
    const signaturesBox = document.getElementById('signatures-box');
    const signaturesList = document.getElementById('signatures-list');
    const jsonBodyEl = document.getElementById('json-body');
    const xdrRawEl = document.getElementById('xdr-raw');
    const headerBox = document.getElementById('tx-header-box');
    const resultSummaryBox = document.getElementById('result-summary-box');
    const resultSummaryText = document.getElementById('result-summary-text');
    const resultSummaryList = document.getElementById('result-summary-list');

    let horizonOps = null;

    if (txHashEl) txHashEl.textContent = txHash;

    function setStatus(state) {
        if (!statusEl) return;
        statusEl.classList.remove('is-danger', 'is-success', 'is-info');
        let key = 'status-loading';
        if (state === 'success') {
            statusEl.classList.add('is-success');
            key = 'status-success';
        } else if (state === 'failed') {
            statusEl.classList.add('is-danger');
            key = 'status-failed';
        } else if (state === 'error') {
            statusEl.classList.add('is-danger');
            key = 'status-error';
        } else {
            statusEl.classList.add('is-info');
        }
        statusEl.textContent = t(key);
    }

    function showLoading(on) {
        if (loader) {
            loader.textContent = t('loader-text');
            loader.classList.toggle('is-hidden', !on);
        }
    }

    function showError(messageKey, { detail = '' } = {}) {
        if (!errorBox || !errorText) return;
        const base = messageKey ? t(messageKey) : '';
        const msg = detail ? `${base ? base + ': ' : ''}${detail}` : base;
        errorText.textContent = msg || detail || '';
        errorBox.classList.remove('is-hidden');
        setStatus('error');
    }

    function clearError() {
        if (errorBox) errorBox.classList.add('is-hidden');
    }

    function renderResultSummary(tx, decodedResult, txObj) {
        if (!resultSummaryBox || !resultSummaryText || !resultSummaryList) return;

        resultSummaryList.innerHTML = '';
        if (tx.successful) {
            resultSummaryBox.classList.add('is-hidden');
            return;
        }

        const details = extractResultDetails(decodedResult, tx, txObj, horizonOps);
        const txCode = details.txCode || 'TX_FAILED';
        resultSummaryText.textContent = `${t('result-summary-prefix')}: ${formatResultCode(txCode, t)}`;

        if (details.opFailures?.length) {
            details.opFailures.forEach(({ index, opType, code }) => {
                const li = document.createElement('li');
                li.textContent = `${t('result-operation-label')} ${index + 1}: ${formatResultCode(code, t)}`;
                li.title = opType;
                resultSummaryList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = t('result-no-op-details');
            resultSummaryList.appendChild(li);
        }

        resultSummaryBox.classList.remove('is-hidden');
    }

    function setExternalLinks(hash) {
        const bsnBtn = document.getElementById('btn-bsn');
        const scopulyBtn = document.getElementById('btn-scopuly');
        const expertBtn = document.getElementById('btn-expert');
        if (hash) {
            if (bsnBtn) {
                bsnBtn.href = `https://bsn.expert/transactions/${hash}/`;
                bsnBtn.classList.remove('is-static');
            }
            if (scopulyBtn) {
                scopulyBtn.href = `https://scopuly.com/transaction/${hash}`;
                scopulyBtn.classList.remove('is-static');
            }
            if (expertBtn) {
                expertBtn.href = `https://stellar.expert/explorer/public/tx/${hash}`;
                expertBtn.classList.remove('is-static');
            }
        } else {
            if (bsnBtn) {
                bsnBtn.href = '#';
                bsnBtn.classList.add('is-static');
            }
            if (scopulyBtn) {
                scopulyBtn.href = '#';
                scopulyBtn.classList.add('is-static');
            }
            if (expertBtn) {
                expertBtn.href = '#';
                expertBtn.classList.add('is-static');
            }
        }
    }

    function renderOperations(tx) {
        if (!operationsList) return;
        operationsList.innerHTML = '';

        const ops = Array.isArray(tx.operations) ? tx.operations : [];
        if (!ops.length) {
            operationsList.textContent = t('operations-empty');
            return;
        }

        ops.forEach((op, index) => {
            let opId = null;
            if (horizonOps && horizonOps[index]) {
                opId = horizonOps[index].id;
            }

            // Horizon ops usually have IDs, but XDR decoded ops don't.
            // We pass opId via the op object itself if possible, or reliance on index match.
            // But renderOperationComponent expects op.id for effects loading.
            if (opId) op.id = opId;

            if (tx.operationResults && tx.operationResults[index]) {
                op.result = tx.operationResults[index];
            }

            const box = renderOperationComponent(op, t, {
                index,
                forceSuccessStatus: tx.successful,
                contextSource: tx.source_account,
                showTransactionLink: false, // redundant on tx page
                allowLoadEffects: true
            });
            operationsList.appendChild(box);
        });
    }

    async function loadSignatures(txData, decodedEnvelope, decodedTxBody) {
        if (!signaturesBox || !signaturesList) return;
        signaturesBox.classList.remove('is-hidden');
        signaturesList.innerHTML = `<span class="loader"></span> ${t('signatures-loading')}`;

        try {
            let sigs = [];
            if (decodedEnvelope.signatures) sigs = decodedEnvelope.signatures;
            else if (decodedEnvelope.v1 && decodedEnvelope.v1.signatures) sigs = decodedEnvelope.v1.signatures;
            else if (decodedEnvelope.tx && decodedEnvelope.tx.signatures) sigs = decodedEnvelope.tx.signatures;
            else if (decodedEnvelope.feeBump && decodedEnvelope.feeBump.signatures) sigs = decodedEnvelope.feeBump.signatures;

            if (!sigs || !sigs.length) {
                signaturesList.textContent = '—';
                return;
            }

            const accountsToCheck = new Set();
            if (txData.source_account) accountsToCheck.add(txData.source_account);
            if (txData.fee_account) accountsToCheck.add(txData.fee_account);

            if (decodedTxBody && decodedTxBody.operations) {
                decodedTxBody.operations.forEach(op => {
                    const acc = op.sourceAccount || op.source_account;
                    if (typeof acc === 'string') accountsToCheck.add(acc);
                    else if (acc && acc.ed25519) accountsToCheck.add(acc.ed25519);
                });
            }

            const signerMap = {};
            const accounts = Array.from(accountsToCheck);

            await Promise.all(accounts.map(async (accId) => {
                try {
                    const res = await fetch(`${horizonBase}/accounts/${accId}`);
                    if (res.ok) {
                        const accData = await res.json();
                        if (accData.signers) {
                            accData.signers.forEach(signer => {
                                let hint = null;
                                if (signer.key.startsWith('G')) {
                                    hint = getHintFromAddress(signer.key);
                                } else if (signer.type === 'sha256_hash' || signer.type === 'preauth_tx') {
                                    hint = getHintFromAddress(signer.key);
                                }

                                if (hint) {
                                    signerMap[hint] = {
                                        address: signer.key,
                                        weight: signer.weight,
                                        type: signer.type
                                    };
                                }
                            });
                        }
                    }
                } catch (e) {
                    console.warn('Failed to fetch account', accId, e);
                }
            }));

            renderSignatures(sigs, signerMap);

        } catch (e) {
            console.error('Error loading signatures', e);
            signaturesList.textContent = t('error-unknown');
        }
    }

    function renderSignatures(sigs, signerMap) {
        if (!signaturesList) return;
        signaturesList.innerHTML = '';

        if (!sigs.length) {
            signaturesList.textContent = '—';
            return;
        }

        const ul = document.createElement('ul');

        sigs.forEach(sig => {
            const hint = sig.hint;
            const info = signerMap[hint];

            const li = document.createElement('li');
            li.className = 'mb-1 is-flex is-align-items-center is-flex-wrap-wrap';

            if (info) {
                const a = document.createElement('a');
                a.href = accountLink(info.address);
                a.className = 'is-mono mr-2';
                a.style.wordBreak = 'break-all';
                a.textContent = info.address;
                li.appendChild(a);
            } else {
                const hintSpan = document.createElement('span');
                hintSpan.className = 'is-mono mr-2 has-text-grey';
                hintSpan.style.wordBreak = 'break-all';
                hintSpan.textContent = getMaskedHint(hint);
                hintSpan.title = `Hex Hint: ${hint}`;
                li.appendChild(hintSpan);
            }

            ul.appendChild(li);
        });

        signaturesList.appendChild(ul);
    }

    async function loadTx() {
        if (!txHash) {
            showError('error-no-hash');
            return;
        }

        setExternalLinks(txHash);
        clearError();
        setStatus('loading');
        showLoading(true);

        try {
            const res = await fetch(`${horizonBase}/transactions/${encodeURIComponent(txHash)}`);
            if (!res.ok) {
                let detail = `Horizon error ${res.status}`;
                try {
                    const err = await res.json();
                    if (err?.detail) detail = err.detail;
                } catch (_) {}
                throw new Error(detail);
            }
            const tx = await res.json();

            // Fetch operations for IDs
            try {
                const opsRes = await fetch(`${horizonBase}/transactions/${encodeURIComponent(txHash)}/operations?limit=200`);
                if (opsRes.ok) {
                    const opsJson = await opsRes.json();
                    horizonOps = opsJson._embedded ? opsJson._embedded.records : [];
                }
            } catch (err) {
                console.warn('Failed to load horizon operations', err);
            }

            const successful = tx.successful;
            setStatus(successful ? 'success' : 'failed');
            if (headerBox) {
                if (successful) headerBox.classList.remove('is-failed');
                else headerBox.classList.add('is-failed');
            }

            if(ledgerEl) ledgerEl.textContent = tx.ledger ?? '—';
            if(createdAtEl) createdAtEl.textContent = tx.created_at ?? '—';
            if(sourceAccountEl) {
                const srcLink = accountLink(tx.source_account);
                sourceAccountEl.innerHTML = srcLink
                    ? `<a class="is-mono" href="${srcLink}">${tx.source_account}</a>`
                    : (tx.source_account ?? '—');
            }
            if(opCountEl) opCountEl.textContent = tx.operation_count ?? '—';
            if(feeChargedEl) feeChargedEl.textContent = `${formatStroopAmount(tx.fee_charged)} XLM`;

            const envelopeXdr = tx.envelope_xdr;
            if (!envelopeXdr) throw new Error(t('error-no-envelope'));

            if(xdrRawEl) xdrRawEl.textContent = envelopeXdr;

            const mod = await import('https://esm.sh/@stellar/stellar-xdr-json');
            const initFn = mod.default || mod.init;
            if (typeof initFn === 'function') await initFn();
            const decodeFn = mod.decode;
            if (typeof decodeFn !== 'function') throw new Error(t('error-decode'));

            const decoded = decodeFn('TransactionEnvelope', envelopeXdr.trim());
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

            if(jsonBodyEl) jsonBodyEl.textContent = JSON.stringify(cleanXdrJson(decodedObj), null, 2);

            const txObj = extractTxObject(decodedObj);
            
            if(seqEl) seqEl.textContent = txObj.seq_num ?? '—';
            if(memoEl) memoEl.textContent = describeMemo(txObj.memo, t);
            if(timeBoundsEl) timeBoundsEl.textContent = describeTimeBounds(txObj.cond, t);
            if(baseFeeEl) baseFeeEl.textContent = `${txObj.fee ?? '—'} ${t('base-fee-suffix')}`;

            // Decode Result XDR if available
            let decodedResult = null;
            if (tx.result_xdr) {
                try {
                    let decodedRes = decodeFn('TransactionResult', tx.result_xdr.trim());
                    if (typeof decodedRes === 'string') {
                        decodedRes = JSON.parse(decodedRes);
                    }
                    decodedResult = decodedRes;

                    // Extract operation results
                    // Structure depends on stellar-xdr-json (tx_success/tx_failed)
                    let opResults = null;
                    if (decodedRes && decodedRes.result) {
                         if (Array.isArray(decodedRes.result.tx_success)) {
                             opResults = decodedRes.result.tx_success;
                         } else if (Array.isArray(decodedRes.result.tx_failed)) {
                             opResults = decodedRes.result.tx_failed;
                         } else if (Array.isArray(decodedRes.result.results)) {
                             opResults = decodedRes.result.results;
                         }
                    }

                    if (opResults) {
                        txObj.operationResults = opResults;
                    }
                } catch (err) {
                    console.warn('Failed to decode result XDR', err);
                }
            }

            renderResultSummary(tx, decodedResult, txObj);

            // Inject successful status into txObj for rendering (createXdrOperationBox uses it)
            txObj.successful = successful;
            txObj.source_account = tx.source_account; // ensure source account is available

            renderOperations(txObj);
            loadSignatures(tx, decodedObj, txObj);

        } catch (e) {
            console.error(e);
            showError('error-load-tx', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    }

    const copyBtn = document.getElementById('copy-hash-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(txHash);
                const old = copyBtn.textContent;
                copyBtn.textContent = t('copy-success');
                setTimeout(() => (copyBtn.textContent = old), 1500);
            } catch (e) {
                alert(t('copy-failed'));
            }
        });
    }

    loadTx();
}
