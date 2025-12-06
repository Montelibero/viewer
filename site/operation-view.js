import { shorten } from './common.js';

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

function assetLink(code, issuer) {
  if (!code || !issuer) return null;
  return `/assets/${encodeURIComponent(`${code}-${issuer}`)}`;
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
  const body = op?.body || {};
  const keys = Object.keys(body);
  if (keys.length) return keys[0];
  return 'unknown';
}

function isXdrOp(op) {
  return Boolean(op?.body);
}

export function renderOperationDetails(op) {
  const container = document.createElement('div');
  container.className = 'is-size-7';

  const type = getOpType(op);
  const xdrInner = isXdrOp(op) ? op.body?.[type] || {} : null;

  const addLine = (label, value) => {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${label}:</strong> ${value}`;
    container.appendChild(p);
  };

  if (type === 'payment' || type === 'path_payment_strict_receive' || type === 'path_payment_strict_send') {
    const dest = xdrInner ? xdrInner.destination : (op.to_muxed || op.to || op.to_muxed_id);
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const asset = xdrInner ? renderAsset(xdrInner.asset) : assetLabel(op.asset_code || op.asset, op.asset_issuer);
    const destLink = renderAccount(dest);
    addLine('Сумма', `${amount} ${asset}`);
    addLine('Получатель', destLink);
  } else if (type === 'create_account') {
    const amount = xdrInner ? formatStroopAmount(xdrInner.starting_balance) : formatAmount(op.starting_balance);
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
  } else if (type === 'change_trust') {
    const asset = xdrInner ? renderAsset(xdrInner.line) : assetLabel(op.asset_code, op.asset_issuer);
    const limit = xdrInner ? formatStroopAmount(xdrInner.limit) : (op.limit || '—');
    addLine('Траст к активу', asset);
    addLine('Лимит', limit);
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

  const statusTag = op.transaction_successful
    ? '<span class="tag is-success is-light is-pulled-right">Success</span>'
    : '<span class="tag is-danger is-light is-pulled-right">Failed</span>';

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

export function createXdrOperationBox(op, index, txSource) {
  const box = document.createElement('div');
  box.className = 'box is-size-7';

  const opSource = op.source_account || txSource;
  const type = getOpType(op);
  const details = renderOperationDetails(op);

  box.innerHTML = `
    <p><strong>#${index + 1}</strong> · <span>${type}</span></p>
    <p class="is-size-7 mt-1">
      Источник операции: ${renderAccount(opSource, { short: false })}
    </p>
  `;
  details.classList.add('mt-2');
  box.appendChild(details);

  return box;
}
