/** Domínios embutidos no painel (sufixos — cobre portal/app/api/*.cardapioweb.com). */
const FRAME_SUFFIXES = ['cardapioweb.com', 'ifood.com.br', 'rederwp.com'];

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
 * Remove headers que bloqueiam iframe nos sites parceiros.
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

module.exports = {
  FRAME_SUFFIXES,
  hostNeedsFrameBypass,
  stripFrameHeaders,
};
