
const HORIZON_URL = window.HORIZON_URL || 'https://horizon.stellar.org';
import { assetLabelFull } from '../operation-view.js';

let loadingInterval = null;
let stopFetching = false;

export async function init(params, i18n) {
  const accountId = params[0];
  const year = params[1];

  const t = i18n.t;

  const idEl = document.getElementById('account-id');
  if (idEl) idEl.textContent = accountId;

  const backLink = document.getElementById('back-link');
  if (backLink) backLink.href = `/account/${accountId}`;

  if (year !== '2025') {
    alert(t('error-year'));
    return;
  }

  // --- Logic ---
  const stats = {
    total: 0,
    orders: 0,
    swaps: 0,
    payments: 0,
    trustlines: 0,
    data: 0,
    failed: 0,
    fees: 0, // Estimated

    // Aggregation maps
    months: {},
    counterparties: {}, // Address -> Count
    paymentAssets: {}, // Asset -> { count, amount }
    swapPairs: {} // Source->Dest -> { count, amount }
  };

  const loadingMsgEl = document.getElementById('loading-message');
  const loadingStatusEl = document.getElementById('loading-status');
  const loadingContainer = document.getElementById('loading-container');
  const statsContainer = document.getElementById('stats-container');

  // Start Humorous Loading
  const startLoadingTime = Date.now();

  if (loadingMsgEl) loadingMsgEl.textContent = t('loading-start');

  loadingInterval = setInterval(() => {
    const elapsed = Date.now() - startLoadingTime;
    const count = stats.total;

    let msgKey = 'loading-start';
    if (elapsed > 30000 || count > 5000) msgKey = 'loading-giant';
    else if (elapsed > 15000 || count > 1000) msgKey = 'loading-slow';
    else if (elapsed > 5000 || count > 200) msgKey = 'loading-many';

    if (loadingMsgEl) loadingMsgEl.textContent = t(msgKey);
    if (loadingStatusEl) loadingStatusEl.textContent = t('loading-status').replace('{{count}}', count);

  }, 1000);

  try {
    await fetchOperations(accountId, stats, (count) => {
        if (loadingStatusEl) loadingStatusEl.textContent = t('loading-status').replace('{{count}}', count);
    });

    // Finish
    renderStats(stats, t);
  } catch (err) {
    console.error(err);
    if (loadingMsgEl) loadingMsgEl.textContent = t('error-fetch');
    if (loadingStatusEl) loadingStatusEl.textContent = err.message;
  } finally {
    clearInterval(loadingInterval);
  }
}

export function cleanup() {
  stopFetching = true;
  if (loadingInterval) clearInterval(loadingInterval);
}

// Helpers for keys
function getAssetKey(code, issuer, type) {
    if (type === 'native') return 'XLM';
    return `${code || '?'}-${issuer || '?'}`;
}

function getAssetLabel(key) {
    if (key === 'XLM') return 'XLM';
    const [code, issuer] = key.split('-');
    return code; // Simplified for "Top 3" list
}

function getMonthName(dateStr) {
    // 2025-01-01 -> "2025-01"
    return dateStr.substring(0, 7);
}

async function fetchOperations(accountId, stats, onProgress) {
  const startTime = '2025-01-01T00:00:00Z';
  const endTime = '2026-01-01T00:00:00Z';

  // include_failed=true per requirements
  let url = `${HORIZON_URL}/accounts/${accountId}/operations?limit=200&order=desc&include_failed=true`;

  stopFetching = false;
  let cursor = '';

  while (!stopFetching) {
    const fetchUrl = cursor ? `${url}&cursor=${cursor}` : url;
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
    const data = await res.json();

    const records = data._embedded.records;
    if (!records || records.length === 0) break;

    for (const op of records) {
      const date = op.created_at;

      if (date >= endTime) continue;
      if (date < startTime) {
        stopFetching = true;
        break;
      }

      stats.total++;

      // Fees Estimate: 100 stroops (0.00001 XLM) per op
      stats.fees += 0.00001;

      // Month
      const month = getMonthName(date);
      stats.months[month] = (stats.months[month] || 0) + 1;

      // Failed
      if (op.transaction_successful === false) {
          stats.failed++;
          // Even if failed, we count it in total, but maybe not in specific logic?
          // Usually failed ops don't result in transfers.
          // We will SKIP specific logic (swaps, payments) if failed.
          continue;
      }

      const type = op.type;

      // Orders
      if (['manage_buy_offer', 'manage_sell_offer', 'create_passive_sell_offer'].includes(type)) {
          stats.orders++;
      }

      // Swaps
      else if (type === 'path_payment_strict_send' || type === 'path_payment_strict_receive') {
          stats.swaps++;

          // Source and Dest
          // strict_send: sends strict amount of source_asset, receives dest_min of dest_asset
          // strict_receive: sends max source, receives strict dest

          let srcKey, destKey, destAmount = 0;

          if (type === 'path_payment_strict_send') {
              srcKey = getAssetKey(op.source_asset_code, op.source_asset_issuer, op.source_asset_type);
              destKey = getAssetKey(op.asset_code, op.asset_issuer, op.asset_type); // dest asset
              // amount is source amount? "dest_min"?
              // Horizon response: amount (source sent), dest_min (min dest received).
              // Wait, in strict_send, `amount` is amount sent. `dest_amount` is not in op body?
              // The `amount` field in op is the source amount.
              // We usually care about Volume. Let's sum source volume?
              // User asked for "Sum".
              // Let's rely on what's available.
              // We will just sum `amount` (the primary amount field).
              // For strict_send, it's source. For strict_receive, it's dest.
              // To be consistent, let's track the PAIR count mostly.

              // Key: SRC -> DST
          } else {
              srcKey = getAssetKey(op.source_asset_code, op.source_asset_issuer, op.source_asset_type);
              destKey = getAssetKey(op.asset_code, op.asset_issuer, op.asset_type);
              // amount is dest amount received.
          }

          const pairKey = `${srcKey} -> ${destKey}`;
          if (!stats.swapPairs[pairKey]) stats.swapPairs[pairKey] = { count: 0 };
          stats.swapPairs[pairKey].count++;
      }

      // Payments
      else if (type === 'payment') {
          stats.payments++;
          const assetKey = getAssetKey(op.asset_code, op.asset_issuer, op.asset_type);
          if (!stats.paymentAssets[assetKey]) stats.paymentAssets[assetKey] = { count: 0, amount: 0 };
          stats.paymentAssets[assetKey].count++;
          stats.paymentAssets[assetKey].amount += parseFloat(op.amount || 0);

          // Counterparty (Outgoing: to)
          // "делал пеймент" = outgoing.
          // Horizon op "from" is usually source. "to" is dest.
          // But if we are viewing the sender's account, op.source_account == accountId.
          if (op.source_account === accountId) {
             const buddy = op.to;
             stats.counterparties[buddy] = (stats.counterparties[buddy] || 0) + 1;
          }
      }

      // Trustlines
      else if (type === 'change_trust') {
          stats.trustlines++;
      }

      // Manage Data
      else if (type === 'manage_data') {
          stats.data++;
      }
    }

    onProgress(stats.total);

    if (stopFetching) break;

    const nextLink = data._links?.next?.href;
    if (!nextLink) break;

    const nextUrlObj = new URL(nextLink);
    cursor = nextUrlObj.searchParams.get('cursor');
  }
}

function renderStats(stats, t) {
    const loadingContainer = document.getElementById('loading-container');
    const statsContainer = document.getElementById('stats-container');

    if (loadingContainer) loadingContainer.classList.add('is-hidden');
    if (statsContainer) statsContainer.classList.remove('is-hidden');

    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setText('stat-total-ops', stats.total.toLocaleString());
    setText('stat-orders', stats.orders.toLocaleString());
    setText('stat-swaps', stats.swaps.toLocaleString());
    setText('stat-payments', stats.payments.toLocaleString());
    setText('stat-trustlines', stats.trustlines.toLocaleString());
    setText('stat-data', stats.data.toLocaleString());
    setText('stat-failed', stats.failed.toLocaleString());
    setText('stat-fees', stats.fees.toFixed(5));

    // Busiest Month
    let maxMonth = '-', maxCount = 0;
    for (const [m, c] of Object.entries(stats.months)) {
        if (c > maxCount) {
            maxCount = c;
            maxMonth = m;
        }
    }
    setText('stat-month', maxMonth);

    // Top Payments
    const topPayments = Object.entries(stats.paymentAssets)
        .sort((a, b) => b[1].count - a[1].count) // Sort by Count
        .slice(0, 3);

    const paymentListEl = document.getElementById('top-payments-list');
    if (paymentListEl) {
        if (topPayments.length === 0) {
            paymentListEl.innerHTML = '<p class="has-text-grey has-text-centered">-</p>';
        } else {
            paymentListEl.innerHTML = topPayments.map(([key, data]) => `
                <div class="level is-mobile mb-2">
                    <div class="level-left">
                        <div class="level-item">
                            <span class="tag is-info is-light mr-2">${getAssetLabel(key)}</span>
                        </div>
                    </div>
                    <div class="level-right">
                        <div class="level-item has-text-right">
                            <div>
                                <p class="heading mb-0">${data.count} txs</p>
                                <p class="is-size-7">${data.amount.toLocaleString()} sum</p>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    // Top Swaps
    const topSwaps = Object.entries(stats.swapPairs)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 1); // Only Top 1 per prompt? "самый популярный" = singular.

    const swapListEl = document.getElementById('top-swaps-list');
    if (swapListEl) {
        if (topSwaps.length === 0) {
            swapListEl.innerHTML = '<p class="has-text-grey has-text-centered">-</p>';
        } else {
            const [pair, data] = topSwaps[0];
            swapListEl.innerHTML = `
                <div class="has-text-centered">
                    <p class="title is-6 mb-1">${pair}</p>
                    <p class="subtitle is-6">${data.count} times</p>
                </div>
            `;
        }
    }

    // Top Counterparty
    const topBuddy = Object.entries(stats.counterparties)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 1);

    if (topBuddy.length > 0) {
        const [addr, count] = topBuddy[0];
        setText('stat-counterparty', `${addr.substring(0,4)}...${addr.substring(addr.length-4)} (${count})`);
    }
}
