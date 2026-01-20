import { shorten, isLocalLike, getHorizonURL, decodeTextValue, setPageTitle } from '../common.js';

const horizonBase = getHorizonURL();
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

function createPopover(triggerHtml, contentHtml) {
    const wrapper = document.createElement('div');
    wrapper.className = 'popover-wrapper';

    // Stop propagation on click to prevent immediate closing
    wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle this popover
        const wasActive = wrapper.classList.contains('is-active');
        // Close all others
        document.querySelectorAll('.popover-wrapper.is-active').forEach(el => {
            if (el !== wrapper) el.classList.remove('is-active');
        });
        wrapper.classList.toggle('is-active', !wasActive);
    });

    wrapper.innerHTML = `
        ${triggerHtml}
        <div class="popover-content cursor-default" onclick="event.stopPropagation()">
            ${contentHtml}
        </div>
    `;
    return wrapper;
}

function createBalanceCard({ title, subtitle = '', amount = '—', meta = null, href = null }) {
    const card = document.createElement('div');
    card.className = 'box is-size-7';

    const titleHtml = href
        ? `<a class="has-text-weight-semibold" href="${href}">${title}</a>`
        : `<span class="has-text-weight-semibold">${title}</span>`;

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
            <div class="balance-amount-main">
              <span class="has-text-weight-semibold">${amount}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    if (meta) {
        const metaContainer = card.querySelector('.balance-amount-main');
        if (metaContainer) {
            // meta can be an HTMLElement (popover) or string
            if (typeof meta === 'string') {
                 const span = document.createElement('span');
                 span.className = 'balance-meta';
                 span.innerHTML = meta;
                 metaContainer.appendChild(span);
            } else if (meta instanceof HTMLElement) {
                 const span = document.createElement('span');
                 span.className = 'balance-meta';
                 span.appendChild(meta);
                 metaContainer.appendChild(span);
            }
        }
    }

    return card;
}

export async function init(params, i18n) {
    const { t } = i18n;
    const [accountId] = params;

    setPageTitle('Account ' + shorten(accountId));

    // Global click handler to close popovers
    function closePopovers() {
        document.querySelectorAll('.popover-wrapper.is-active').forEach(el => el.classList.remove('is-active'));
    }
    document.addEventListener('click', closePopovers);

    const statusLabel = document.getElementById('status-label');
    const accountIdDisplay = document.getElementById('account-id-display');
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-text');
    const loader = document.getElementById('loader');
    
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

            // Calculate detailed stats
            const subentryCount = account.subentry_count || 0;
            const numSponsoring = account.num_sponsoring || 0;
            const numSponsored = account.num_sponsored || 0;

            // Deduce counts
            // Trustlines = Balances count - 1 (native)
            const trustlinesCount = Math.max(0, balances.length - 1);
            // Signers = Signers array length - 1 (master key) ? Actually subentry includes additional signers.
            const signers = account.signers || [];
            // Additional signers = signers.length - 1? Or signers.length if master is removed?
            // Usually master key is always present unless removed, but let's assume num signers > 0.
            // Let's rely on standard logic: Signers count in list.
            const signersCount = signers.length;
            const dataCount = Object.keys(account.data || {}).length;

            // Offers = subentryCount - trustlines - data - (signers - master?)
            // Note: Reserve covers: account entry (master key), trustlines, offers, data, additional signers.
            // subentry_count = trustlines + offers + data + (signers - ??)
            // Usually "Signers" in breakdown means total signers.
            // But for subentry calc: each additional signer costs reserve.
            // Let's assume standard account with master key. additional = signers.length - 1.
            // But safe to calculate Offers = subentryCount - trustlines - data - (signers.length - 1)
            // What if master key weight is 0? Still counts as entry? Yes.
            // What if account has 0 signers? Impossible.
            const offersCount = Math.max(0, subentryCount - trustlinesCount - dataCount - Math.max(0, signersCount - 1));

            // Reserve/Locked calc
            // Min Balance = (2 + subentryCount + numSponsoring - numSponsored?)
            // Official: (2 + subentry_count + num_sponsoring) * 0.5. Sponsored entries don't count towards subentry_count of the sponsored account?
            // Actually, if I am sponsored, my subentry_count includes it, but I don't pay for it?
            // "Sponsored entries (trustlines, offers, data) are included in subentry_count" - Yes.
            // "But the sponsor pays the reserve."
            // So my required reserve = (2 + subentry_count - num_sponsored + num_sponsoring) * 0.5 ??
            // No, Stellar docs say: "The minimum balance is calculated as: (2 + subentry_count + num_sponsoring - num_sponsored) * 0.5 XLM".
            // Wait, let's verify.
            // User example: "Sponsoring: 14". "Sponsored: 0".
            // Reserve = (2 + 87 + 14 - 0) * 0.5 = 103 * 0.5 = 51.5 XLM.
            // Selling Liabilities: 0 (from my check on account).
            // Total Locked = 51.5.
            // Balance: 765.9650307.
            // Available: 765.965 - 51.5 = 714.465.

            // Let's implement the formula: (2 + subentry + sponsoring - sponsored) * 0.5
            const reserve = (2 + subentryCount + numSponsoring - numSponsored) * 0.5;
            const sellingLiabilities = parseFloat(b.selling_liabilities || '0');
            // Buying liabilities do NOT lock XLM (unless buying XLM? No).
            const locked = reserve + sellingLiabilities;
            const balance = parseFloat(b.balance);
            const available = Math.max(0, balance - locked);

            const detailsRows = [
                { label: t('label-offers', 'Offers'), value: offersCount },
                { label: t('label-trustlines', 'Trustlines'), value: trustlinesCount },
                { label: t('label-signers', 'Signers'), value: Math.max(0, signersCount - 1) },
                { label: t('label-sponsored', 'Sponsored'), value: numSponsored },
                { label: t('label-sponsoring', 'Sponsoring'), value: numSponsoring },
                { label: t('label-data', 'Data'), value: dataCount },
                { label: t('label-selling', 'Selling'), value: `${sellingLiabilities.toFixed(2)} XLM` }
            ];

            const detailsHtml = detailsRows.map(row => `
                <div class="popover-row">
                    <span>${row.label}:</span>
                    <span class="has-text-weight-semibold">${row.value}</span>
                </div>
            `).join('') + `
                <div class="popover-divider"></div>
                <div class="popover-row">
                    <span>${t('label-locked', 'Total Locked')}:</span>
                    <span class="has-text-weight-semibold">${locked.toFixed(2)}</span>
                </div>
                <div class="popover-row">
                    <span>${t('label-available', 'Available')}:</span>
                    <span class="has-text-weight-semibold has-text-success">${available.toFixed(2)}</span>
                </div>
            `;

            const popover = createPopover(
                `<span class="tag is-light is-size-7">★ ${t('balance-details')}</span>`,
                detailsHtml
            );

            const card = createBalanceCard({
                title: 'XLM',
                subtitle: t('balance-native-subtitle'),
                amount: b.balance,
                meta: popover
            });
            card.dataset.asset = 'native';
            card.dataset.amount = b.balance;
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

                // Add Selling Liabilities
                const selling = parseFloat(b.selling_liabilities || '0');
                if (selling > 0) {
                     extras.push(`${t('label-selling', 'Selling')}: ${selling}`);
                }

                let meta = '';
                if (extras.length > 0) {
                    const rows = extras.map(e => `
                        <div class="popover-row"><span>${e}</span></div>
                    `).join('');
                     meta = createPopover(
                        `<span class="tag is-light is-size-7">★ ${t('balance-details')}</span>`,
                        rows
                    );
                }

                const card = createBalanceCard({
                    title: b.asset_code || '—',
                    subtitle: issuer ? `${t('balance-issuer')}: ${shorten(issuer)}` : '',
                    amount: b.balance,
                    meta: meta,
                    href: assetId ? `/asset/${encodeURIComponent(assetId)}` : null
                });
                if (assetId) card.dataset.asset = `${b.asset_code}:${b.asset_issuer}`;
                card.dataset.amount = b.balance;
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
                if (poolId !== '—') card.dataset.pool = poolId;
                card.dataset.amount = b.balance;
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
            const item = document.createElement('div');
            item.className = 'signer-item';

            const link = accountLink(s.key);
            const keyLabel = shorten(s.key);

            item.innerHTML = `
                <div class="signer-details">
                    <p class="is-size-7 has-text-weight-semibold is-mono text-truncate" title="${s.key}">
                        ${link ? `<a href="${link}">${keyLabel}</a>` : keyLabel}
                    </p>
                    <p class="is-size-7 has-text-grey-light text-truncate">${s.type}</p>
                </div>
                <span class="tag is-info is-light has-text-weight-bold">W: ${s.weight}</span>
            `;
            signersEl.appendChild(item);
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
                const item = document.createElement('div');
                item.className = 'data-item';

                const { text, hex } = decodeTextValue(value);
                let valueHtml = '';

                if (text) {
                    const isAccountId = /^G[A-Z2-7]{55}$/.test(text);
                    if (isAccountId) {
                        valueHtml = `<a href="/account/${encodeURIComponent(text)}">${text}</a>`;
                    } else {
                        // Escape HTML to prevent XSS from data values
                        const div = document.createElement('div');
                        div.textContent = text;
                        valueHtml = div.innerHTML;
                    }
                } else if (hex) {
                    valueHtml = `<span class="has-text-grey-light select-all">0x${hex}</span>`;
                } else {
                    valueHtml = t('data-decode-failed');
                }

                item.innerHTML = `
                    <span class="data-key text-truncate" title="${key}">${key}</span>
                    <div class="data-value-box is-mono break-word">
                        ${valueHtml}
                    </div>
                `;
                dataEl.appendChild(item);
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
            
            const holders = asset.num_accounts !== undefined ? asset.num_accounts : (asset.accounts?.authorized || 0);
            
            let supply = asset.amount;
            if (!supply) {
                 const auth = parseFloat(asset.balances?.authorized || 0);
                 const authM = parseFloat(asset.balances?.authorized_to_maintain_liabilities || 0);
                 const claim = parseFloat(asset.claimable_balances_amount || 0);
                 const pool = parseFloat(asset.liquidity_pools_amount || 0);
                 const contracts = parseFloat(asset.contracts_amount || 0);
                 supply = (auth + authM + claim + pool + contracts).toString();
            }

            const subtitle = `${t('issued-holders')}: ${holders}`;
            const meta = t('issued-supply');

            const card = createBalanceCard({
                title: id,
                subtitle: subtitle,
                amount: supply,
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

    async function estimateBalances() {
        const btn = document.getElementById('btn-estimate');
        const totalEl = document.getElementById('estimate-total');
        if (btn) btn.classList.add('is-loading');
        if (totalEl) totalEl.textContent = '...';

        let totalEurmtl = 0;
        const EURMTL = 'EURMTL:GACKTN5DAZGWXRWB2WLM6OPBDHAMT6SJNGLJZPQMEZBUR4JUGBX2UK7V';

        const fetchEstimate = async (asset, amount) => {
            if (parseFloat(amount) <= 0) return 0;
            if (asset === EURMTL) return parseFloat(amount);

            const [code, issuer] = asset === 'native' ? ['XLM', null] : asset.split(':');
            const type = asset === 'native' ? 'native' : (code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12');
            
            const url = new URL(`${horizonBase}/paths/strict-send`);
            url.searchParams.set('source_amount', amount);
            url.searchParams.set('source_asset_type', type);
            if (issuer) {
                url.searchParams.set('source_asset_code', code);
                url.searchParams.set('source_asset_issuer', issuer);
            }
            url.searchParams.set('destination_assets', EURMTL);

            try {
                const res = await fetch(url);
                if (!res.ok) return 0;
                const data = await res.json();
                const path = data._embedded?.records?.[0];
                return path ? parseFloat(path.destination_amount) : 0;
            } catch (e) {
                return 0;
            }
        };

        const assetCards = document.querySelectorAll('.balance-grid .box[data-asset]');
        for (const card of assetCards) {
            const asset = card.dataset.asset;
            const amount = card.dataset.amount;
            const est = await fetchEstimate(asset, amount);
            totalEurmtl += est;
            
            const amountDiv = card.querySelector('.balance-amount');
            if (amountDiv && est > 0) {
                let estSpan = amountDiv.querySelector('.est-value');
                if (!estSpan) {
                    estSpan = document.createElement('div');
                    estSpan.className = 'is-size-7 has-text-grey est-value';
                    amountDiv.appendChild(estSpan);
                }
                estSpan.textContent = `~ ${est.toFixed(2)} EURMTL`;
            }
        }

        const poolCards = document.querySelectorAll('.balance-grid .box[data-pool]');
        for (const card of poolCards) {
            const poolId = card.dataset.pool;
            const shares = parseFloat(card.dataset.amount);
            
            let pool = null;
            if (poolMetaCache.has(poolId)) {
                pool = poolMetaCache.get(poolId);
            }
            
            if (!pool || !pool.reserves) {
                 try {
                     const res = await fetch(`${horizonBase}/liquidity_pools/${poolId}`);
                     if (res.ok) {
                         const data = await res.json();
                         pool = { reserves: data.reserves, totalShares: data.total_shares };
                         poolMetaCache.set(poolId, pool); // Cache it
                     }
                 } catch (_) {}
            }

            if (pool && pool.reserves && parseFloat(pool.totalShares) > 0) {
                const ratio = shares / parseFloat(pool.totalShares);
                let poolEst = 0;
                for (const r of pool.reserves) {
                    const rAmount = parseFloat(r.amount) * ratio;
                    const rAsset = r.asset === 'native' ? 'native' : r.asset;
                    const val = await fetchEstimate(rAsset, rAmount.toFixed(7));
                    poolEst += val;
                }
                totalEurmtl += poolEst;

                const amountDiv = card.querySelector('.balance-amount');
                if (amountDiv && poolEst > 0) {
                    let estSpan = amountDiv.querySelector('.est-value');
                    if (!estSpan) {
                        estSpan = document.createElement('div');
                        estSpan.className = 'is-size-7 has-text-grey est-value';
                        amountDiv.appendChild(estSpan);
                    }
                    estSpan.textContent = `~ ${poolEst.toFixed(2)} EURMTL`;
                }
            }
        }

        if (btn) btn.classList.remove('is-loading');
        if (totalEl) totalEl.textContent = `${t('total-label', 'Total')} ${Math.round(totalEurmtl)} EURMTL`;
    }

    function renderAccount(account) {
        const seq = document.getElementById('seq');
        const sub = document.getElementById('subentries');
        
        if(seq) seq.textContent = account.sequence;
        if(sub) sub.textContent = account.subentry_count;
        setStatus('ok');

        const th = account.thresholds || {};
        const tLow = document.getElementById('threshold-low');
        const tMed = document.getElementById('threshold-med');
        const tHigh = document.getElementById('threshold-high');

        if(tLow) tLow.textContent = th.low_threshold;
        if(tMed) tMed.textContent = th.med_threshold;
        if(tHigh) tHigh.textContent = th.high_threshold;

        renderBalances(account);
        renderSignersSection(account);
        renderDataSection(account);

        const id = account.id;
        const btnBsn = document.getElementById('btn-bsn');
        const btnScopuly = document.getElementById('btn-scopuly');
        const btnStellarchain = document.getElementById('btn-stellarchain');
        const btnOperations = document.getElementById('btn-operations');
        const btnOffers = document.getElementById('btn-offers');
        const btn2025 = document.getElementById('btn-2025-stats');

        if(btnBsn) btnBsn.href = `https://bsn.expert/accounts/${id}`;
        if(btnScopuly) btnScopuly.href = `https://scopuly.com/account/${id}`;
        if(btnStellarchain) btnStellarchain.href = `https://stellarchain.io/accounts/${id}`;
        if(btnOperations) btnOperations.href = `/account/${encodeURIComponent(id)}/operations`;
        if(btnOffers) btnOffers.href = `/account/${encodeURIComponent(id)}/offers`;
        if(btn2025) btn2025.href = `/account/${encodeURIComponent(id)}/2025`;

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

    // BSN Tags
    const btnBsnTags = document.getElementById('btn-bsn-tags');
    const bsnTagsBox = document.getElementById('bsn-tags-box');
    const bsnTagsList = document.getElementById('bsn-tags-list');
    const bsnTagsLoader = document.getElementById('bsn-tags-loader');

    function renderBsnTags(income) {
        if (!bsnTagsList) return;
        bsnTagsList.innerHTML = '';

        if (!income || Object.keys(income).length === 0) {
            bsnTagsList.textContent = t('bsn-tags-empty');
            return;
        }

        // Sort keys if needed, or just iterate
        const keys = Object.keys(income);

        keys.forEach(tagName => {
            const tagData = income[tagName];
            const links = tagData.links || {};
            const accounts = Object.values(links);

            if (accounts.length === 0) return;

            const group = document.createElement('div');
            group.className = 'mb-4';

            const title = document.createElement('p');
            title.className = 'has-text-weight-bold mb-2 is-size-7';
            title.textContent = tagName;
            group.appendChild(title);

            const list = document.createElement('div');
            list.className = 'tags';

            accounts.forEach(acc => {
                const tag = document.createElement('a');
                tag.className = 'tag is-light is-info';
                tag.href = `/account/${encodeURIComponent(acc.id)}`;

                // Always use shortened account ID for consistency
                tag.textContent = shorten(acc.id);
                tag.title = acc.id; // Tooltip with full address

                list.appendChild(tag);
            });
            group.appendChild(list);
            bsnTagsList.appendChild(group);
        });
    }

    async function loadBsnTags() {
        if (!accountId || !bsnTagsBox) return;

        bsnTagsBox.classList.remove('is-hidden');
        bsnTagsLoader.classList.remove('is-hidden');
        bsnTagsList.innerHTML = '';

        try {
            const res = await fetch(`https://bsn.expert/accounts/${accountId}?format=json`);
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            const income = data.links ? data.links.income : null;
            renderBsnTags(income);
        } catch (e) {
            console.error(e);
            bsnTagsList.innerHTML = `<div class="notification is-danger is-light">${t('error-load-bsn-tags')}: ${e.message}</div>`;
        } finally {
            bsnTagsLoader.classList.add('is-hidden');
        }
    }

    // Event Listeners
    if (btnBsnTags) {
        btnBsnTags.addEventListener('click', (e) => {
            e.preventDefault();
            loadBsnTags();
        });
    }

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

    const estimateBtn = document.getElementById('btn-estimate');
    if (estimateBtn) {
        estimateBtn.addEventListener('click', estimateBalances);
    }

    // Start
    loadAccount(accountId);
}
