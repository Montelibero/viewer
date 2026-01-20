import { shorten, getHorizonURL, setPageTitle } from '../common.js';
import { renderOperationDetails, renderEffects, accountLink } from '../operation-view.js';

const horizonBase = getHorizonURL();

export async function init(params, i18n) {
    const { t } = i18n;
    const [opId] = params;

    setPageTitle('Operation ' + opId);

    // UI References
    const statusLabel = document.getElementById('status-label');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    const opIdEl = document.getElementById('op-id');
    const opTypeEl = document.getElementById('op-type');
    const opCreatedEl = document.getElementById('op-created');
    const opSourceEl = document.getElementById('op-source');
    const opTxEl = document.getElementById('op-tx');
    const opDetailsEl = document.getElementById('op-details');
    const opJsonEl = document.getElementById('op-json');
    const opHeaderBox = document.getElementById('op-header-box');

    let opData = null;
    let effectsData = null;

    function showLoading(on) {
        if (loader) {
            loader.textContent = t('loader-text');
            loader.classList.toggle('is-hidden', !on);
        }
    }

    function setStatus(state) {
        if (!statusLabel) return;
        statusLabel.classList.remove('is-danger', 'is-success', 'is-info');
        let key = 'status-loading';
        if (state === 'success') {
            statusLabel.classList.add('is-success');
            key = 'status-success';
        } else if (state === 'failed') {
            statusLabel.classList.add('is-danger');
            key = 'status-failed';
        } else if (state === 'error') {
            statusLabel.classList.add('is-danger');
            key = 'status-error';
        } else {
            statusLabel.classList.add('is-info');
        }
        statusLabel.textContent = t(key);
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

    function appendEffectsSection(container) {
        if (effectsData) {
            if (container) container.appendChild(renderEffects(effectsData, t));
        } else {
            const btn = document.createElement('a');
            btn.className = 'button is-small is-ghost mt-2 pl-0';
            btn.textContent = t('load-effects');
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                btn.classList.add('is-loading');
                try {
                    const res = await fetch(`${horizonBase}/operations/${opId}/effects`);
                    if (!res.ok) throw new Error(`Effects load error ${res.status}`);
                    const json = await res.json();
                    effectsData = json._embedded ? json._embedded.records : [];
                    // Re-render details to show effects
                    if (opDetailsEl) {
                        opDetailsEl.innerHTML = '';
                        opDetailsEl.appendChild(renderOperationDetails(opData, t));
                        appendEffectsSection(opDetailsEl);
                    }
                } catch (err) {
                    console.error(err);
                    if (btn) {
                        btn.classList.remove('is-loading');
                        btn.textContent = t('error-unknown');
                    }
                }
            });
            if (container) container.appendChild(btn);
        }
    }

    async function loadOp() {
        if (!opId) {
            showError('error-no-op-id');
            return;
        }

        if (opIdEl) opIdEl.textContent = opId;
        clearError();
        setStatus('loading');
        showLoading(true);

        try {
            const res = await fetch(`${horizonBase}/operations/${opId}`);
            if (!res.ok) {
                throw new Error(`Horizon error ${res.status}`);
            }
            const op = await res.json();
            opData = op;

            if (opTypeEl) opTypeEl.textContent = op.type || '—';
            if (opCreatedEl) opCreatedEl.textContent = op.created_at || '';

            if (opSourceEl) {
                const srcLink = accountLink(op.source_account);
                opSourceEl.innerHTML = srcLink ? `<a class="is-mono" href="${srcLink}">${shorten(op.source_account)}</a>` : (op.source_account || '—');
            }

            if (opTxEl) {
                const txLink = op.transaction_hash ? `/transaction/${op.transaction_hash}` : null;
                opTxEl.innerHTML = txLink ? `<a class="is-mono" href="${txLink}">${shorten(op.transaction_hash)}</a>` : '—';
            }
            
            if (opDetailsEl) {
                opDetailsEl.innerHTML = '';
                opDetailsEl.appendChild(renderOperationDetails(op, t));
                appendEffectsSection(opDetailsEl);
            }
            if (opJsonEl) opJsonEl.textContent = JSON.stringify(op, null, 2);

            if (opHeaderBox) {
                if (op.transaction_successful) {
                    setStatus('success');
                    opHeaderBox.classList.remove('is-failed');
                } else {
                    setStatus('failed');
                    opHeaderBox.classList.add('is-failed');
                }
            }
        } catch (e) {
            console.error(e);
            showError('error-load-op', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    }

    // Initial load
    loadOp();
}