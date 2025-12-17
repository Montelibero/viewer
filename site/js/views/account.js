import { shorten, isLocalLike } from '/js/common.js?v=7';

const horizonBase = 'https://horizon.stellar.org';
const poolMetaCache = new Map();

function formatAssetLabel(asset) {
    if (!asset || asset === 'native') {
        return { text: 'XLM', code: 'XLM', href: null };
    }
    const [code, issuer] = asset.split(':');
    const text = `${code || '—'} · ${issuer ? shorten(issuer) : '—'}`;
    const href = code && issuer
        ? `/asset/${encodeURIComponent(`${code}-${issuer}`)}`
        : null;
    return { text, code: code || '—', href };
}

function accountLink(acc) {
    return acc ? `/account/${encodeURIComponent(acc)}` : null;
}

function createBalanceCard({ title, subtitle = '', amount = '—', meta = '', href = null }) {
    const card = document.createElement('div');
    card.className = 'box is-size-7';

    const titleHtml = href
        ? `<a class="has-text-weight-semibold" href="${href}">${title}</a>`
        : `<span class="has-text-weight-semibold">${title}</span>`;

    const metaHtml = meta ? `<span class="balance-meta">${meta}</span>` : '';

    card.innerHTML = `
      <div class="level is-mobile">
        <div class="level-left">
          <div>
            <p>${titleHtml}</p>
            ${subtitle ? `<p class="is-size-7 has-text-grey">${subtitle}</p>` : ''}
          </div>
        </div>
        <div class="level-right">
          <div class="has-text-right is-mono balance-amount">
            <span class="has-text-weight-semibold">${amount}</span>
            ${metaHtml}
          </div>
        </div>
      </div>
    `;

    return card;
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [accountId] = params;

    // UI elements
    const statusLabel = document.getElementById('status-label');
    const accountIdDisplay = document.getElementById('account-id-display');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    
    // Set initial ID
    if (accountIdDisplay) accountIdDisplay.textContent = accountId;

    let issuedRecords = null;

    function setStatus(state) {
        if (!statusLabel) return;
        statusLabel.classList.remove('is-danger', 'is-success', 'is-info');
        let key = 'status-loading';
        if (state === 'ok') {
            statusLabel.classList.add('is-success');
            key = 'status-ok';
        } else if (state === 'error') {
            statusLabel.classList.add('is-danger');
            key = 'status-error';
        } else {
            statusLabel.classList.add('is-info');
        }
        statusLabel.textContent = t(key);
    }

    function showLoading(on) {
        if (loader) loader.classList.toggle('is-hidden', !on);
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

    async function describePool(poolId, linkEl, subtitleEl, shareBalance) {
        if (poolMetaCache.has(poolId)) {
            const cached = poolMetaCache.get(poolId);
            if (cached && cached.label) {
                linkEl.textContent = `${t('pool-label')}: ${cached.label}`;
                if (shareBalance && cached.reserves && cached.totalShares) {
                    updatePoolShareInfo(subtitleEl, poolId, cached.reserves, cached.totalShares, shareBalance);
                }
                return;
            }
        }

        try {
            const res = await fetch(`${horizonBase}/liquidity_pools/${poolId}`);
            if (!res.ok) throw new Error('load failed');
            const data = await res.json();

            const reserves = data?.reserves || [];
            const totalShares = data?.total_shares || '0';

            const labels = reserves.map(r => formatAssetLabel(r.asset).code).filter(Boolean);
            const label = labels.length ? labels.join(' / ') : shorten(poolId);

            poolMetaCache.set(poolId, { label, reserves, totalShares });

            linkEl.textContent = `${t('pool-label')}: ${label}`;

            if (subtitleEl) {
                subtitleEl.innerHTML = `${t('pool-id-label')}: ${shorten(poolId)}`;
                if (shareBalance) {
                    updatePoolShareInfo(subtitleEl, poolId, reserves, totalShares, shareBalance);
                }
            }
        } catch (e) {
            console.error(e);
            poolMetaCache.set(poolId, { label: null });
        }
    }

    function updatePoolShareInfo(subtitleEl, poolId, reserves, totalSharesStr, userSharesStr) {
        const totalShares = parseFloat(totalSharesStr);
        const userShares = parseFloat(userSharesStr);

        if (!isNaN(totalShares) && !isNaN(userShares) && totalShares > 0) {
            const ratio = userShares / totalShares;
            const parts = reserves.map(r => {
                const amount = parseFloat(r.amount);
                if (isNaN(amount)) return null;
                const myAmount = amount * ratio;
                const valStr = myAmount < 0.01 ? myAmount.toFixed(7) : myAmount.toFixed(2);
                const cleanVal = parseFloat(valStr).toString();
                const symbol = formatAssetLabel(r.asset).code;
                return `${cleanVal} ${symbol}`;
            }).filter(Boolean);

            if (parts.length) {
                const info = parts.join(' + ');
                subtitleEl.innerHTML += `<br><span class="has-text-grey-dark" style="font-size: 0.9em">~ ${info}</span>`;
            }
        }
    }

    function renderBalances(account) {
        const nativeEl = document.getElementById('balance-native');
        const assetsEl = document.getElementById('balance-assets');
        const poolsEl = document.getElementById('balance-pools');
        
        if (!nativeEl || !assetsEl || !poolsEl) return;

        nativeEl.innerHTML = '';
        assetsEl.innerHTML = '';
        poolsEl.innerHTML = '';

        const balances = account.balances || [];
        const native = balances.filter(b => b.asset_type === 'native');
        const assets = balances.filter(b => b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares');
        const pools = balances.filter(b => b.asset_type === 'liquidity_pool_shares');

        if (native.length) {
            const b = native[0];
            const metaParts = [];
            if (b.limit) metaParts.push(`${t('balance-limit')}: ${b.limit}`);
            const card = createBalanceCard({
                title: 'XLM',
                subtitle: t('balance-native-subtitle'),
                amount: b.balance,
                meta: metaParts.length ? metaParts.join(' · ') : ''
            });
            nativeEl.appendChild(card);
        } else {
            nativeEl.innerHTML = `<p class="is-size-7 has-text-grey">${t('balance-no-xlm')}</p>`;
        }

        if (assets.length) {
            assets.forEach(b => {
                const issuer = b.asset_issuer || '';
                const assetId = b.asset_code && issuer ? `${b.asset_code}-${issuer}` : null;
                const extras = [];
                if (b.limit) extras.push(`${t('balance-limit')}: ${b.limit}`);
                if (b.is_authorized === false) extras.push(t('balance-not-authorized'));
                if (b.is_authorized_to_maintain_liabilities === false) extras.push(t('balance-no-maintain'));
                if (b.is_clawback_enabled) extras.push(t('balance-clawback-enabled'));
                const meta = extras.length
                    ? `<span class="tag is-light is-size-7" title="${extras.join(' • ')}">★ ${t('balance-details')}</span>`
                    : '';

                const card = createBalanceCard({
                    title: b.asset_code || '—',
                    subtitle: issuer ? `${t('balance-issuer')}: ${shorten(issuer)}` : '',
                    amount: b.balance,
                    meta,
                    href: assetId ? `/asset/${encodeURIComponent(assetId)}` : null
                });
                assetsEl.appendChild(card);
            });
        } else {
            assetsEl.innerHTML = `<p class="is-size-7 has-text-grey">${t('assets-empty')}</p>`;
        }

        if (pools.length) {
            pools.forEach(b => {
                const poolId = b.liquidity_pool_id || '—';
                const card = createBalanceCard({
                    title: t('pool-card-title'),
                    subtitle: `${t('pool-id-label')}: ${shorten(poolId)}`,
                    amount: b.balance,
                    href: poolId !== '—' ? `/pool/${encodeURIComponent(poolId)}` : null
                });
                poolsEl.appendChild(card);

                if (poolId !== '—') {
                    const titleContainer = card.querySelector('.level-left > div > p:first-child');
                    const titleEl = titleContainer ? (titleContainer.firstElementChild || titleContainer) : null;
                    const subtitleEl = card.querySelector('.level-left > div > p.has-text-grey');

                    if (titleEl && subtitleEl) {
                        describePool(poolId, titleEl, subtitleEl, b.balance);
                    }
                }
            });
        } else {
            poolsEl.innerHTML = `<p class="is-size-7 has-text-grey">${t('pools-empty')}</p>`;
        }
    }

    function renderSignersSection(account) {
        const signersEl = document.getElementById('signers');
        if (!signersEl) return;
        signersEl.innerHTML = '';
        const signers = account?.signers || [];
        signers.forEach(s => {
            const li = document.createElement('li');
            li.className = 'mb-1';

            const link = accountLink(s.key);
            const keyLabel = shorten(s.key);

            li.innerHTML = `
                <span>${s.type}</span><br>
                ${link
                    ? `<a class="is-mono is-size-7" href="${link}" title="${s.key}">${keyLabel}</a>`
                    : `<code class="is-mono is-size-7">${s.key}</code>`}<br>
                <span>${t('weight-label')}: ${s.weight}</span>
            `;
            signersEl.appendChild(li);
        });
        if (!signers.length) {
            signersEl.textContent = t('signers-empty');
        }
    }

    function renderDataSection(account) {
        const dataEl = document.getElementById('data');
        if (!dataEl) return;
        dataEl.innerHTML = '';
        const dataAttr = account?.data_attr || account?.data || {};
        const entries = Object.entries(dataAttr);
        if (!entries.length) {
            dataEl.textContent = t('data-empty');
        } else {
            entries.forEach(([key, value]) => {
                const li = document.createElement('li');
                li.className = 'mb-1';

                const title = document.createElement('strong');
                title.textContent = key;
                li.appendChild(title);
                li.appendChild(document.createElement('br'));

                let decoded = '';
                try {
                    decoded = atob(value);
                } catch (e) {
                    decoded = t('data-decode-failed');
                }

                const isAccountId = /^G[A-Z2-7]{55}$/.test(decoded);
                let displayText = decoded;
                if (!isAccountId && decoded.length > 120) {
                    displayText = decoded.slice(0, 120) + '…';
                }

                if (isAccountId) {
                    const link = document.createElement('a');
                    link.href = `/account/${encodeURIComponent(decoded)}`;
                    link.textContent = decoded;
                    link.className = 'is-size-7 is-mono';
                    li.appendChild(link);
                } else {
                    const codeEl = document.createElement('code');
                    codeEl.className = 'is-mono is-size-7';
                    codeEl.textContent = displayText;
                    li.appendChild(codeEl);
                }

                dataEl.appendChild(li);
            });
        }
    }

    function renderIssuedAssets(records) {
        const issuedEl = document.getElementById('balance-issued');
        if (!issuedEl) return;
        issuedEl.innerHTML = '';

        if (!records.length) {
            issuedEl.textContent = t('issued-empty');
            return;
        }

        records.forEach(asset => {
            const id = asset.asset_code || '—';
            const subtitle = `${t('issued-holders')}: ${asset.num_accounts}`;
            const meta = t('issued-supply');

            const card = createBalanceCard({
                title: id,
                subtitle: subtitle,
                amount: asset.amount,
                meta: meta,
                href: `/asset/${encodeURIComponent(`${asset.asset_code}-${asset.asset_issuer}`)}`
            });
            issuedEl.appendChild(card);
        });
    }

    async function loadIssuedAssets(issuer) {
        const issuedEl = document.getElementById('balance-issued');
        if (!issuedEl) return;
        issuedEl.textContent = t('issued-loading');
        try {
            const res = await fetch(`${horizonBase}/assets?asset_issuer=${encodeURIComponent(issuer)}&limit=200`);
            if (!res.ok) {
                throw new Error(`Horizon error ${res.status}`);
            }
            const data = await res.json();
            const records = data?._embedded?.records || [];
            issuedRecords = records;
            renderIssuedAssets(records);
        } catch (e) {
            issuedRecords = null;
            issuedEl.textContent = t('issued-error');
            console.error(e);
        }
    }

    function renderAccount(account) {
        const seq = document.getElementById('seq');
        const sub = document.getElementById('subentries');
        const thEl = document.getElementById('thresholds');
        
        if(seq) seq.textContent = account.sequence;
        if(sub) sub.textContent = account.subentry_count;
        setStatus('ok');

        const th = account.thresholds || {};
        if(thEl) thEl.textContent = `low=${th.low_threshold}, med=${th.med_threshold}, high=${th.high_threshold}`;

        renderBalances(account);
        renderSignersSection(account);
        renderDataSection(account);

        const id = account.id;
        const btnBsn = document.getElementById('btn-bsn');
        const btnScopuly = document.getElementById('btn-scopuly');
        const btnStellarchain = document.getElementById('btn-stellarchain');
        const btnOperations = document.getElementById('btn-operations');
        const btnOffers = document.getElementById('btn-offers');

        if(btnBsn) btnBsn.href = `https://bsn.expert/accounts/${id}`;
        if(btnScopuly) btnScopuly.href = `https://scopuly.com/account/${id}`;
        if(btnStellarchain) btnStellarchain.href = `https://stellarchain.io/accounts/${id}`;
        if(btnOperations) btnOperations.href = `/account/${encodeURIComponent(id)}/operations`;
        if(btnOffers) btnOffers.href = `/account/${encodeURIComponent(id)}/offers`;

        loadIssuedAssets(account.id);
    }

    async function loadAccount(accId) {
        if (!accId) {
            showError('error-no-account-id');
            return;
        }

        clearError();
        setStatus('loading');
        showLoading(true);

        try {
            const res = await fetch(`${horizonBase}/accounts/${accId}`);
            if (!res.ok) {
                let detail = `Horizon error ${res.status}`;
                try {
                    const err = await res.json();
                    if (err?.detail) detail = err.detail;
                } catch (_) {
                }
                throw new Error(detail || t('error-unknown'));
            }
            const data = await res.json();
            renderAccount(data);
        } catch (e) {
            console.error(e);
            showError('error-load-account', { detail: e.message || t('error-unknown') });
        } finally {
            showLoading(false);
        }
    }

    // Event Listeners
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const text = accountIdDisplay ? accountIdDisplay.textContent : '';
            try {
                await navigator.clipboard.writeText(text);
                const old = copyBtn.textContent;
                copyBtn.textContent = t('copy-success');
                setTimeout(() => (copyBtn.textContent = old), 1500);
            } catch (e) {
                alert(t('copy-failed'));
            }
        });
    }

    // Start
    loadAccount(accountId);
}