/** Páginas externas do painel (carregadas em BrowserView — top-level, reCAPTCHA ok). */
/** Altura do dock quando aberto — deve bater com --dock-shelf no painel.html */
const DOCK_RESERVE = 96;
/** Distância da borda inferior (px) que abre o menu só com o mouse */
const DOCK_EDGE_PX = 14;
/** Delay para esconder depois que o mouse sai da zona do dock */
const DOCK_HIDE_DELAY_MS = 450;
/** Intervalo do poll do cursor (BrowserView come os eventos do renderer) */
const DOCK_POLL_MS = 40;

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

module.exports = {
  DOCK_RESERVE,
  DOCK_EDGE_PX,
  DOCK_HIDE_DELAY_MS,
  DOCK_POLL_MS,
  PAGES,
};
