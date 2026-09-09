/** Domínios embutidos / popups do painel (CW, iFood, RWP, WhatsApp + Google reCAPTCHA). */
const FRAME_SUFFIXES = [
  'cardapioweb.com',
  'ifood.com.br',
  'rederwp.com',
  'whatsapp.com',
  'whatsapp.net',
  'tunagateway.com',
  'google.com',
  'gstatic.com',
  'recaptcha.net',
  'googleapis.com',
];

/** Hosts onde o Cardapinho injeta iframe chrome-extension:// (CSP do Chrome libera; Electron não). */
const EXTENSION_FRAME_SUFFIXES = ['whatsapp.com', 'whatsapp.net'];

function hostNeedsFrameBypass(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return FRAME_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith('.' + suffix)
    );
  } catch (_) {
    return false;
  }
}

function hostNeedsExtensionCsp(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return EXTENSION_FRAME_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith('.' + suffix)
    );
  } catch (_) {
    return false;
  }
}

/**
 * Electron não isenta iframes de extensão do CSP da página (Chrome sim).
 * Injeta chrome-extension: nas diretivas que bloqueiam o Cardapinho.
 * @param {string} csp
 * @returns {string}
 */
function allowChromeExtensionInCsp(csp) {
  let value = String(csp);
  const directives = [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'connect-src',
    'media-src',
    'frame-src',
    'child-src',
    'worker-src',
    'object-src',
  ];

  for (const dir of directives) {
    const re = new RegExp(`(${dir}\\s+)([^;]*)`, 'i');
    if (!re.test(value)) continue;
    value = value.replace(re, (match, prefix, rest) => {
      if (/chrome-extension\s*:/i.test(rest)) return match;
      return `${prefix}${rest.trimEnd()} chrome-extension:`;
    });
  }

  if (!/frame-src\s/i.test(value)) {
    value = `frame-src 'self' chrome-extension:; ${value}`;
  }
  if (!/child-src\s/i.test(value)) {
    value = `child-src 'self' blob: data: chrome-extension:; ${value}`;
  }

  // APIs do Cardapinho (helperScript / UI) a partir do contexto da página
  const apiHosts = [
    'https://messaging.cardapioweb.com',
    'https://messaging.sandbox.cardapioweb.com',
    'https://engine.tunagateway.com',
    'https://storage.googleapis.com',
  ];
  value = value.replace(/(connect-src\s+)([^;]*)/i, (match, prefix, rest) => {
    let next = rest;
    for (const host of apiHosts) {
      if (!next.includes(host)) next = `${next.trimEnd()} ${host}`;
    }
    return `${prefix}${next}`;
  });

  return value;
}

/**
 * Remove headers que bloqueiam iframe nos sites parceiros / challenge do captcha.
 * @param {Record<string, string[]>} responseHeaders
 * @param {{ allowExtension?: boolean }} [opts]
 * @returns {Record<string, string[]>}
 */
function stripFrameHeaders(responseHeaders, opts = {}) {
  const headers = { ...responseHeaders };
  const allowExtension = !!opts.allowExtension;

  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'x-frame-options') {
      delete headers[key];
      continue;
    }
    // WhatsApp usa COEP require-corp; no Electron o iframe chrome-extension://
    // do Cardapinho cai em ERR_BLOCKED_BY_RESPONSE sem isso.
    if (
      allowExtension &&
      (lower === 'cross-origin-embedder-policy' ||
        lower === 'cross-origin-embedder-policy-report-only' ||
        lower === 'cross-origin-opener-policy' ||
        lower === 'cross-origin-opener-policy-report-only')
    ) {
      delete headers[key];
      continue;
    }
    if (
      lower === 'content-security-policy' ||
      lower === 'content-security-policy-report-only'
    ) {
      headers[key] = headers[key].map((value) => {
        let next = String(value)
          .replace(/frame-ancestors[^;]*;?/gi, '')
          .replace(/;\s*;/g, ';')
          .replace(/^\s*;\s*/g, '')
          .replace(/;\s*$/g, '')
          .trim();
        if (allowExtension && next) {
          next = allowChromeExtensionInCsp(next);
        }
        return next;
      });
      if (!headers[key].some((v) => v.length > 0)) {
        delete headers[key];
      }
    }
  }
  return headers;
}

/** Popups do reCAPTCHA / OAuth que o Electron precisa permitir. */
function isAllowedPopupUrl(url) {
  if (!url || url === 'about:blank') return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const allow = [
      'google.com',
      'gstatic.com',
      'recaptcha.net',
      'googleapis.com',
      'cardapioweb.com',
      'ifood.com.br',
      'rederwp.com',
      'whatsapp.com',
      'whatsapp.net',
      'tunagateway.com',
      'facebook.com',
    ];
    return allow.some((s) => host === s || host.endsWith('.' + s));
  } catch (_) {
    return false;
  }
}

module.exports = {
  FRAME_SUFFIXES,
  EXTENSION_FRAME_SUFFIXES,
  hostNeedsFrameBypass,
  hostNeedsExtensionCsp,
  allowChromeExtensionInCsp,
  stripFrameHeaders,
  isAllowedPopupUrl,
};
