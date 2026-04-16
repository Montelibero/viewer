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

// ---- Canonical operation normalization ------------------------------------
// All views (account-operations, transaction, pool-operations, operation)
// pass raw ops (Horizon JSON or stellar-xdr-json-decoded) into render. The
// rendering pipeline calls normalizeOperation once at entry and then reads
// ONLY from the canonical object. Do not add `xdrInner ? ... : op....`
// branches inside the renderer — put the field extraction here instead.

function assetFromHorizon(op, prefix = '') {
  const p = prefix ? `${prefix}_` : '';
  const code = op[`${p}asset_code`] ?? (prefix ? undefined : op.asset);
  const issuer = op[`${p}asset_issuer`];
  const type = op[`${p}asset_type`];
  if (!code && type !== 'native') return null;
  return { asset_code: code, asset_issuer: issuer, native: type === 'native' };
}

function toSnakeCase(s) {
  return String(s || '').replace(/[A-Z]/g, (c, i) => (i > 0 ? '_' : '') + c.toLowerCase());
}

function pickField(xdrInner, xdrKeys, op, horizonKeys) {
  if (xdrInner) {
    for (const k of xdrKeys) {
      if (xdrInner[k] !== undefined && xdrInner[k] !== null) return xdrInner[k];
    }
  }
  if (op) {
    for (const k of horizonKeys) {
      if (op[k] !== undefined && op[k] !== null) return op[k];
    }
  }
  return null;
}

function pickAmount(xdrInner, xdrKeys, op, horizonKey) {
  if (xdrInner) {
    for (const k of xdrKeys) {
      if (xdrInner[k] !== undefined && xdrInner[k] !== null) return formatStroopAmount(xdrInner[k]);
    }
  }
  if (op && horizonKey && op[horizonKey] !== undefined && op[horizonKey] !== null) {
    return String(op[horizonKey]);
  }
  return null;
}

export function normalizeOperation(rawOp) {
  if (!rawOp) return null;
  if (rawOp._canonical) return rawOp;

  const op = rawOp;
  const isXdrEmpty = typeof op.body === 'string';
  const isXdr = !op.type && op.body && !isXdrEmpty;

  let rawType;
  if (op.type) rawType = op.type;
  else if (isXdrEmpty) rawType = op.body;
  else if (isXdr) rawType = Object.keys(op.body)[0];
  else rawType = 'unknown';
  const type = toSnakeCase(rawType);

  const xdrInner = isXdr ? (op.body[rawType] || {}) : null;

  // Horizon can attach the parent transaction via ?join=transactions; also
  // allow flat memo fields in case another source flattened them.
  const tx = op.transaction || null;
  const memoType = op.memo_type ?? tx?.memo_type ?? null;
  const memoValue = op.memo ?? tx?.memo ?? null;

  const c = {
    _canonical: true,
    _raw: op,
    type,
    source: op.source_account ?? op.sourceAccount ?? null,
    successful: op.transaction_successful ?? op.successful ?? op.success ?? null,
    txHash: op.transaction_hash ?? op.transactionHash ?? null,
    opId: op.id ?? null,
    createdAt: op.created_at ?? op.createdAt ?? null,
    result: op.result ?? null,
    memoType: memoType && memoType !== 'none' ? memoType : null,
    memo: memoValue != null && memoValue !== '' ? String(memoValue) : null,
  };

  switch (type) {
    case 'payment':
      c.destination = pickField(xdrInner, ['destination'], op, ['to_muxed', 'to', 'to_muxed_id']);
      c.amount = xdrInner ? formatStroopAmount(xdrInner.amount) : op.amount;
      c.asset = xdrInner ? xdrInner.asset : assetFromHorizon(op);
      break;
    case 'path_payment_strict_receive':
      c.destination = pickField(xdrInner, ['destination'], op, ['to_muxed', 'to', 'to_muxed_id']);
      c.destAmount = pickAmount(xdrInner, ['destAmount', 'dest_amount'], op, 'amount');
      c.destAsset = xdrInner ? (xdrInner.destAsset ?? xdrInner.dest_asset) : assetFromHorizon(op);
      c.sendMax = pickAmount(xdrInner, ['sendMax', 'send_max'], op, 'source_amount');
      c.sendAsset = xdrInner ? (xdrInner.sendAsset ?? xdrInner.send_asset) : assetFromHorizon(op, 'source');
      break;
    case 'path_payment_strict_send':
      c.destination = pickField(xdrInner, ['destination'], op, ['to_muxed', 'to', 'to_muxed_id']);
      c.sendAmount = pickAmount(xdrInner, ['sendAmount', 'send_amount'], op, 'source_amount');
      c.sendAsset = xdrInner ? (xdrInner.sendAsset ?? xdrInner.send_asset) : assetFromHorizon(op, 'source');
      c.destMin = pickAmount(xdrInner, ['destMin', 'dest_min'], op, 'destination_min');
      c.destAsset = xdrInner ? (xdrInner.destAsset ?? xdrInner.dest_asset) : assetFromHorizon(op);
      break;
    case 'create_account':
      c.startingBalance = pickAmount(xdrInner, ['startingBalance', 'starting_balance'], op, 'starting_balance');
      c.newAccount = pickField(xdrInner, ['destination'], op, ['account']);
      break;
    case 'manage_sell_offer':
    case 'manage_buy_offer':
    case 'create_passive_sell_offer':
      c.amount = xdrInner ? formatStroopAmount(xdrInner.amount) : op.amount;
      c.selling = xdrInner ? xdrInner.selling : assetFromHorizon(op, 'selling');
      c.buying = xdrInner ? xdrInner.buying : assetFromHorizon(op, 'buying');
      c.price = xdrInner && xdrInner.price
        ? `${xdrInner.price.n}/${xdrInner.price.d}`
        : (op.price || null);
      c.offerId = getOfferId(op, xdrInner);
      break;
    case 'set_options':
      c.inflationDest = pickField(xdrInner, ['inflationDest', 'inflation_dest'], op, ['inflation_dest']);
      c.homeDomain = pickField(xdrInner, ['homeDomain', 'home_domain'], op, ['home_domain']);
      c.thresholds = {
        master: xdrInner ? (xdrInner.masterWeight ?? xdrInner.master_weight) : op.master_key_weight,
        low: xdrInner ? (xdrInner.lowThreshold ?? xdrInner.low_threshold) : op.low_threshold,
        med: xdrInner ? (xdrInner.medThreshold ?? xdrInner.med_threshold) : op.med_threshold,
        high: xdrInner ? (xdrInner.highThreshold ?? xdrInner.high_threshold) : op.high_threshold,
      };
      c.setFlags = pickField(xdrInner, ['setFlags', 'set_flags'], op, ['set_flags_s', 'set_flags']);
      c.clearFlags = pickField(xdrInner, ['clearFlags', 'clear_flags'], op, ['clear_flags_s', 'clear_flags']);
      c.signer = xdrInner
        ? xdrInner.signer
        : (op.signer_key ? { key: op.signer_key, weight: op.signer_weight } : null);
      break;
    case 'change_trust': {
      const isPool = op.asset_type === 'liquidity_pool_shares'
        || !!op.liquidity_pool_id
        || !!(xdrInner && (xdrInner.line?.liquidityPoolId || xdrInner.line?.liquidity_pool_id));
      c.isPool = isPool;
      c.poolId = isPool
        ? (xdrInner?.line?.liquidityPoolId || xdrInner?.line?.liquidity_pool_id || op.liquidity_pool_id)
        : null;
      c.line = !isPool ? (xdrInner ? xdrInner.line : assetFromHorizon(op)) : null;
      c.limit = xdrInner ? formatStroopAmount(xdrInner.limit) : (op.limit || null);
      break;
    }
    case 'allow_trust':
      c.trustor = pickField(xdrInner, ['trustor'], op, ['trustor']);
      c.asset = xdrInner ? xdrInner.asset : assetFromHorizon(op);
      c.authorized = op.authorize !== undefined ? op.authorize : xdrInner?.authorize;
      break;
    case 'account_merge':
      c.mergeInto = (xdrInner && xdrInner.destination)
        || (typeof xdrInner === 'string' ? xdrInner : null)
        || op.into || op.account || op.account_merge_dest || null;
      break;
    case 'inflation':
      break;
    case 'manage_data': {
      c.name = pickField(xdrInner, ['dataName', 'data_name'], op, ['data_name']);
      c.valueRaw = pickField(xdrInner, ['dataValue', 'data_value'], op, ['data_value']);
      const decoded = parseDataValue(c.valueRaw);
      c.valueText = decoded.decodedText || null;
      c.valueHex = decoded.hex || null;
      break;
    }
    case 'bump_sequence':
      c.bumpTo = pickField(xdrInner, ['bumpTo', 'bump_to'], op, ['bump_to']);
      break;
    case 'create_claimable_balance':
      c.amount = xdrInner ? formatStroopAmount(xdrInner.amount) : op.amount;
      c.asset = xdrInner ? xdrInner.asset : assetFromHorizon(op);
      c.claimants = xdrInner ? xdrInner.claimants : op.claimants;
      break;
    case 'claim_claimable_balance':
    case 'clawback_claimable_balance':
      c.balanceId = pickField(xdrInner, ['balanceId', 'balance_id'], op, ['balance_id']);
      break;
    case 'begin_sponsoring_future_reserves':
    case 'end_sponsoring_future_reserves':
      c.sponsored = pickField(xdrInner, ['sponsoredId', 'sponsoredID', 'sponsored_id'], op, ['sponsored_id']);
      break;
    case 'revoke_sponsorship':
      c.target = pickField(
        xdrInner,
        ['accountId', 'account_id', 'claimableBalanceId', 'claimable_balance_id', 'liquidityPoolId', 'liquidity_pool_id'],
        op,
        ['account_id', 'trustline_account_id', 'signer_account_id', 'data_account_id', 'claimable_balance_id', 'liquidity_pool_id', 'offer_id']
      );
      c.dataName = pickField(xdrInner, ['dataName', 'data_name'], op, ['data_name']);
      c.signerKey = pickField(xdrInner, ['signerKey', 'signer_key'], op, ['signer_key']);
      c.trustlineAsset = op.trustline_asset
        ?? xdrInner?.trustLine?.asset ?? xdrInner?.trustLine?.assetId
        ?? xdrInner?.trust_line?.asset ?? xdrInner?.trust_line?.asset_id
        ?? null;
      c.offerId = op.offer_id || null;
      c.claimableBalanceId = op.claimable_balance_id || null;
      c.liquidityPoolId = op.liquidity_pool_id || null;
      break;
    case 'clawback':
      c.from = pickField(xdrInner, ['from'], op, ['from']);
      c.amount = xdrInner ? formatStroopAmount(xdrInner.amount) : op.amount;
      c.asset = xdrInner ? xdrInner.asset : assetFromHorizon(op);
      break;
    case 'set_trust_line_flags':
      c.trustor = pickField(xdrInner, ['trustor'], op, ['trustor']);
      c.asset = xdrInner ? xdrInner.asset : assetFromHorizon(op);
      c.authorize = op.authorize ?? xdrInner?.authorize ?? xdrInner?.setFlags;
      c.authorizeMaintain = op.authorize_to_maintain_liabilities ?? xdrInner?.authorizeToMaintainLiabilities;
      c.clawbackEnabled = op.clawback_enabled ?? xdrInner?.clawbackEnabled;
      c.setFlags = pickField(xdrInner, ['setFlags', 'set_flags'], op, ['set_flags', 'set_flags_s']);
      c.clearFlags = pickField(xdrInner, ['clearFlags', 'clear_flags'], op, ['clear_flags', 'clear_flags_s']);
      break;
    case 'liquidity_pool_deposit':
      c.poolId = pickField(xdrInner, ['liquidityPoolId', 'liquidity_pool_id'], op, ['liquidity_pool_id']);
      if (xdrInner) {
        c.maxA = formatStroopAmount(xdrInner.maxAmountA ?? xdrInner.max_amount_a);
        c.maxB = formatStroopAmount(xdrInner.maxAmountB ?? xdrInner.max_amount_b);
      } else if (Array.isArray(op.reserves_max) && op.reserves_max.length === 2) {
        c.maxA = op.reserves_max[0].amount;
        c.maxB = op.reserves_max[1].amount;
      } else {
        c.maxA = op.reserves_max_a || null;
        c.maxB = op.reserves_max_b || null;
      }
      c.minPrice = xdrInner
        ? formatPriceObj(xdrInner.minPrice ?? xdrInner.min_price)
        : formatPriceObj(op.min_price);
      c.maxPrice = xdrInner
        ? formatPriceObj(xdrInner.maxPrice ?? xdrInner.max_price)
        : formatPriceObj(op.max_price);
      if (Array.isArray(op.reserves_deposited) && op.reserves_deposited.length === 2) {
        c.depositedA = op.reserves_deposited[0].amount;
        c.depositedB = op.reserves_deposited[1].amount;
      } else {
        c.depositedA = op.reserves_deposited_a || null;
        c.depositedB = op.reserves_deposited_b || null;
      }
      c.sharesReceived = op.shares_received || null;
      break;
    case 'liquidity_pool_withdraw':
      c.poolId = pickField(xdrInner, ['liquidityPoolId', 'liquidity_pool_id'], op, ['liquidity_pool_id']);
      c.shares = xdrInner ? formatStroopAmount(xdrInner.amount) : op.shares;
      c.minA = xdrInner ? formatStroopAmount(xdrInner.minAmountA ?? xdrInner.min_amount_a) : op.reserves_min_a;
      c.minB = xdrInner ? formatStroopAmount(xdrInner.minAmountB ?? xdrInner.min_amount_b) : op.reserves_min_b;
      c.receivedA = op.reserves_received_a || null;
      c.receivedB = op.reserves_received_b || null;
      break;
    case 'invoke_host_function':
      c.invokeContract = normalizeInvokeContract(op);
      c.balanceChanges = Array.isArray(op.asset_balance_changes) ? op.asset_balance_changes : [];
      c.hostFunctionName = op.function || null;
      break;
  }

  return c;
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

function renderInvokeHostFunction(container, c, T) {
  const call = c.invokeContract;

  if (call) {
    const contractHtml = formatScValInline(call.contract);
    const fnName = call.fnName ? escapeHtml(call.fnName) : '?';
    const argsHtml = call.args.map(a => formatScValInline(a)).join(', ');

    const callP = document.createElement('p');
    callP.className = 'is-mono';
    callP.innerHTML = `${contractHtml}.<strong>${fnName}</strong>(${argsHtml})`;
    container.appendChild(callP);
  } else if (c.hostFunctionName) {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${T('op-host-fn', 'Function')}:</strong> ${escapeHtml(c.hostFunctionName)}`;
    container.appendChild(p);
  }

  (c.balanceChanges || []).forEach(ch => {
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
  pre.textContent = JSON.stringify(cleanXdrJson(c._raw), null, 2);
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

export function renderOperationDetails(rawOp, t) {
  const c = normalizeOperation(rawOp);
  const container = document.createElement('div');
  container.className = 'is-size-7';

  const addLine = (label, value) => {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${label}:</strong> ${value}`;
    container.appendChild(p);
  };

  const T = (k, f) => resolveT(t, k, f);

  switch (c.type) {
    case 'payment':
      addLine(T('op-amount', 'Amount'), `${c.amount ?? '—'} ${renderAsset(c.asset)}`);
      addLine(T('op-dest', 'Destination'), renderAccount(c.destination));
      break;
    case 'path_payment_strict_receive':
      addLine(T('op-dest', 'Destination'), renderAccount(c.destination));
      addLine(T('op-receives', 'Receives'), `${c.destAmount ?? '—'} ${renderAsset(c.destAsset)}`);
      addLine(T('op-spend-max', 'Send max'), `${c.sendMax ?? '—'} ${renderAsset(c.sendAsset)}`);
      break;
    case 'path_payment_strict_send':
      addLine(T('op-dest', 'Destination'), renderAccount(c.destination));
      addLine(T('op-sending', 'Sending'), `${c.sendAmount ?? '—'} ${renderAsset(c.sendAsset)}`);
      addLine(T('op-expect-min', 'Expect min'), `${c.destMin ?? '—'} ${renderAsset(c.destAsset)}`);
      break;
    case 'create_account':
      addLine(T('op-start-balance', 'Starting balance'), `${c.startingBalance ?? '—'} XLM`);
      addLine(T('op-new-acc', 'New account'), renderAccount(c.newAccount));
      break;
    case 'manage_sell_offer':
    case 'manage_buy_offer':
    case 'create_passive_sell_offer':
      addLine(T('op-selling', 'Selling'), `${c.amount ?? '—'} ${renderAsset(c.selling)}`);
      addLine(T('op-buying', 'Buying'), renderAsset(c.buying));
      addLine(T('op-price', 'Price'), c.price ?? '—');
      if (c.offerId) {
        addLine(T('op-offer-id', 'Offer ID'), `<a href="/offer/${c.offerId}">${c.offerId}</a>`);
      }
      break;
    case 'set_options': {
      addLine(T('op-domain', 'Domain'), c.homeDomain || '—');
      addLine(T('op-inflation-dest', 'Inflation dest'),
        c.inflationDest ? renderAccount(c.inflationDest, { short: false }) : '—');
      addLine(T('op-thresholds', 'Thresholds'),
        `low: ${c.thresholds.low ?? '—'}, med: ${c.thresholds.med ?? '—'}, high: ${c.thresholds.high ?? '—'}`);
      addLine(T('op-master-weight', 'Master weight'), c.thresholds.master ?? '—');
      if (c.setFlags !== null && c.setFlags !== undefined) addLine(T('op-set-flags', 'Set flags'), c.setFlags);
      if (c.clearFlags !== null && c.clearFlags !== undefined) addLine(T('op-clear-flags', 'Clear flags'), c.clearFlags);
      if (c.signer) {
        const key = c.signer.ed25519 || c.signer.preAuthTx || c.signer.hashX
          || c.signer.key || c.signer.ed25519PublicKey || c.signer.sha256Hash;
        addLine(T('op-signer', 'Signer'),
          `${key || '—'} (weight ${c.signer.weight ?? c.signer.signer_weight ?? '—'})`);
      }
      break;
    }
    case 'change_trust':
      if (c.isPool) {
        const label = c.poolId ? `<a href="/pool/${c.poolId}">${shorten(c.poolId)}</a>` : '—';
        addLine(T('op-trust-pool', 'Trust Liquidity Pool'), label);
        addLine(T('op-limit', 'Limit'), c.limit || '—');
      } else {
        addLine(T('op-trust-asset', 'Trust asset'), renderAsset(c.line));
        addLine(T('op-limit', 'Limit'), c.limit || '—');
      }
      break;
    case 'allow_trust':
      addLine(T('op-trustor', 'Trustor'), renderAccount(c.trustor));
      addLine(T('op-asset', 'Asset'), renderAsset(c.asset));
      addLine(T('op-auth', 'Authorized'), c.authorized ? T('op-auth-yes', 'Yes') : T('op-auth-no', 'No'));
      break;
    case 'account_merge':
      addLine(T('op-merge-to', 'Merge into'), renderAccount(c.mergeInto, { short: false }));
      break;
    case 'inflation':
      addLine(T('op-inflation', 'Run inflation'), '');
      break;
    case 'manage_data':
      addLine(T('op-data-name', 'Name'), c.name || '—');
      addLine(T('op-data-val-raw', 'Value (raw)'), c.valueRaw || '—');
      if (c.valueText) addLine(T('op-data-val-str', 'Value (string)'), c.valueText);
      if (c.valueHex) addLine(T('op-data-val-hex', 'Value (hex)'), c.valueHex);
      break;
    case 'bump_sequence':
      addLine(T('op-bump-seq', 'Bump to'), c.bumpTo || '—');
      break;
    case 'create_claimable_balance':
      addLine(T('op-amount', 'Amount'), `${c.amount ?? '—'} ${renderAsset(c.asset)}`);
      addLine(T('op-claimants', 'Claimants'), renderClaimants(c.claimants));
      break;
    case 'claim_claimable_balance':
    case 'clawback_claimable_balance':
      addLine(T('op-balance-id', 'Balance ID'), c.balanceId || '—');
      break;
    case 'begin_sponsoring_future_reserves':
      addLine(T('op-sponsored', 'Sponsored'), renderAccount(c.sponsored));
      break;
    case 'end_sponsoring_future_reserves':
      addLine(T('op-sponsor-end', 'End sponsoring future reserves'), '');
      if (c.sponsored) addLine(T('op-sponsored', 'Sponsored'), renderAccount(c.sponsored));
      break;
    case 'revoke_sponsorship': {
      let desc = '';
      if (c.target && c.dataName) desc = `Data: ${renderAccount(c.target)} / ${c.dataName}`;
      else if (c.target && c.signerKey) desc = `Signer: ${renderAccount(c.target)} / ${c.signerKey}`;
      else if (c.target && c.trustlineAsset) {
        const assetStr = typeof c.trustlineAsset === 'object' ? renderAsset(c.trustlineAsset) : c.trustlineAsset;
        desc = `Trustline: ${renderAccount(c.target)} / ${assetStr}`;
      } else if (c.target) desc = renderAccount(c.target, { short: false });
      if (c.offerId) desc = `Offer ${c.offerId}`;
      if (c.claimableBalanceId) desc = `Claimable balance ${c.claimableBalanceId}`;
      if (c.liquidityPoolId) desc = `Liquidity pool ${c.liquidityPoolId}`;
      addLine(T('op-sponsor-revoke', 'Revoke sponsorship'), desc || '—');
      break;
    }
    case 'clawback':
      addLine(T('op-clawback-from', 'Clawback from'), renderAccount(c.from));
      addLine(T('op-amount', 'Amount'), `${c.amount ?? '—'} ${renderAsset(c.asset)}`);
      break;
    case 'set_trust_line_flags':
      addLine(T('op-trustor', 'Trustor'), renderAccount(c.trustor));
      addLine(T('op-asset', 'Asset'), renderAsset(c.asset));
      addLine(T('op-flags', 'Flags'),
        `set: ${c.setFlags ?? '—'}, clear: ${c.clearFlags ?? '—'}, auth: ${c.authorize ?? '—'}, maintain: ${c.authorizeMaintain ?? '—'}, clawback: ${c.clawbackEnabled ?? '—'}`);
      break;
    case 'liquidity_pool_deposit':
      addLine(T('op-pool', 'Pool'), c.poolId || '—');
      addLine(T('op-max-res-a', 'Max res A'), c.maxA || '—');
      addLine(T('op-max-res-b', 'Max res B'), c.maxB || '—');
      addLine(T('op-min-price', 'Min price'), c.minPrice);
      addLine(T('op-max-price', 'Max price'), c.maxPrice);
      if (c.depositedA) addLine(T('op-deposited-a', 'Deposited A'), c.depositedA);
      if (c.depositedB) addLine(T('op-deposited-b', 'Deposited B'), c.depositedB);
      if (c.sharesReceived) addLine(T('op-shares-received', 'Shares received'), c.sharesReceived);
      break;
    case 'liquidity_pool_withdraw':
      addLine(T('op-pool', 'Pool'), c.poolId || '—');
      addLine(T('op-shares-burn', 'Burn shares'), c.shares);
      addLine(T('op-min-res-a', 'Min res A'), c.minA);
      addLine(T('op-min-res-b', 'Min res B'), c.minB);
      if (c.receivedA) addLine(T('op-received-a', 'Received A'), c.receivedA);
      if (c.receivedB) addLine(T('op-received-b', 'Received B'), c.receivedB);
      break;
    case 'invoke_host_function':
      renderInvokeHostFunction(container, c, T);
      break;
    default: {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(cleanXdrJson(c._raw), null, 2);
      container.appendChild(pre);
    }
  }

  return container;
}

export function renderOperationComponent(rawOp, t, opts = {}) {
  const c = normalizeOperation(rawOp);
  const {
    showTransactionLink = true,
    showSource = true,
    forceSuccessStatus = null,
    index = null,
    allowLoadEffects = true,
    contextSource = null
  } = opts;

  const box = document.createElement('div');
  box.className = 'box is-size-7 op-card';

  let successful = true;
  if (forceSuccessStatus !== null) successful = forceSuccessStatus;
  else if (c.successful === false) successful = false;

  const statusTag = renderStatusTag(successful, t);
  if (!successful) box.classList.add('is-failed');

  const typeLabel = t ? t(c.type) : c.type;

  const header = document.createElement('p');
  let headerHTML = '';
  if (index !== null) headerHTML += `<strong>#${index + 1}</strong> · `;
  headerHTML += `<strong>${typeLabel}</strong>`;
  if (c.createdAt) headerHTML += ` · ${c.createdAt}`;
  headerHTML += statusTag;
  header.innerHTML = headerHTML;
  box.appendChild(header);

  const T = (k, f) => resolveT(t, k, f);

  if (showSource) {
    const opSource = c.source || contextSource;
    if (opSource) {
      const srcP = document.createElement('p');
      srcP.className = 'is-size-7 mt-1';
      const label = T('source-label', 'Source:');
      srcP.innerHTML = `${label} ${renderAccount(opSource, { short: false })}`;
      box.appendChild(srcP);
    }
  }

  if (showTransactionLink && c.txHash) {
    const txP = document.createElement('p');
    txP.className = 'is-size-7';
    txP.innerHTML = `Transaction: <a class="is-mono" href="/transaction/${c.txHash}">${shorten(c.txHash)}</a>`;
    box.appendChild(txP);
  }

  if (c.memo) {
    const memoP = document.createElement('p');
    memoP.className = 'is-size-7';
    const typeLabel = c.memoType ? ` <span class="has-text-grey">(${c.memoType})</span>` : '';
    memoP.innerHTML = `<strong>${T('memo-label', 'Memo')}:</strong>${typeLabel} <span class="is-mono">${escapeHtml(c.memo)}</span>`;
    box.appendChild(memoP);
  }

  const details = renderOperationDetails(c, t);
  details.classList.add('mt-2');
  box.appendChild(details);

  const opId = c.opId;
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

