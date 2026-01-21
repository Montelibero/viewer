import { getHorizonURL } from './common.js';

const horizonBase = getHorizonURL();

/**
 * Fetches assets that are paired with the given base asset in liquidity pools.
 * @param {string} code
 * @param {string} issuer
 * @param {number} limit
 * @returns {Promise<Array>} List of counter assets { code, issuer, type }
 */
async function fetchPoolCounterAssets(code, issuer, limit = 200) {
    const assetId = `${code}:${issuer}`;
    let nextUrl = `${horizonBase}/liquidity_pools?reserves=${assetId}&limit=200&order=asc`;
    let lastCursor = null;
    const pools = [];

    // Safety break
    let pages = 0;
    const maxPages = 5;

    while (nextUrl && pages < maxPages) {
        try {
            const res = await fetch(nextUrl);
            if (!res.ok) break;

            const data = await res.json();
            const records = data?._embedded?.records || [];
            pools.push(...records);

            if (!records.length) break;

            const nextHref = data?._links?.next?.href;
            if (!nextHref) break;
            const parsed = new URL(nextHref);
            const cursor = parsed.searchParams.get('cursor');
            if (!cursor || cursor === lastCursor) break;
            lastCursor = cursor;
            nextUrl = `${horizonBase}/liquidity_pools?reserves=${assetId}&limit=200&order=asc&cursor=${encodeURIComponent(cursor)}`;
            pages++;
        } catch (e) {
            console.error('Error fetching pools:', e);
            break;
        }
    }

    const counters = [];
    pools.forEach(p => {
        const res = p.reserves;
        // Find the other asset
        const other = res.find(r => r.asset !== assetId) || (res[0].asset === assetId ? res[1] : res[0]);
        if (!other) return;

        let cCode, cIssuer, cType;
        if (other.asset === 'native') {
            cCode = 'XLM';
            cIssuer = null;
            cType = 'native';
        } else {
            [cCode, cIssuer] = other.asset.split(':');
            cType = 'credit_alphanum4'; // Simplified
        }
        counters.push({ code: cCode, issuer: cIssuer, type: cType });
    });

    return counters;
}

/**
 * Fetches assets that are being bought in exchange for the selling asset (Offers).
 * @param {string} code
 * @param {string} issuer
 * @returns {Promise<Array>} List of counter assets { code, issuer, type }
 */
async function fetchOfferCounterAssets(code, issuer) {
    // selling = our asset
    // buying = what we want to find (counter asset)
    let nextUrl = `${horizonBase}/offers?selling=${code}:${issuer}&limit=200&order=desc`;

    let lastCursor = null;
    const counters = [];

    let pages = 0;
    const maxPages = 5; // As requested

    while (nextUrl && pages < maxPages) {
        try {
            const res = await fetch(nextUrl);
            if (!res.ok) break;

            const data = await res.json();
            const records = data?._embedded?.records || [];

            records.forEach(r => {
                const b = r.buying;
                let cCode, cIssuer, cType;
                if (b.asset_type === 'native') {
                    cCode = 'XLM';
                    cIssuer = null;
                    cType = 'native';
                } else {
                    cCode = b.asset_code;
                    cIssuer = b.asset_issuer;
                    cType = b.asset_type;
                }
                counters.push({ code: cCode, issuer: cIssuer, type: cType });
            });

            if (!records.length) break;
            const nextHref = data?._links?.next?.href;
            if (!nextHref) break;
            const parsed = new URL(nextHref);
            const cursor = parsed.searchParams.get('cursor');
            if (!cursor || cursor === lastCursor) break;
            lastCursor = cursor;
            nextUrl = `${horizonBase}/offers?selling=${code}:${issuer}&limit=200&order=desc&cursor=${encodeURIComponent(cursor)}`;
            pages++;
        } catch (e) {
            console.error('Error fetching offers:', e);
            break;
        }
    }

    return counters;
}

/**
 * Finds all potential counter assets for a given base asset by checking Pools and Offers.
 * @param {string} baseCode
 * @param {string} baseIssuer
 * @returns {Promise<Array>} Unique list of counter assets { code, issuer, type, count }
 */
export async function findCounterAssets(baseCode, baseIssuer) {
    const [poolCounters, offerCounters] = await Promise.all([
        fetchPoolCounterAssets(baseCode, baseIssuer),
        fetchOfferCounterAssets(baseCode, baseIssuer)
    ]);

    const all = [...poolCounters, ...offerCounters];
    const uniqueMap = new Map();

    all.forEach(c => {
        const key = c.type === 'native' ? 'native' : `${c.code}:${c.issuer}`;
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, { ...c, count: 1 });
        } else {
            uniqueMap.get(key).count++;
        }
    });

    // Sort: Native first, then by count (desc), then alphabetic
    return [...uniqueMap.values()].sort((a, b) => {
        if (a.type === 'native') return -1;
        if (b.type === 'native') return 1;
        if (b.count !== a.count) return b.count - a.count;
        return a.code.localeCompare(b.code);
    });
}
