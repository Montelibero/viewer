const DEFAULT_SUPPORTED = ['ru', 'en', 'es'];
const STORAGE_KEY = 'viewer_lang';
const translationsCache = new Map();

function normalizeLang(lang, supported) {
  if (!lang || typeof lang !== 'string') return null;
  const lower = lang.toLowerCase();
  const primary = lower.split('-')[0];
  if (supported.includes(lower)) return lower;
  if (supported.includes(primary)) return primary;
  return null;
}

function pickNavigatorLang(supported, fallback) {
  const langs = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const lang of langs) {
    const normalized = normalizeLang(lang, supported);
    if (normalized) return normalized;
  }
  return fallback;
}

function getStoredLang(supported) {
  const stored = localStorage.getItem(STORAGE_KEY);
  return normalizeLang(stored, supported);
}

function setStoredLang(lang) {
  localStorage.setItem(STORAGE_KEY, lang);
}

function buildLangUrl(baseName, lang) {
  return new URL(`./lang/${baseName}.${lang}.json`, import.meta.url).toString();
}

async function fetchTranslations(baseName, lang) {
  const cacheKey = `${baseName}:${lang}`;
  if (translationsCache.has(cacheKey)) return translationsCache.get(cacheKey);

  const url = buildLangUrl(baseName, lang);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load translations ${lang}`);
  const data = await res.json();
  translationsCache.set(cacheKey, data);
  return data;
}

async function loadWithFallback(baseName, lang, fallback) {
  try {
    return await fetchTranslations(baseName, lang);
  } catch (_) {
    if (lang !== fallback) {
      try {
        return await fetchTranslations(baseName, fallback);
      } catch (e) {
        console.error(e);
      }
    }
    return {};
  }
}

function applyTranslations(dict) {
  const textNodes = document.querySelectorAll('[data-i18n]');
  textNodes.forEach((el) => {
    const key = el.dataset.i18n;
    if (key && dict[key]) el.textContent = dict[key];
  });

  const mappings = [
    { selector: '[data-i18n-placeholder]', attr: 'placeholder', dataKey: 'i18nPlaceholder' },
    { selector: '[data-i18n-title]', attr: 'title', dataKey: 'i18nTitle' },
    { selector: '[data-i18n-value]', attr: 'value', dataKey: 'i18nValue' },
    { selector: '[data-i18n-aria-label]', attr: 'aria-label', dataKey: 'i18nAriaLabel' },
  ];

  mappings.forEach(({ selector, attr, dataKey }) => {
    document.querySelectorAll(selector).forEach((el) => {
      const key = el.dataset[dataKey];
      if (key && dict[key]) el.setAttribute(attr, dict[key]);
    });
  });
}

function setDocumentLang(lang) {
  document.documentElement.lang = lang;
}

export async function initI18n({
  baseName,
  supported = DEFAULT_SUPPORTED,
  fallback = 'en',
} = {}) {
  if (!baseName) throw new Error('baseName is required for i18n');

  const currentSupported = supported.map((l) => l.toLowerCase());
  const initial = getStoredLang(currentSupported)
    || pickNavigatorLang(currentSupported, fallback)
    || fallback;

  let currentLang = normalizeLang(initial, currentSupported) || fallback;
  let currentDict = await loadWithFallback(baseName, currentLang, fallback);
  setStoredLang(currentLang);

  function t(key) {
    return currentDict[key] || key;
  }

  function apply() {
    applyTranslations(currentDict);
    setDocumentLang(currentLang);
  }

  async function setLang(next) {
    const normalized = normalizeLang(next, currentSupported) || fallback;
    if (normalized === currentLang) return { lang: currentLang, t };
    currentDict = await loadWithFallback(baseName, normalized, fallback);
    currentLang = normalized;
    setStoredLang(currentLang);
    apply();
    return { lang: currentLang, t };
  }

  apply();

  return {
    lang: () => currentLang,
    t,
    setLang,
    supported: currentSupported,
  };
}
