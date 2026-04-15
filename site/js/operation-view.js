import { shorten, getHorizonURL, decodeTextValue, encodeAddress, encodeContract, bytesToHex } from './common.js';

// ---- Minimal synchronous ScVal decoder (covers types used in Soroban
// invoke_host_function parameters: bool, void, u32/i32, u64/i64, u128/i128,
// bytes, string, symbol, vec, map, address). Used to render contract calls
// inline without pulling in the stellar-base bundle.
function scvalReader(base64) {
  const bin = atob(base64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { bytes, view, off: 0 };
}
function rU32(r) { const v = r.view.getUint32(r.off, false); r.off += 4; return v; }
function rI32(r) { const v = r.view.getInt32(r.off, false); r.off += 4; return v; }
function rU64(r) { const v = r.view.getBigUint64(r.off, false); r.off += 8; return v; }
function rI64(r) { const v = r.view.getBigInt64(r.off, false); r.off += 8; return v; }
function rOpaque(r, len) {
  const s = r.off;
  r.off += len;
  const pad = (4 - (len % 4)) % 4;
  r.off += pad;
  return r.bytes.subarray(s, s + len);
}
function rVarOpaque(r) { return rOpaque(r, rU32(r)); }
function utf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
  catch (_) { return ''; }
}

export function decodeScVal(base64) {
  try {
    const r = scvalReader(base64);
    return readScVal(r);
  } catch (e) {
    return { type: 'error', error: e.message, raw: base64 };
  }
}

function readScVal(r) {
  const type = rU32(r);
  switch (type) {
    case 0: return { type: 'bool', value: rU32(r) !== 0 };
    case 1: return { type: 'void' };
    case 2: return { type: 'error', value: rU32(r) };
    case 3: return { type: 'u32', value: rU32(r) };
    case 4: return { type: 'i32', value: rI32(r) };
    case 5: return { type: 'u64', value: rU64(r).toString() };
    case 6: return { type: 'i64', value: rI64(r).toString() };
    case 7: return { type: 'timepoint', value: rU64(r).toString() };
    case 8: return { type: 'duration', value: rU64(r).toString() };
    case 9: {
      const hi = rU64(r), lo = rU64(r);
      return { type: 'u128', value: ((hi << 64n) | lo).toString() };
    }
    case 10: {
      const hi = rI64(r), lo = rU64(r);
      return { type: 'i128', value: (hi * (1n << 64n) + lo).toString() };
    }
    case 13: return { type: 'bytes', value: rVarOpaque(r) };
    case 14: return { type: 'string', value: utf8(rVarOpaque(r)) };
    case 15: return { type: 'symbol', value: utf8(rVarOpaque(r)) };
    case 16: {
      const present = rU32(r);
      if (!present) return { type: 'vec', value: null };
      const len = rU32(r);
      const items = [];
      for (let i = 0; i < len; i++) items.push(readScVal(r));
      return { type: 'vec', value: items };
    }
    case 17: {
      const present = rU32(r);
      if (!present) return { type: 'map', value: null };
      const len = rU32(r);
      const entries = [];
      for (let i = 0; i < len; i++) {
        const k = readScVal(r);
        const v = readScVal(r);
        entries.push({ key: k, val: v });
      }
      return { type: 'map', value: entries };
    }
    case 18: {
      const addrType = rU32(r);
      if (addrType === 0) {
        rU32(r); // PublicKey tag (ed25519)
        const key = rOpaque(r, 32);
        return { type: 'address', subtype: 'account', bytes: key };
      }
      if (addrType === 1) {
        const hash = rOpaque(r, 32);
        return { type: 'address', subtype: 'contract', bytes: hash };
      }
      return { type: 'address', subtype: 'unknown' };
    }
    case 19: return { type: 'ledger_key_contract_instance' };
    default:
      return { type: 'unknown', code: type };
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatScValInline(v, depth = 0) {
  if (!v) return '—';
  switch (v.type) {
    case 'void': return 'void';
    case 'bool':
    case 'u32':
    case 'i32':
    case 'u64':
    case 'i64':
    case 'u128':
    case 'i128':
    case 'timepoint':
    case 'duration':
      return escapeHtml(String(v.value));
    case 'symbol':
      return escapeHtml(v.value);
    case 'string':
      return `"${escapeHtml(v.value)}"`;
    case 'bytes': {
      const hex = bytesToHex(v.value);
      return hex.length > 16 ? `0x${hex.slice(0, 8)}…${hex.slice(-8)}` : `0x${hex}`;
    }
    case 'address': {
      const g = v.subtype === 'account' ? (v.strkey || encodeAddress(v.bytes)) : null;
      const c = v.subtype === 'contract' ? (v.strkey || encodeContract(v.bytes)) : null;
      if (g) return `<a class="is-mono" href="/account/${g}">${shorten(g)}</a>`;
      if (c) return `<a class="is-mono" href="/contract/${c}">${shorten(c)}</a>`;
      return '—';
    }
    case 'vec': {
      if (v.value === null) return '[]';
      if (depth >= 2) return `[…${v.value.length}]`;
      return '[' + v.value.map(x => formatScValInline(x, depth + 1)).join(', ') + ']';
    }
    case 'map': {
      if (v.value === null) return '{}';
      if (depth >= 2) return `{…${v.value.length}}`;
      return '{ ' + v.value.map(e =>
        `${formatScValInline(e.key, depth + 1)}: ${formatScValInline(e.val, depth + 1)}`
      ).join(', ') + ' }';
    }
    case 'ledger_key_contract_instance': return '[Instance]';
    case 'error': return `<span class="has-text-danger">err</span>`;
    case 'unknown': return `<span class="has-text-grey">?${v.code}</span>`;
    default: return '—';
  }
}

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

// decodeDataValue is now in common.js as decodeTextValue
// But we need to adapt it because existing code expects { decodedText, hex, format } or similar structure
// Actually, let's update usage instead.

function parseDataValue(raw) {
    if (raw === undefined || raw === null) return { raw: '—' };

    // Use the common decoder
    const { text, hex } = decodeTextValue(raw);

    // We want to return structure compatible with what usage expects:
    // usage: if (decoded.decodedText) ... if (decoded.hex) ...
    return { decodedText: text, hex: hex, raw: raw };
}

function assetLink(code, issuer) {
  if (!code || !issuer) return null;
  return `/asset/${encodeURIComponent(`${code}-${issuer}`)}`;
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

function getOfferId(op, xdrInner) {
  // 1. Try Horizon op.offer_id or xdrInner.offerId
  // Note: For creation, xdrInner.offerId is 0.
  let id = op.offer_id || (xdrInner ? (xdrInner.offerId ?? xdrInner.offer_id) : null);

  if (id && id !== '0' && id !== 0) return String(id);

  // 2. Try op.result (attached in transaction view)
  if (!op.result) return null;

  const res = op.result;
  // res.tr is the union (op_inner in some JSON formats)
  const tr = res.op_inner || res.tr || res;

  // Possible keys for result union (handling snake_case and CamelCase)
  const innerRes =
      tr.manage_sell_offer || tr.manageSellOfferResult ||
      tr.manage_buy_offer || tr.manageBuyOfferResult ||
      tr.create_passive_sell_offer || tr.createPassiveSellOfferResult;

  if (innerRes && innerRes.success) {
      // success.offer is ManageOfferEffect union
      const effect = innerRes.success.offer;

      // Check for created/updated keys (snake_case JSON often uses union arm name)
      // or 'offer' if flattened
      const entry = effect.created || effect.updated || effect.offer;

      if (entry) {
          return String(entry.offer_id ?? entry.offerId);
      }
  }

  return null;
}

function renderStatusTag(success, t) {
  const T = (k, f) => t ? t(k) : f;
  if (success === true) {
    return `<span class="tag is-success is-light is-pulled-right">${T('status-success', 'Success')}</span>`;
  }
  if (success === false) {
    return `<span class="tag is-danger is-light is-pulled-right">${T('status-failed', 'Failed')}</span>`;
  }
  return '<span class="tag is-info is-light is-pulled-right">—</span>';
}

function resolveT(t, key, fallback) {
  return t ? t(key) : fallback;
}

// Walk an object decoded by stellar-xdr-json and fix `\xNN` escapes in any
// string field so JSON output is human-readable.
export function cleanXdrJson(v) {
  if (typeof v === 'string') return decodeXdrJsonString(v);
  if (Array.isArray(v)) return v.map(cleanXdrJson);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = cleanXdrJson(v[k]);
    return out;
  }
  return v;
}

// stellar-xdr-json encodes SCV_STRING bytes as ASCII with \xNN escapes
// for non-ASCII — convert back to real UTF-8.
function decodeXdrJsonString(s) {
  if (typeof s !== 'string') return String(s);
  if (!/\\x[0-9a-fA-F]{2}/.test(s)) return s;
  const bytes = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '\\' && s[i + 1] === 'x') {
      bytes.push(parseInt(s.substr(i + 2, 2), 16));
      i += 4;
    } else {
      bytes.push(s.charCodeAt(i) & 0xff);
      i += 1;
    }
  }
  try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)); }
  catch (_) { return s; }
}

// Convert stellar-xdr-json ScVal JSON shape into our canonical shape used by
// formatScValInline (same shape as decodeScVal's output).
function xdrScValToCanonical(obj) {
  if (obj == null || typeof obj !== 'object') return { type: 'unknown' };
  if ('bool' in obj) return { type: 'bool', value: !!obj.bool };
  if ('void' in obj) return { type: 'void' };
  if ('u32' in obj) return { type: 'u32', value: obj.u32 };
  if ('i32' in obj) return { type: 'i32', value: obj.i32 };
  if ('u64' in obj) return { type: 'u64', value: String(obj.u64) };
  if ('i64' in obj) return { type: 'i64', value: String(obj.i64) };
  if ('timepoint' in obj) return { type: 'timepoint', value: String(obj.timepoint) };
  if ('duration' in obj) return { type: 'duration', value: String(obj.duration) };
  if ('u128' in obj) return { type: 'u128', value: String(obj.u128) };
  if ('i128' in obj) return { type: 'i128', value: String(obj.i128) };
  if ('bytes' in obj) {
    const hex = String(obj.bytes);
    const u = new Uint8Array(hex.length / 2);
    for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16);
    return { type: 'bytes', value: u };
  }
  if ('string' in obj) return { type: 'string', value: decodeXdrJsonString(obj.string) };
  if ('symbol' in obj) return { type: 'symbol', value: obj.symbol };
  if ('address' in obj) {
    const s = obj.address;
    if (typeof s === 'string' && s.length === 56) {
      if (s[0] === 'G') return { type: 'address', subtype: 'account', strkey: s };
      if (s[0] === 'C') return { type: 'address', subtype: 'contract', strkey: s };
    }
    return { type: 'address', subtype: 'unknown' };
  }
  if ('vec' in obj) {
    return { type: 'vec', value: Array.isArray(obj.vec) ? obj.vec.map(xdrScValToCanonical) : null };
  }
  if ('map' in obj) {
    return {
      type: 'map',
      value: Array.isArray(obj.map)
        ? obj.map.map(e => ({ key: xdrScValToCanonical(e.key), val: xdrScValToCanonical(e.val) }))
        : null
    };
  }
  if ('ledger_key_contract_instance' in obj) return { type: 'ledger_key_contract_instance' };
  return { type: 'unknown' };
}

// Normalize invoke_host_function op from either Horizon or XDR shape into
// a single canonical structure. Returns null if op isn't an invoke-contract call.
function normalizeInvokeContract(op) {
  // Horizon shape: op.function + op.parameters[{ type, value: base64 }]
  if (op.function && Array.isArray(op.parameters) && op.parameters.length >= 2) {
    const isInvoke = /InvokeContract/i.test(op.function)
      || (op.parameters[0]?.type === 'Address' && op.parameters[1]?.type === 'Sym');
    if (isInvoke) {
      const contract = decodeScVal(op.parameters[0].value);
      const fn = decodeScVal(op.parameters[1].value);
      const args = op.parameters.slice(2).map(p => decodeScVal(p.value));
      return {
        contract,
        fnName: fn?.type === 'symbol' ? fn.value : null,
        args
      };
    }
  }
  // XDR shape: op.body.invoke_host_function.host_function.invoke_contract
  const ic = op?.body?.invoke_host_function?.host_function?.invoke_contract
    || op?.body?.invokeHostFunction?.hostFunction?.invokeContract;
  if (ic) {
    return {
      contract: { type: 'address', subtype: ic.contract_address?.[0] === 'C' ? 'contract' : 'account', strkey: ic.contract_address },
      fnName: ic.function_name || ic.functionName,
      args: (ic.args || []).map(xdrScValToCanonical)
    };
  }
  return null;
}

function renderInvokeHostFunction(container, op, T) {
  const call = normalizeInvokeContract(op);

  if (call) {
    const contractHtml = formatScValInline(call.contract);
    const fnName = call.fnName ? escapeHtml(call.fnName) : '?';
    const argsHtml = call.args.map(a => formatScValInline(a)).join(', ');

    const callP = document.createElement('p');
    callP.className = 'is-mono';
    callP.innerHTML = `${contractHtml}.<strong>${fnName}</strong>(${argsHtml})`;
    container.appendChild(callP);
  } else if (op.function) {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${T('op-host-fn', 'Function')}:</strong> ${escapeHtml(op.function)}`;
    container.appendChild(p);
  }

  const changes = Array.isArray(op.asset_balance_changes) ? op.asset_balance_changes : [];
  changes.forEach(ch => {
    const p = document.createElement('p');
    const amount = formatAmount(ch.amount);
    const asset = renderAsset({
      asset_code: ch.asset_code,
      asset_issuer: ch.asset_issuer,
      native: ch.asset_type === 'native'
    });
    const from = ch.from ? renderAccountOrContract(ch.from) : '—';
    const to = ch.to ? renderAccountOrContract(ch.to) : '—';
    const typeLabel = ch.type || 'transfer';
    p.innerHTML = `<strong>${escapeHtml(typeLabel)}:</strong> ${amount} ${asset} · ${from} → ${to}`;
    container.appendChild(p);
  });

  const details = document.createElement('details');
  details.className = 'mt-2';
  const summary = document.createElement('summary');
  summary.className = 'is-size-7 has-text-grey is-clickable';
  summary.textContent = T('op-raw-json', 'Raw JSON');
  details.appendChild(summary);
  const pre = document.createElement('pre');
  pre.className = 'is-size-7';
  pre.textContent = JSON.stringify(cleanXdrJson(op), null, 2);
  details.appendChild(pre);
  container.appendChild(details);
}

function renderAccountOrContract(addr) {
  if (!addr) return '—';
  if (typeof addr === 'string' && addr.length === 56 && addr[0] === 'C') {
    return `<a class="is-mono" href="/contract/${addr}">${shorten(addr)}</a>`;
  }
  return renderAccount(addr);
}

export function renderOperationDetails(op, t) {
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

  const T = (k, f) => resolveT(t, k, f);

  if (type === 'payment') {
    const dest = xdrInner ? xdrInner.destination : (op.to_muxed || op.to || op.to_muxed_id);
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const asset = xdrInner ? renderAsset(xdrInner.asset) : renderAsset({ asset_code: op.asset_code || op.asset, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
    addLine(T('op-amount', 'Amount'), `${amount} ${asset}`);
    addLine(T('op-dest', 'Destination'), renderAccount(dest));
  } else if (type === 'path_payment_strict_receive') {
    const dest = xdrInner ? xdrInner.destination : (op.to_muxed || op.to || op.to_muxed_id);
    const destAmount = xdrInner ? formatStroopAmount(xdrInner.destAmount ?? xdrInner.dest_amount) : formatAmount(op.amount);
    const destAsset = xdrInner ? renderAsset(xdrInner.destAsset ?? xdrInner.dest_asset) : renderAsset({ asset_code: op.asset_code || op.asset, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
    const sourceAmount = xdrInner ? formatStroopAmount(xdrInner.sendMax ?? xdrInner.send_max) : formatAmount(op.source_amount);
    const sourceAsset = xdrInner ? renderAsset(xdrInner.sendAsset ?? xdrInner.send_asset) : renderAsset({ asset_code: op.source_asset_code, asset_issuer: op.source_asset_issuer, native: op.source_asset_type === 'native' });
    addLine(T('op-dest', 'Destination'), renderAccount(dest));
    addLine(T('op-receives', 'Receives'), `${destAmount} ${destAsset}`);
    addLine(T('op-spend-max', 'Send max'), `${sourceAmount} ${sourceAsset}`);
  } else if (type === 'path_payment_strict_send') {
    const dest = xdrInner ? xdrInner.destination : (op.to_muxed || op.to || op.to_muxed_id);
    const sendAmount = xdrInner ? formatStroopAmount(xdrInner.sendAmount ?? xdrInner.send_amount) : formatAmount(op.source_amount);
    const sendAsset = xdrInner ? renderAsset(xdrInner.sendAsset ?? xdrInner.send_asset) : renderAsset({ asset_code: op.source_asset_code, asset_issuer: op.source_asset_issuer, native: op.source_asset_type === 'native' });
    const destMin = xdrInner ? formatStroopAmount(xdrInner.destMin ?? xdrInner.dest_min) : formatAmount(op.destination_min);
    const destAsset = xdrInner ? renderAsset(xdrInner.destAsset ?? xdrInner.dest_asset) : renderAsset({ asset_code: op.asset_code || op.asset, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
    addLine(T('op-dest', 'Destination'), renderAccount(dest));
    addLine(T('op-sending', 'Sending'), `${sendAmount} ${sendAsset}`);
    addLine(T('op-expect-min', 'Expect min'), `${destMin} ${destAsset}`);
  } else if (type === 'create_account') {
    const amount = xdrInner ? formatStroopAmount(xdrInner.startingBalance ?? xdrInner.starting_balance) : formatAmount(op.starting_balance);
    const account = xdrInner ? xdrInner.destination : op.account;
    addLine(T('op-start-balance', 'Starting balance'), `${amount} XLM`);
    addLine(T('op-new-acc', 'New account'), renderAccount(account));
  } else if (type === 'manage_sell_offer' || type === 'manage_buy_offer' || type === 'create_passive_sell_offer') {
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const selling = xdrInner ? renderAsset(xdrInner.selling) : renderAsset({ asset_code: op.selling_asset_code, asset_issuer: op.selling_asset_issuer, native: op.selling_asset_type === 'native' });
    const buying = xdrInner ? renderAsset(xdrInner.buying) : renderAsset({ asset_code: op.buying_asset_code, asset_issuer: op.buying_asset_issuer, native: op.buying_asset_type === 'native' });
    const price = xdrInner && xdrInner.price ? `${xdrInner.price.n}/${xdrInner.price.d}` : (op.price || '—');
    addLine(T('op-selling', 'Selling'), `${amount} ${selling}`);
    addLine(T('op-buying', 'Buying'), buying);
    addLine(T('op-price', 'Price'), price);
    const offerId = getOfferId(op, xdrInner);
    if (offerId) {
        addLine(T('op-offer-id', 'Offer ID'), `<a href="/offer/${offerId}">${offerId}</a>`);
    }
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
    addLine(T('op-domain', 'Domain'), homeDomain || '—');
    addLine(T('op-inflation-dest', 'Inflation dest'), inflation ? renderAccount(inflation, { short: false }) : '—');
    addLine(T('op-thresholds', 'Thresholds'), `low: ${thresholds.low ?? '—'}, med: ${thresholds.med ?? '—'}, high: ${thresholds.high ?? '—'}`);
    addLine(T('op-master-weight', 'Master weight'), thresholds.master ?? '—');
    if (set !== undefined) addLine(T('op-set-flags', 'Set flags'), set);
    if (clear !== undefined) addLine(T('op-clear-flags', 'Clear flags'), clear);
    const signer = xdrInner ? xdrInner.signer : (op.signer_key ? { key: op.signer_key, weight: op.signer_weight } : null);
    if (signer) {
      const key = signer.ed25519 || signer.preAuthTx || signer.hashX || signer.key || signer.ed25519PublicKey || signer.sha256Hash;
      addLine(T('op-signer', 'Signer'), `${key || '—'} (weight ${signer.weight ?? signer.signer_weight ?? '—'})`);
    }
  } else if (type === 'change_trust') {
    const isPool = op.asset_type === 'liquidity_pool_shares' ||
                   op.liquidity_pool_id ||
                   (xdrInner && (xdrInner.line?.liquidityPoolId || xdrInner.line?.liquidity_pool_id));

    if (isPool) {
      const poolId = xdrInner
        ? (xdrInner.line?.liquidityPoolId || xdrInner.line?.liquidity_pool_id)
        : op.liquidity_pool_id;
      const label = poolId ? `<a href="/pool/${poolId}">${shorten(poolId)}</a>` : '—';
      const limit = xdrInner ? formatStroopAmount(xdrInner.limit) : (op.limit || '—');
      addLine(T('op-trust-pool', 'Trust Liquidity Pool'), label);
      addLine(T('op-limit', 'Limit'), limit);
    } else {
      const asset = xdrInner ? renderAsset(xdrInner.line) : renderAsset({ asset_code: op.asset_code, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
      const limit = xdrInner ? formatStroopAmount(xdrInner.limit) : (op.limit || '—');
      addLine(T('op-trust-asset', 'Trust asset'), asset);
      addLine(T('op-limit', 'Limit'), limit);
    }
  } else if (type === 'allow_trust') {
    const trustor = xdrInner ? xdrInner.trustor : op.trustor;
    const asset = xdrInner ? renderAsset(xdrInner.asset) : renderAsset({ asset_code: op.asset_code, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
    const auth = op.authorize !== undefined ? op.authorize : xdrInner?.authorize;
    addLine(T('op-trustor', 'Trustor'), renderAccount(trustor));
    addLine(T('op-asset', 'Asset'), asset);
    addLine(T('op-auth', 'Authorized'), auth ? T('op-auth-yes', 'Yes') : T('op-auth-no', 'No'));
  } else if (type === 'account_merge') {
    const dest = xdrInner && xdrInner.destination
        ? xdrInner.destination
        : (typeof xdrInner === 'string' || (xdrInner && xdrInner.ed25519) ? xdrInner : (op.into || op.account || op.account_merge_dest));
    addLine(T('op-merge-to', 'Merge into'), renderAccount(dest, { short: false }));
  } else if (type === 'inflation') {
    addLine(T('op-inflation', 'Run inflation'), '');
  } else if (type === 'manage_data') {
    const name = xdrInner ? (xdrInner.dataName ?? xdrInner.data_name) : op.data_name;
    const valueRaw = xdrInner ? (xdrInner.dataValue ?? xdrInner.data_value) : op.data_value;
    const decoded = parseDataValue(valueRaw);
    addLine(T('op-data-name', 'Name'), name || '—');
    addLine(T('op-data-val-raw', 'Value (raw)'), valueRaw || '—');
    if (decoded.decodedText) {
      addLine(T('op-data-val-str', 'Value (string)'), decoded.decodedText);
    }
    if (decoded.hex) {
      addLine(T('op-data-val-hex', 'Value (hex)'), decoded.hex);
    }
  } else if (type === 'bump_sequence') {
    const bump = xdrInner ? (xdrInner.bumpTo ?? xdrInner.bump_to) : op.bump_to;
    addLine(T('op-bump-seq', 'Bump to'), bump || '—');
  } else if (type === 'create_claimable_balance') {
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const asset = xdrInner ? renderAsset(xdrInner.asset) : renderAsset({ asset_code: op.asset_code || op.asset, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
    const claimants = xdrInner ? xdrInner.claimants : op.claimants;
    addLine(T('op-amount', 'Amount'), `${amount} ${asset}`);
    addLine(T('op-claimants', 'Claimants'), renderClaimants(claimants));
  } else if (type === 'claim_claimable_balance') {
    const id = xdrInner ? (xdrInner.balanceId ?? xdrInner.balance_id) : op.balance_id;
    addLine(T('op-balance-id', 'Balance ID'), id || '—');
  } else if (type === 'begin_sponsoring_future_reserves') {
    const sponsored = xdrInner
      ? (xdrInner.sponsoredId || xdrInner.sponsoredID || xdrInner.sponsored_id)
      : op.sponsored_id;
    addLine(T('op-sponsored', 'Sponsored'), renderAccount(sponsored));
  } else if (type === 'end_sponsoring_future_reserves') {
    const sponsored = op.sponsored_id || xdrInner?.sponsoredId || xdrInner?.sponsoredID || xdrInner?.sponsored_id;
    addLine(T('op-sponsor-end', 'End sponsoring future reserves'), '');
    if (sponsored) addLine(T('op-sponsored', 'Sponsored'), renderAccount(sponsored));
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
    addLine(T('op-sponsor-revoke', 'Revoke sponsorship'), targetDesc || JSON.stringify(xdrInner || op));
  } else if (type === 'clawback') {
    const from = xdrInner ? xdrInner.from : op.from;
    const amount = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.amount);
    const asset = xdrInner ? renderAsset(xdrInner.asset) : renderAsset({ asset_code: op.asset_code || op.asset, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
    addLine(T('op-clawback-from', 'Clawback from'), renderAccount(from));
    addLine(T('op-amount', 'Amount'), `${amount} ${asset}`);
  } else if (type === 'clawback_claimable_balance') {
    const id = xdrInner ? (xdrInner.balanceId ?? xdrInner.balance_id) : op.balance_id;
    addLine(T('op-balance-id', 'Balance ID'), id || '—');
  } else if (type === 'set_trust_line_flags') {
    const trustor = xdrInner ? xdrInner.trustor : op.trustor;
    const asset = xdrInner ? renderAsset(xdrInner.asset) : renderAsset({ asset_code: op.asset_code, asset_issuer: op.asset_issuer, native: op.asset_type === 'native' });
    addLine(T('op-trustor', 'Trustor'), renderAccount(trustor));
    addLine(T('op-asset', 'Asset'), asset);
    const authorize = op.authorize ?? xdrInner?.authorize ?? xdrInner?.setFlags;
    const maintain = op.authorize_to_maintain_liabilities ?? xdrInner?.authorizeToMaintainLiabilities;
    const clawback = op.clawback_enabled ?? xdrInner?.clawbackEnabled;
    const clear = op.clear_flags ?? op.clear_flags_s ?? xdrInner?.clearFlags ?? xdrInner?.clear_flags;
    const set = op.set_flags ?? op.set_flags_s ?? xdrInner?.setFlags ?? xdrInner?.set_flags;
    addLine(T('op-flags', 'Flags'), `set: ${set ?? '—'}, clear: ${clear ?? '—'}, auth: ${authorize ?? '—'}, maintain: ${maintain ?? '—'}, clawback: ${clawback ?? '—'}`);
  } else if (type === 'liquidity_pool_deposit') {
    const pool = xdrInner ? (xdrInner.liquidityPoolId ?? xdrInner.liquidity_pool_id) : op.liquidity_pool_id;

    let maxA = null;
    let maxB = null;

    if (xdrInner) {
      maxA = formatStroopAmount(xdrInner.maxAmountA ?? xdrInner.max_amount_a);
      maxB = formatStroopAmount(xdrInner.maxAmountB ?? xdrInner.max_amount_b);
    } else {
      // Horizon can return arrays for reserves_max
      if (Array.isArray(op.reserves_max) && op.reserves_max.length === 2) {
        maxA = formatAmount(op.reserves_max[0].amount);
        maxB = formatAmount(op.reserves_max[1].amount);
      } else {
        maxA = formatAmount(op.reserves_max_a);
        maxB = formatAmount(op.reserves_max_b);
      }
    }

    const minPrice = xdrInner ? formatPriceObj(xdrInner.minPrice ?? xdrInner.min_price) : formatPriceObj(op.min_price);
    const maxPrice = xdrInner ? formatPriceObj(xdrInner.maxPrice ?? xdrInner.max_price) : formatPriceObj(op.max_price);
    addLine(T('op-pool', 'Pool'), pool || '—');
    addLine(T('op-max-res-a', 'Max res A'), maxA || '—');
    addLine(T('op-max-res-b', 'Max res B'), maxB || '—');
    addLine(T('op-min-price', 'Min price'), minPrice);
    addLine(T('op-max-price', 'Max price'), maxPrice);

    let depA = op.reserves_deposited_a;
    let depB = op.reserves_deposited_b;

    if (Array.isArray(op.reserves_deposited) && op.reserves_deposited.length === 2) {
      depA = formatAmount(op.reserves_deposited[0].amount);
      depB = formatAmount(op.reserves_deposited[1].amount);
    }

    if (depA) addLine(T('op-deposited-a', 'Deposited A'), depA);
    if (depB) addLine(T('op-deposited-b', 'Deposited B'), depB);
    if (op.shares_received) addLine(T('op-shares-received', 'Shares received'), op.shares_received);
  } else if (type === 'liquidity_pool_withdraw') {
    const pool = xdrInner ? (xdrInner.liquidityPoolId ?? xdrInner.liquidity_pool_id) : op.liquidity_pool_id;
    const shares = xdrInner ? formatStroopAmount(xdrInner.amount) : formatAmount(op.shares);
    const minA = xdrInner ? formatStroopAmount(xdrInner.minAmountA ?? xdrInner.min_amount_a) : formatAmount(op.reserves_min_a);
    const minB = xdrInner ? formatStroopAmount(xdrInner.minAmountB ?? xdrInner.min_amount_b) : formatAmount(op.reserves_min_b);
    addLine(T('op-pool', 'Pool'), pool || '—');
    addLine(T('op-shares-burn', 'Burn shares'), shares);
    addLine(T('op-min-res-a', 'Min res A'), minA);
    addLine(T('op-min-res-b', 'Min res B'), minB);
    if (op.reserves_received_a) addLine(T('op-received-a', 'Received A'), op.reserves_received_a);
    if (op.reserves_received_b) addLine(T('op-received-b', 'Received B'), op.reserves_received_b);
  } else if (type === 'invoke_host_function') {
    renderInvokeHostFunction(container, op, T);
  } else {
    const raw = xdrInner || op;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(raw, null, 2);
    container.appendChild(pre);
  }

  return container;
}

export function renderOperationComponent(op, t, opts = {}) {
  // Options defaults
  const {
    showTransactionLink = true,
    showSource = true,
    forceSuccessStatus = null, // boolean or null (auto)
    index = null, // for #1, #2 numbering
    allowLoadEffects = true, // show load effects button?
    contextSource = null // implicit source to compare against
  } = opts;

  const box = document.createElement('div');
  box.className = 'box is-size-7 op-card';

  // Determine success status
  // If forceSuccessStatus is provided, use it. Otherwise derive from op properties.
  let successful = true;
  if (forceSuccessStatus !== null) {
    successful = forceSuccessStatus;
  } else {
    // Horizon op records usually have transaction_successful boolean
    // Parsed XDR might have successful boolean
    if (op.transaction_successful === false || op.successful === false || op.success === false) {
      successful = false;
    }
  }

  const statusTag = renderStatusTag(successful, t);
  if (!successful) box.classList.add('is-failed');

  const typeKey = getOpType(op);
  const typeLabel = t ? t(typeKey) : typeKey;

  // Header Construction
  const header = document.createElement('p');
  let headerHTML = '';
  if (index !== null) {
    headerHTML += `<strong>#${index + 1}</strong> · `;
  }
  headerHTML += `<strong>${typeLabel}</strong>`;
  if (op.created_at) {
    headerHTML += ` · ${op.created_at}`;
  }
  headerHTML += statusTag;
  header.innerHTML = headerHTML;
  box.appendChild(header);

  const T = (k, f) => resolveT(t, k, f);

  // Source Account
  if (showSource) {
    const opSource = op.source_account || op.sourceAccount || contextSource;
    if (opSource) {
      const srcP = document.createElement('p');
      srcP.className = 'is-size-7 mt-1';
      const srcLink = accountLink(opSource);
      // If we have a contextSource and it matches opSource, we might want to hide it or show "same"?
      // But user requested "unified", so let's stick to showing it clearly.
      // Although transaction view showed "Operation source: ..."
      // And account view showed "Source: ..."

      // Let's standardize on "Source: <link>"
      const label = T('source-label', 'Source:');
      srcP.innerHTML = `${label} ${renderAccount(opSource, { short: false })}`;
      box.appendChild(srcP);
    }
  }

  // Transaction Link
  if (showTransactionLink && op.transaction_hash) {
    const txP = document.createElement('p');
    txP.className = 'is-size-7';
    txP.innerHTML = `Transaction: <a class="is-mono" href="/transaction/${op.transaction_hash}">${shorten(op.transaction_hash)}</a>`;
    box.appendChild(txP);
  }

  // Details
  const details = renderOperationDetails(op, t);
  details.classList.add('mt-2');
  box.appendChild(details);

  // Load Effects Button
  // Only if allowLoadEffects is true AND we have an ID to fetch with
  const opId = op.id; // Horizon ID
  if (allowLoadEffects && opId) {
    const effectsContainer = document.createElement('div');
    effectsContainer.className = 'mt-2';
    // Border top separator to separate details from actions
    effectsContainer.style.borderTop = '1px dashed #eee';
    effectsContainer.style.paddingTop = '0.5rem';

    const btn = document.createElement('a');
    btn.className = 'button is-small is-ghost pl-0';
    btn.textContent = T('load-effects', 'Load effects / Details');

    // Icon? Maybe. Let's keep it simple text for now as per previous design.

    let loaded = false;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (loaded) return;
      btn.classList.add('is-loading');

      try {
        const horizonBase = getHorizonURL();
        const res = await fetch(`${horizonBase}/operations/${opId}/effects`);
        if (!res.ok) throw new Error(`Effects load error ${res.status}`);
        const json = await res.json();
        const effectsData = json._embedded ? json._embedded.records : [];

        btn.remove();
        effectsContainer.appendChild(renderEffects(effectsData, t));
        loaded = true;
      } catch (err) {
        console.error(err);
        btn.classList.remove('is-loading');
        btn.textContent = t('error-unknown');
      }
    });

    effectsContainer.appendChild(btn);
    box.appendChild(effectsContainer);
  }

  return box;
}

// Deprecated wrappers for backward compatibility during refactor (or to be removed if I hit all files)
export function createOperationCard(op, t) {
  return renderOperationComponent(op, t, {
    showTransactionLink: true,
    showSource: true,
    forceSuccessStatus: null, // infer
    allowLoadEffects: true
  });
}

export function renderEffects(effects, t) {
  const container = document.createElement('div');
  container.className = 'box mt-4 is-size-7';

  if (!effects || effects.length === 0) {
    container.textContent = '—';
    return container;
  }

  effects.forEach((e, idx) => {
    const wrapper = document.createElement('div');
    if (idx > 0) {
      wrapper.className = 'mt-2 pt-2';
      wrapper.style.borderTop = '1px solid #eee';
    }

    const getAsset = (prefix = '') => {
      const type = e[`${prefix}asset_type`];
      if (type === 'native') return 'native';
      return {
        asset_code: e[`${prefix}asset_code`],
        asset_issuer: e[`${prefix}asset_issuer`]
      };
    };

    let content = '';
    if (e.type === 'account_credited') {
      const amt = formatAmount(e.amount);
      const asset = renderAsset(getAsset());
      const acc = renderAccount(e.account);
      content = `<strong>${t('effect-credited')}:</strong> ${amt} ${asset} <span class="mx-1">→</span> ${acc}`;
    } else if (e.type === 'account_debited') {
      const amt = formatAmount(e.amount);
      const asset = renderAsset(getAsset());
      const acc = renderAccount(e.account);
      content = `<strong>${t('effect-debited')}:</strong> ${amt} ${asset} <span class="mx-1">@</span> ${acc}`;
    } else if (e.type === 'trade') {
      const soldAmt = formatAmount(e.sold_amount);
      const soldAsset = renderAsset(getAsset('sold_'));
      const boughtAmt = formatAmount(e.bought_amount);
      const boughtAsset = renderAsset(getAsset('bought_'));
      content = `<strong>${t('effect-trade')}:</strong> ${t('effect-sold')} ${soldAmt} ${soldAsset} <span class="mx-1">→</span> ${t('effect-bought')} ${boughtAmt} ${boughtAsset}`;

      if (e.seller || e.offer_id) {
        content += `<br><span class="is-size-7 has-text-grey">`;
        if (e.seller) {
            content += `${t('effect-counterparty', 'Counterparty')}: ${renderAccount(e.seller)} `;
        }
        if (e.offer_id) {
            content += `(${t('effect-offer-id', 'Offer ID')} ${e.offer_id})`;
        }
        content += `</span>`;
      }
    } else if (e.type === 'liquidity_pool_trade') {
      const poolId = e.liquidity_pool ? e.liquidity_pool.id : null;
      const poolLink = poolId ? `<a href="/pool/${poolId}">${shorten(poolId)}</a>` : '—';

      const parseAsset = (str) => {
        if (!str || str === 'native') return 'native';
        const parts = str.split(':');
        if (parts.length === 2) return { asset_code: parts[0], asset_issuer: parts[1] };
        return str;
      };

      const soldAmt = formatAmount(e.sold ? e.sold.amount : '0');
      const soldAsset = renderAsset(parseAsset(e.sold ? e.sold.asset : null));
      const boughtAmt = formatAmount(e.bought ? e.bought.amount : '0');
      const boughtAsset = renderAsset(parseAsset(e.bought ? e.bought.asset : null));

      content = `<strong>${t('effect-lp-trade', 'Liquidity Pool Trade')}</strong> (${poolLink})` +
                `<br>${t('effect-sold')} ${soldAmt} ${soldAsset} <span class="mx-1">→</span> ${t('effect-bought')} ${boughtAmt} ${boughtAsset}`;
    } else if (e.type === 'liquidity_pool_deposited') {
      const poolId = e.liquidity_pool ? e.liquidity_pool.id : null;
      const poolLink = poolId ? `<a href="/pool/${poolId}">${shorten(poolId)}</a>` : '—';
      const shares = formatAmount(e.shares_received);

      let reservesHtml = '';
      if (Array.isArray(e.reserves_deposited)) {
        reservesHtml = e.reserves_deposited.map(r => {
           const assetStr = r.asset;
           let assetObj = null;
           if (assetStr === 'native') assetObj = 'native';
           else {
             const parts = assetStr.split(':');
             if (parts.length === 2) assetObj = { asset_code: parts[0], asset_issuer: parts[1] };
             else assetObj = assetStr;
           }
           return `<div>+ ${formatAmount(r.amount)} ${renderAsset(assetObj)}</div>`;
        }).join('');
      }

      content = `<strong>${t('effect-lp-deposited', 'Liquidity Pool Deposit')}</strong> (${poolLink})` +
                `<br>${t('effect-shares-received', 'Shares received')}: ${shares}` +
                `<br><div class="pl-2 mt-1" style="border-left: 2px solid #f5f5f5">${reservesHtml}</div>`;

    } else if (e.type === 'liquidity_pool_withdrew') {
      const poolId = e.liquidity_pool ? e.liquidity_pool.id : null;
      const poolLink = poolId ? `<a href="/pool/${poolId}">${shorten(poolId)}</a>` : '—';
      const shares = formatAmount(e.shares_revoked);

      let reservesHtml = '';
      if (Array.isArray(e.reserves_received)) {
        reservesHtml = e.reserves_received.map(r => {
           const assetStr = r.asset;
           let assetObj = null;
           if (assetStr === 'native') assetObj = 'native';
           else {
             const parts = assetStr.split(':');
             if (parts.length === 2) assetObj = { asset_code: parts[0], asset_issuer: parts[1] };
             else assetObj = assetStr;
           }
           return `<div>+ ${formatAmount(r.amount)} ${renderAsset(assetObj)}</div>`;
        }).join('');
      }

      content = `<strong>${t('effect-lp-withdrew', 'Liquidity Pool Withdraw')}</strong> (${poolLink})` +
                `<br>${t('effect-shares-revoked', 'Shares revoked')}: ${shares}` +
                `<br><div class="pl-2 mt-1" style="border-left: 2px solid #f5f5f5">${reservesHtml}</div>`;
    } else if (e.type === 'account_sponsorship_removed') {
      const former = e.former_sponsor ? renderAccount(e.former_sponsor) : '—';
      content = `<strong>${t('effect-sponsorship-removed', 'Sponsorship removed')}</strong>` +
                `<br>${t('effect-former-sponsor', 'Former sponsor')}: ${former}`;
    } else if (e.type === 'account_removed') {
      content = `<strong>${t('effect-account-removed', 'Account removed')}</strong>`;
    } else {
      content = `<strong>${e.type}</strong> <span class="is-italic has-text-grey-light">${e.id}</span>`;
    }

    wrapper.innerHTML = content;
    container.appendChild(wrapper);
  });

  return container;
}

