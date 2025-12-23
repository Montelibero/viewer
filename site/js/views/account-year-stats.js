
const HORIZON_URL = window.HORIZON_URL || 'https://horizon.stellar.org';

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
    // Should be handled by router regex, but just in case
    alert(t('error-year'));
    return;
  }

  // --- Logic ---
  const stats = {
    total: 0,
    orders: 0,
    swaps: 0,
    payments: 0,
    trustlines: 0
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

    // Logic for messages:
    // > 5s or > 200 ops -> "Oh so many"
    // > 15s or > 1000 ops -> "Meaning not so quick"
    // > 30s or > 5000 ops -> "Giant"

    let msgKey = 'loading-start';
    if (elapsed > 30000 || count > 5000) msgKey = 'loading-giant';
    else if (elapsed > 15000 || count > 1000) msgKey = 'loading-slow';
    else if (elapsed > 5000 || count > 200) msgKey = 'loading-many';

    if (loadingMsgEl) loadingMsgEl.textContent = t(msgKey);
    if (loadingStatusEl) loadingStatusEl.textContent = t('loading-status').replace('{{count}}', count);

  }, 1000);

  try {
    await fetchOperations(accountId, stats, (count) => {
        // Callback update if needed, currently handled by interval
        // But we can force update here if we want smoother counter
        if (loadingStatusEl) loadingStatusEl.textContent = t('loading-status').replace('{{count}}', count);
    });

    // Finish
    renderStats(stats);
  } catch (err) {
    console.error(err);
    if (loadingMsgEl) loadingMsgEl.textContent = t('error-fetch');
    if (loadingStatusEl) loadingStatusEl.textContent = err.message;
  } finally {
    clearInterval(loadingInterval);
  }

  function renderStats(finalStats) {
      if (loadingContainer) loadingContainer.classList.add('is-hidden');
      if (statsContainer) statsContainer.classList.remove('is-hidden');

      document.getElementById('stat-total-ops').textContent = finalStats.total.toLocaleString();
      document.getElementById('stat-orders').textContent = finalStats.orders.toLocaleString();
      document.getElementById('stat-swaps').textContent = finalStats.swaps.toLocaleString();
      document.getElementById('stat-payments').textContent = finalStats.payments.toLocaleString();
      document.getElementById('stat-trustlines').textContent = finalStats.trustlines.toLocaleString();
  }
}

export function cleanup() {
  stopFetching = true;
  if (loadingInterval) clearInterval(loadingInterval);
}

async function fetchOperations(accountId, stats, onProgress) {
  // ISO dates
  // Start: 2025-01-01T00:00:00Z
  // End: 2026-01-01T00:00:00Z (Exclusive)
  // We scan ASCENDING from Start. If created_at >= End, we stop.

  const startTime = '2025-01-01T00:00:00Z';
  const endTime = '2026-01-01T00:00:00Z';

  let cursor = '';
  // Initial url: operations?order=asc&limit=200&include_failed=true&start_time=...
  // Note: start_time parameter is not standard in all Horizon versions for /operations,
  // usually it works on /effects or /ledgers.
  // But standard Horizon /accounts/{id}/operations does NOT support start_time directly to filter by time, only cursor.
  // Wait, I need to check if /accounts/{id}/operations supports valid filters.
  // Horizon docs: /accounts/{account_id}/operations supports cursor, order, limit, include_failed.
  // It does NOT support start_time.

  // So we must fetch DESCENDING (default) from NOW (or top) until we hit 2025.
  // OR fetch ASCENDING from cursor 0? No, that's from beginning of time.
  // If the account is old, ASC from 0 is bad.
  // If the account is new, ASC is fine.

  // If we assume "most users look at recent stats", DESCENDING is better if 2025 is "current year".
  // Since 2025 is current year (in the prompt context), DESCENDING is safer.
  // We fetch DESC.
  // Stop when date < 2025-01-01.
  // Skip (don't count) if date >= 2026-01-01 (future proofing).

  let url = `${HORIZON_URL}/accounts/${accountId}/operations?limit=200&order=desc&include_failed=false`;

  stopFetching = false;

  while (!stopFetching) {
    const fetchUrl = cursor ? `${url}&cursor=${cursor}` : url;
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
    const data = await res.json();

    const records = data._embedded.records;
    if (!records || records.length === 0) break;

    for (const op of records) {
      const date = op.created_at; // ISO string

      if (date >= endTime) continue; // Skip 2026+ (if any)
      if (date < startTime) {
        stopFetching = true;
        break; // Reached 2024
      }

      // Aggregate
      stats.total++;

      const type = op.type;

      // Orders
      if (type === 'manage_buy_offer' || type === 'manage_sell_offer' || type === 'create_passive_sell_offer') {
          stats.orders++;
      }

      // Swaps
      else if (type === 'path_payment_strict_send' || type === 'path_payment_strict_receive') {
          stats.swaps++;
      }

      // Payments
      else if (type === 'payment') {
          stats.payments++;
      }

      // Trustlines
      else if (type === 'change_trust') {
          stats.trustlines++;
      }
    }

    onProgress(stats.total);

    if (stopFetching) break;

    const nextLink = data._links?.next?.href;
    if (!nextLink) break;

    // Extract cursor from next link
    const nextUrlObj = new URL(nextLink);
    cursor = nextUrlObj.searchParams.get('cursor');

    // Safety break for extremely large accounts to avoid browser crash/infinite loop in testing?
    // User asked "load until victory". I will respect that.
    // But I should check stopFetching flag from cleanup()
  }
}
