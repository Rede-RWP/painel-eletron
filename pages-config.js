/** Páginas externas do painel (BrowserView top-level). */
/** Altura da janela overlay do dock (transparente — não empurra o conteúdo). */
const DOCK_HEIGHT = 108;
/** Distância da borda inferior (px) que abre o menu só com o mouse */
const DOCK_EDGE_PX = 16;
/** Delay para esconder depois que o mouse sai da zona do dock */
const DOCK_HIDE_DELAY_MS = 480;
/** Intervalo do poll do cursor */
const DOCK_POLL_MS = 40;
/** Duração da animação de saída antes do hide() da janela */
const DOCK_ANIM_MS = 320;

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
  DOCK_HEIGHT,
  DOCK_EDGE_PX,
  DOCK_HIDE_DELAY_MS,
  DOCK_POLL_MS,
  DOCK_ANIM_MS,
  PAGES,
};
