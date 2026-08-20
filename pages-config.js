/** Páginas externas do painel (carregadas em BrowserView — top-level, reCAPTCHA ok). */
const DOCK_RESERVE = 110;

const PAGES = {
  cardweb: {
    url: 'https://portal.cardapioweb.com',
    keepAlive: true,
  },
  ifood: {
    url: 'https://gestordepedidos.ifood.com.br/#/login',
    keepAlive: false,
  },
  gestao: {
    url: 'https://portal.ifood.com.br',
    keepAlive: false,
  },
  rwp: {
    url: 'https://www.rederwp.com/src/login.php',
    keepAlive: false,
  },
};

module.exports = { DOCK_RESERVE, PAGES };
