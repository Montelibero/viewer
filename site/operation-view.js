import { shorten } from './common.js?2';

export function accountLink(acc) {
  return acc ? `/account/${encodeURIComponent(acc)}` : null;
}

export function renderAccount(acc, { short = true } = {}) {
  if (!acc) return '—';
  const label = short ? shorten(acc) : acc;
  const href = accountLink(acc);
  return href ? `<a class="is-mono" href="${href}">${label}</a>` : label;
}

export function formatAmount(val) {
  if (val === undefined || val === null) return '';
  return typeof val === 'string' ? val : String(val);
}

export function formatStroopAmount(raw) {
  if (raw === undefined || raw === null) return '—';
  let s = String(raw);
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);

  let digits = s.replace(/^0+/, '');
  if (digits === '') digits = '0';

  while (digits.length < 8) {
    digits = '0' + digits;
  }
  let intPart = digits.slice(0, digits.length - 7);
  let frac = digits.slice(-7);

  if (!intPart) intPart = '0';
  frac = frac.replace(/0+$/, '');
  const sign = negative ? '-' : '';
  if (!frac) return sign + intPart;
  return sign + intPart + '.' + frac;
}

export function assetLabel(code, issuer) {
  if (!code || code === 'native') return 'XLM';
  if (issuer) return `${code}-${shorten(issuer)}`;
  return code;
}

export function assetLabelFull(code, issuer) {
  if (!code || code === 'native') return 'XLM';
  if (issuer) return `${code}-${issuer}`;
  return code;
}

const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

function decodeDataValue(raw) {
  if (raw === undefined || raw === null) {
    return { raw: '—', decodedText: null, hex: null };
  }
  const str = String(raw);

  const tryHex = () => {
    if (!/^[0-9a-fA-F]+$/.test(str) || str.length % 2 !== 0) return null;
    const bytes = [];
    for (let i = 0; i < str.length; i += 2) {
      bytes.push(parseInt(str.slice(i, i + 2), 16));
    }
    let text = null;
    try {
      const arr = Uint8Array.from(bytes);
      text = td ? td.decode(arr) : decodeURIComponent(escape(String.fromCharCode(...bytes)));
    } catch (_) {}
    return { decodedText: text, hex: str.toLowerCase(), format: 'hex' };
  };

  const tryBase64 = () => {
    try {
      const b64re = /^[A-Za-z0-9+/]+={0,2}$/;
      if (!b64re.test(str)) return null;
      const bin = atob(str);
      let text = null;
      try {
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        text = td ? td.decode(bytes) : decodeURIComponent(escape(bin));
      } catch (_) {}
      const hex = Array.from(bin, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      return { decodedText: text, hex, format: 'base64' };
    } catch (_) {
      return null;
    }
  };

  const hex = tryHex();
  if (hex) return hex;
  return tryBase64() || { raw: str, decodedText: null, hex: null };
}

function assetLink(code, issuer) {
  if (!code || !issuer) return null;
  return `/assets/${encodeURIComponent(`${code}-${issuer}`)}`;
}

function formatPriceObj(price) {
  if (!price) return '—';
  if (typeof price === 'string' || typeof price === 'number') return String(price);
  if (price.n !== undefined && price.d !== undefined) return `${price.n}/${price.d}`;
  if (price.numerator !== undefined && price.denominator !== undefined) return `${price.numerator}/${price.denominator}`;
  return JSON.stringify(price);
}

function renderClaimants(list) {
  if (!Array.isArray(list) || !list.length) return '—';
  const ul = document.createElement('ul');
  ul.className = 'ml-3';
  list.forEach((c, idx) => {
    const li = document.createElement('li');
    const dest = c.destination || c?.v0?.destination;
    const predicate = c.predicate || c?.v0?.predicate;
    li.innerHTML = `<strong>#${idx + 1}</strong>: ${renderAccount(dest)} · <code>${JSON.stringify(predicate)}</code>`;
    ul.appendChild(li);
  });
  return ul.outerHTML;
}

export function renderAsset(asset) {
  if (!asset) return '—';
  if (asset === 'native' || asset === 'XLM' || asset.native) return 'XLM';

  if (asset.asset_code) {
    const label = assetLabel(asset.asset_code, asset.asset_issuer);
    const href = assetLink(asset.asset_code, asset.asset_issuer);
    return href ? `<a href="${href}">${label}</a>` : label;
  }

  const credit = asset.credit_alphanum4 || asset.credit_alphanum12;
  if (credit) {
    const label = `${credit.asset_code} · ${shorten(credit.issuer)}`;
    const href = assetLink(credit.asset_code, credit.issuer);
    return href ? `<a href="${href}">${label}</a>` : label;
  }

  return typeof asset === 'string' ? asset : JSON.stringify(asset);
}

function getOpType(op) {
  if (op?.type) return op.type;
  const body = op?.body;
  if (typeof body === 'string') return body;
  const keys = body ? Object.keys(body) : [];
  if (!keys.length) return 'unknown';
  return keys[0];
}

function isXdrOp(op) {
  if (!op || typeof op !== 'object') return false;
  if (op.body && typeof op.body === 'object') return true;
  if (typeof op.body === 'string') return true;
  if (op.type === 'end_sponsoring_future_reserves' && op.body === 'end_sponsoring_future_reserves') return true;
  return false;
}

function renderStatusTag(success) {
  if (success === true) {
    return '<span class="tag is-success is-light is-pulled-right">Success</span>';
  }
  if (success === false) {
    return '<span class="tag is-danger is-light is-pulled-right">Failed</span>';
  }
  return '<span class="tag is-info is-light is-pulled-right">—</span>';
}

export function renderOperationDetails(op) {
  const container = document.createElement('div');
  container.className = 'is-size-7';

  const type = getOpType(op);
  const xdrInner = isXdrOp(op)
    ? (typeof op.body === 'string' ? {} : op.body?.[type] || {})
    : null;

  const addLine = (label, value) => {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${label}:</strong> ${value}`;
    container.appendChild(p);
  };

  if (type === 'payment') {
    const dest = xdrInner ? xdrInner.destination : (op.to_muxed || op.to || op.to_muxed_id);
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const asset = xdrInner ? renderAsset(xdrInner.asset) : assetLabel(op.asset_code || op.asset, op.asset_issuer);
    addLine('Сумма', `${amount} ${asset}`);
    addLine('Получатель', renderAccount(dest));
  } else if (type === 'path_payment_strict_receive') {
    const dest = xdrInner ? xdrInner.destination : (op.to_muxed || op.to || op.to_muxed_id);
    const destAmount = xdrInner ? formatStroopAmount(xdrInner.destAmount ?? xdrInner.dest_amount) : formatAmount(op.amount);
    const destAsset = xdrInner ? renderAsset(xdrInner.destAsset ?? xdrInner.dest_asset) : assetLabel(op.asset_code || op.asset, op.asset_issuer);
    const sourceAmount = xdrInner ? formatStroopAmount(xdrInner.sendMax ?? xdrInner.send_max) : formatAmount(op.source_amount);
    const sourceAsset = xdrInner ? renderAsset(xdrInner.sendAsset ?? xdrInner.send_asset) : assetLabel(op.source_asset_code, op.source_asset_issuer);
    addLine('Получатель', renderAccount(dest));
    addLine('Получает', `${destAmount} ${destAsset}`);
    addLine('Потратим максимум', `${sourceAmount} ${sourceAsset}`);
  } else if (type === 'path_payment_strict_send') {
    const dest = xdrInner ? xdrInner.destination : (op.to_muxed || op.to || op.to_muxed_id);
    const sendAmount = xdrInner ? formatStroopAmount(xdrInner.sendAmount ?? xdrInner.send_amount) : formatAmount(op.source_amount);
    const sendAsset = xdrInner ? renderAsset(xdrInner.sendAsset ?? xdrInner.send_asset) : assetLabel(op.source_asset_code, op.source_asset_issuer);
    const destMin = xdrInner ? formatStroopAmount(xdrInner.destMin ?? xdrInner.dest_min) : formatAmount(op.destination_min);
    const destAsset = xdrInner ? renderAsset(xdrInner.destAsset ?? xdrInner.dest_asset) : assetLabel(op.asset_code || op.asset, op.asset_issuer);
    addLine('Получатель', renderAccount(dest));
    addLine('Отправляем', `${sendAmount} ${sendAsset}`);
    addLine('Ожидаем минимум', `${destMin} ${destAsset}`);
  } else if (type === 'create_account') {
    const amount = xdrInner ? formatStroopAmount(xdrInner.startingBalance ?? xdrInner.starting_balance) : formatAmount(op.starting_balance);
    const account = xdrInner ? xdrInner.destination : op.account;
    addLine('Начальный баланс', `${amount} XLM`);
    addLine('Новый аккаунт', renderAccount(account));
  } else if (type === 'manage_sell_offer' || type === 'manage_buy_offer' || type === 'create_passive_sell_offer') {
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const selling = xdrInner ? renderAsset(xdrInner.selling) : assetLabel(op.selling_asset_code, op.selling_asset_issuer);
    const buying = xdrInner ? renderAsset(xdrInner.buying) : assetLabel(op.buying_asset_code, op.buying_asset_issuer);
    const price = xdrInner && xdrInner.price ? `${xdrInner.price.n}/${xdrInner.price.d}` : (op.price || '—');
    addLine('Продаём', `${amount} ${selling}`);
    addLine('Покупаем', buying);
    addLine('Цена', price);
  } else if (type === 'set_options') {
    const inflation = xdrInner ? (xdrInner.inflationDest ?? xdrInner.inflation_dest) : op.inflation_dest;
    const homeDomain = xdrInner ? (xdrInner.homeDomain ?? xdrInner.home_domain) : op.home_domain;
    const thresholds = {
      master: xdrInner ? (xdrInner.masterWeight ?? xdrInner.master_weight) : op.master_key_weight,
      low: xdrInner ? (xdrInner.lowThreshold ?? xdrInner.low_threshold) : op.low_threshold,
      med: xdrInner ? (xdrInner.medThreshold ?? xdrInner.med_threshold) : op.med_threshold,
      high: xdrInner ? (xdrInner.highThreshold ?? xdrInner.high_threshold) : op.high_threshold
    };
    const clear = xdrInner ? (xdrInner.clearFlags ?? xdrInner.clear_flags) : op.clear_flags_s || op.clear_flags;
    const set = xdrInner ? (xdrInner.setFlags ?? xdrInner.set_flags) : op.set_flags_s || op.set_flags;
    addLine('Домейн', homeDomain || '—');
    addLine('Инфляционный адрес', inflation ? renderAccount(inflation, { short: false }) : '—');
    addLine('Пороги', `low: ${thresholds.low ?? '—'}, med: ${thresholds.med ?? '—'}, high: ${thresholds.high ?? '—'}`);
    addLine('Вес мастера', thresholds.master ?? '—');
    if (set !== undefined) addLine('Установить флаги', set);
    if (clear !== undefined) addLine('Сбросить флаги', clear);
    const signer = xdrInner ? xdrInner.signer : (op.signer_key ? { key: op.signer_key, weight: op.signer_weight } : null);
    if (signer) {
      const key = signer.ed25519 || signer.preAuthTx || signer.hashX || signer.key || signer.ed25519PublicKey || signer.sha256Hash;
      addLine('Сигнер', `${key || '—'} (weight ${signer.weight ?? signer.signer_weight ?? '—'})`);
    }
  } else if (type === 'change_trust') {
    const asset = xdrInner ? renderAsset(xdrInner.line) : assetLabel(op.asset_code, op.asset_issuer);
    const limit = xdrInner ? formatStroopAmount(xdrInner.limit) : (op.limit || '—');
    addLine('Траст к активу', asset);
    addLine('Лимит', limit);
  } else if (type === 'allow_trust') {
    const trustor = xdrInner ? xdrInner.trustor : op.trustor;
    const asset = xdrInner ? renderAsset(xdrInner.asset) : assetLabel(op.asset_code, op.asset_issuer);
    const auth = op.authorize !== undefined ? op.authorize : xdrInner?.authorize;
    addLine('Трастор', renderAccount(trustor));
    addLine('Актив', asset);
    addLine('Авторизация', auth ? 'Да' : 'Нет');
  } else if (type === 'account_merge') {
    const dest = xdrInner ? xdrInner.destination : (op.into || op.account || op.account_merge_dest);
    addLine('Перевести на', renderAccount(dest, { short: false }));
  } else if (type === 'inflation') {
    addLine('Действие', 'Вызов инфляции');
  } else if (type === 'manage_data') {
    const name = xdrInner ? (xdrInner.dataName ?? xdrInner.data_name) : op.data_name;
    const valueRaw = xdrInner ? (xdrInner.dataValue ?? xdrInner.data_value) : op.data_value;
    const decoded = decodeDataValue(valueRaw);
    addLine('Имя', name || '—');
    addLine('Значение (raw)', valueRaw || '—');
    if (decoded.decodedText) {
      addLine('Значение (строка)', decoded.decodedText);
    }
    if (decoded.hex) {
      addLine('Значение (hex)', decoded.hex);
    }
  } else if (type === 'bump_sequence') {
    const bump = xdrInner ? (xdrInner.bumpTo ?? xdrInner.bump_to) : op.bump_to;
    addLine('Новый sequence', bump || '—');
  } else if (type === 'create_claimable_balance') {
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const asset = xdrInner ? renderAsset(xdrInner.asset) : assetLabel(op.asset_code || op.asset, op.asset_issuer);
    const claimants = xdrInner ? xdrInner.claimants : op.claimants;
    addLine('Сумма', `${amount} ${asset}`);
    addLine('Клейманты', renderClaimants(claimants));
  } else if (type === 'claim_claimable_balance') {
    const id = xdrInner ? (xdrInner.balanceId ?? xdrInner.balance_id) : op.balance_id;
    addLine('Balance ID', id || '—');
  } else if (type === 'begin_sponsoring_future_reserves') {
    const sponsored = xdrInner
      ? (xdrInner.sponsoredId || xdrInner.sponsoredID || xdrInner.sponsored_id)
      : op.sponsored_id;
    addLine('Спонсируемый', renderAccount(sponsored));
  } else if (type === 'end_sponsoring_future_reserves') {
    const sponsored = op.sponsored_id || xdrInner?.sponsoredId || xdrInner?.sponsoredID || xdrInner?.sponsored_id;
    addLine('Действие', 'Завершение спонсирования резервов');
    if (sponsored) addLine('Спонсируемый', renderAccount(sponsored));
  } else if (type === 'revoke_sponsorship') {
    const target =
      op.account_id || op.trustline_account_id || op.signer_account_id || op.data_account_id ||
      op.claimable_balance_id || op.liquidity_pool_id || op.offer_id ||
      xdrInner?.accountId || xdrInner?.account_id || xdrInner?.claimableBalanceId || xdrInner?.claimable_balance_id || xdrInner?.liquidityPoolId || xdrInner?.liquidity_pool_id;
    const dataName = op.data_name || xdrInner?.dataName || xdrInner?.data_name;
    const signerKey = op.signer_key || xdrInner?.signerKey || xdrInner?.signer_key;
    const trustAsset = op.trustline_asset || xdrInner?.trustLine?.asset || xdrInner?.trustLine?.assetId || xdrInner?.trust_line?.asset || xdrInner?.trust_line?.asset_id;
    let targetDesc = '';
    if (target && dataName) targetDesc = `Data: ${renderAccount(target)} / ${dataName}`;
    else if (target && signerKey) targetDesc = `Signer: ${renderAccount(target)} / ${signerKey}`;
    else if (target && trustAsset) {
      const assetLabelStr = typeof trustAsset === 'object' ? renderAsset(trustAsset) : trustAsset;
      targetDesc = `Trustline: ${renderAccount(target)} / ${assetLabelStr}`;
    }
    else if (target) targetDesc = renderAccount(target, { short: false });
    if (op.offer_id) targetDesc = `Offer ${op.offer_id}`;
    if (op.claimable_balance_id) targetDesc = `Claimable balance ${op.claimable_balance_id}`;
    if (op.liquidity_pool_id) targetDesc = `Liquidity pool ${op.liquidity_pool_id}`;
    addLine('Отзыв спонсирования', targetDesc || JSON.stringify(xdrInner || op));
  } else if (type === 'clawback') {
    const from = xdrInner ? xdrInner.from : op.from;
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const asset = xdrInner ? renderAsset(xdrInner.asset) : assetLabel(op.asset_code || op.asset, op.asset_issuer);
    addLine('Изъять у', renderAccount(from));
    addLine('Сумма', `${amount} ${asset}`);
  } else if (type === 'clawback_claimable_balance') {
    const id = xdrInner ? (xdrInner.balanceId ?? xdrInner.balance_id) : op.balance_id;
    addLine('Claimable balance', id || '—');
  } else if (type === 'set_trust_line_flags') {
    const trustor = xdrInner ? xdrInner.trustor : op.trustor;
    const asset = xdrInner ? renderAsset(xdrInner.asset) : assetLabel(op.asset_code, op.asset_issuer);
    addLine('Трастор', renderAccount(trustor));
    addLine('Актив', asset);
    const authorize = op.authorize ?? xdrInner?.authorize ?? xdrInner?.setFlags;
    const maintain = op.authorize_to_maintain_liabilities ?? xdrInner?.authorizeToMaintainLiabilities;
    const clawback = op.clawback_enabled ?? xdrInner?.clawbackEnabled;
    const clear = op.clear_flags ?? op.clear_flags_s ?? xdrInner?.clearFlags ?? xdrInner?.clear_flags;
    const set = op.set_flags ?? op.set_flags_s ?? xdrInner?.setFlags ?? xdrInner?.set_flags;
    addLine('Флаги', `set: ${set ?? '—'}, clear: ${clear ?? '—'}, auth: ${authorize ?? '—'}, maintain: ${maintain ?? '—'}, clawback: ${clawback ?? '—'}`);
  } else if (type === 'liquidity_pool_deposit') {
    const pool = xdrInner ? (xdrInner.liquidityPoolId ?? xdrInner.liquidity_pool_id) : op.liquidity_pool_id;
    const maxA = xdrInner ? formatStroopAmount(xdrInner.maxAmountA ?? xdrInner.max_amount_a) : formatAmount(op.reserves_max_a);
    const maxB = xdrInner ? formatStroopAmount(xdrInner.maxAmountB ?? xdrInner.max_amount_b) : formatAmount(op.reserves_max_b);
    const minPrice = xdrInner ? formatPriceObj(xdrInner.minPrice ?? xdrInner.min_price) : formatPriceObj(op.min_price);
    const maxPrice = xdrInner ? formatPriceObj(xdrInner.maxPrice ?? xdrInner.max_price) : formatPriceObj(op.max_price);
    addLine('Pool', pool || '—');
    addLine('Макс. резерв A', maxA);
    addLine('Макс. резерв B', maxB);
    addLine('Мин. цена', minPrice);
    addLine('Макс. цена', maxPrice);
    if (op.reserves_deposited_a) addLine('Зачислено A', op.reserves_deposited_a);
    if (op.reserves_deposited_b) addLine('Зачислено B', op.reserves_deposited_b);
    if (op.shares_received) addLine('Получено долей', op.shares_received);
  } else if (type === 'liquidity_pool_withdraw') {
    const pool = xdrInner ? (xdrInner.liquidityPoolId ?? xdrInner.liquidity_pool_id) : op.liquidity_pool_id;
    const shares = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.shares);
    const minA = xdrInner ? formatStroopAmount(xdrInner.minAmountA ?? xdrInner.min_amount_a) : formatAmount(op.reserves_min_a);
    const minB = xdrInner ? formatStroopAmount(xdrInner.minAmountB ?? xdrInner.min_amount_b) : formatAmount(op.reserves_min_b);
    addLine('Pool', pool || '—');
    addLine('Списать долей', shares);
    addLine('Мин. резерв A', minA);
    addLine('Мин. резерв B', minB);
    if (op.reserves_received_a) addLine('Получено A', op.reserves_received_a);
    if (op.reserves_received_b) addLine('Получено B', op.reserves_received_b);
  } else {
    const raw = xdrInner || op;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(raw, null, 2);
    container.appendChild(pre);
  }

  return container;
}

export function createOperationCard(op) {
  const box = document.createElement('div');
  box.className = 'box is-size-7 op-card';

  const statusTag = renderStatusTag(op.transaction_successful ?? op.successful ?? op.success);
  const failed = op.transaction_successful === false || op.successful === false || op.success === false;
  if (failed) box.classList.add('is-failed');

  const header = document.createElement('p');
  header.innerHTML = `<strong>${getOpType(op) || 'operation'}</strong> · ${op.created_at || ''}${statusTag}`;
  box.appendChild(header);

  const src = document.createElement('p');
  src.className = 'is-size-7';
  const srcLink = accountLink(op.source_account);
  src.innerHTML = `Источник: ${srcLink ? `<a href="${srcLink}" class="is-mono">${shorten(op.source_account)}</a>` : (op.source_account || '—')}`;
  box.appendChild(src);

  if (op.transaction_hash) {
    const tx = document.createElement('p');
    tx.className = 'is-size-7';
    tx.innerHTML = `Транзакция: <a class="is-mono" href="/transaction/${op.transaction_hash}">${shorten(op.transaction_hash)}</a>`;
    box.appendChild(tx);
  }

  const details = renderOperationDetails(op);
  details.classList.add('mt-2');
  box.appendChild(details);

  return box;
}

export function createXdrOperationBox(op, index, txSource, { txSuccessful = null } = {}) {
  const box = document.createElement('div');
  box.className = 'box is-size-7 op-card';

  const opSource = op.source_account || txSource;
  const type = getOpType(op);
  const details = renderOperationDetails(op);
  const statusTag = renderStatusTag(txSuccessful);
  if (txSuccessful === false) box.classList.add('is-failed');

  box.innerHTML = `
    <p><strong>#${index + 1}</strong> · <span>${type}</span>${statusTag}</p>
    <p class="is-size-7 mt-1">
      Источник операции: ${renderAccount(opSource, { short: false })}
    </p>
  `;
  details.classList.add('mt-2');
  box.appendChild(details);

  return box;
}
