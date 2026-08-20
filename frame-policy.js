/** Domínios embutidos / popups do painel (CW, iFood, RWP + Google reCAPTCHA). */
const FRAME_SUFFIXES = [
  'cardapioweb.com',
  'ifood.com.br',
  'rederwp.com',
  'google.com',
  'gstatic.com',
  'recaptcha.net',
  'googleapis.com',
];

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

/**
 * Remove headers que bloqueiam iframe nos sites parceiros / challenge do captcha.
 * @param {Record<string, string[]>} responseHeaders
 * @returns {Record<string, string[]>}
 */
function stripFrameHeaders(responseHeaders) {
  const headers = { ...responseHeaders };
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'x-frame-options') {
      delete headers[key];
      continue;
    }
    if (
      lower === 'content-security-policy' ||
      lower === 'content-security-policy-report-only'
    ) {
      headers[key] = headers[key].map((value) =>
        String(value)
          .replace(/frame-ancestors[^;]*;?/gi, '')
          .replace(/;\s*;/g, ';')
          .replace(/^\s*;\s*/g, '')
          .replace(/;\s*$/g, '')
          .trim()
      );
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
    ];
    return allow.some((s) => host === s || host.endsWith('.' + s));
  } catch (_) {
    return false;
  }
}

module.exports = {
  FRAME_SUFFIXES,
  hostNeedsFrameBypass,
  stripFrameHeaders,
  isAllowedPopupUrl,
};
