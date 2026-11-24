/**
 * Roteador por hash (#/tela).
 *
 * Usar hash evita configuração de rewrite no servidor e funciona bem em PWA
 * estática. O histórico interno complementa o botão "Voltar" das telas.
 */
import { getState, setCurrentRoute, pushHistory, popHistory, clearHistory } from './state.js';
import { registerServiceWorker } from './pwa.js';

import * as home from '../screens/home.js';
import * as library from '../screens/library.js';
import * as newStory from '../screens/new-story.js';
import * as editor from '../screens/editor.js';
import * as reader from '../screens/reader.js';
import * as backups from '../screens/backups.js';
import * as notFound from '../screens/not-found.js';

const routes = {
  home,
  library,
  'new-story': newStory,
  editor,
  reader,
  backups,
  'not-found': notFound
};

const pageTitles = {
  home: 'Início',
  library: 'Biblioteca',
  'new-story': 'Nova história',
  editor: 'Editor',
  reader: 'Leitura',
  backups: 'Backups',
  'not-found': 'Tela não encontrada'
};

const app = document.getElementById('app');
const headerBack = document.getElementById('header-back');
const headerBadge = document.getElementById('header-badge');
const navLinks = Array.from(document.querySelectorAll('.bottom-nav__item'));

let internalNavigation = false;

function normalizeRoute(value) {
  if (!value) return 'home';
  return String(value)
    .replace(/^#\/?/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function isValidRoute(route) {
  return Object.prototype.hasOwnProperty.call(routes, route);
}

function routeFromHash() {
  return normalizeRoute(window.location.hash);
}

function updateChrome(route) {
  headerBack.hidden = route === 'home';
  headerBadge.hidden = !['editor', 'reader', 'backups', 'not-found'].includes(route);

  navLinks.forEach((link) => {
    const active = link.dataset.nav === route;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderRoute(route, { focus = true } = {}) {
  const screen = routes[route] || routes['not-found'];

  app.innerHTML = screen.render(context);
  if (typeof screen.mount === 'function') screen.mount(app, context);

  updateChrome(route);
  document.title = `${pageTitles[route] || 'Tela não encontrada'} · Meu Pequeno Quadrinho`;

  if (focus) {
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
}

function rerender() {
  renderRoute(getState().currentRoute, { focus: false });
}

function navigate(route, { replace = false } = {}) {
  let target = normalizeRoute(route);
  if (!isValidRoute(target)) target = 'not-found';

  if (replace && target === getState().currentRoute) {
    rerender();
    return;
  }

  if (!replace) pushHistory(getState().currentRoute);

  const nextHash = `#/${target}`;
  if (window.location.hash === nextHash) {
    renderRoute(target);
    return;
  }

  internalNavigation = true;
  window.location.hash = nextHash;
}

function goBack() {
  const previous = popHistory();
  navigate(previous || 'home', { replace: true });
}

function handleHashChange() {
  const requested = routeFromHash();
  const route = isValidRoute(requested) ? requested : 'not-found';

  // Mudanças externas (botão voltar do navegador ou digitação manual) reiniciam
  // a pilha interna para evitar retornos surpreendentes a telas já abandonadas.
  if (!internalNavigation) clearHistory();
  internalNavigation = false;

  if (!isValidRoute(requested) && window.location.hash !== '#/not-found') {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/not-found`);
  }

  setCurrentRoute(route);
  renderRoute(route);
}

const context = {
  navigate,
  goBack,
  rerender,
  getState
};

export function initRouter() {
  headerBack.addEventListener('click', goBack);
  window.addEventListener('hashchange', handleHashChange);

  // Links internos (#/...) passam pelo roteador para alimentar a pilha de
  // histórico. Links normais (como o skip link #app) continuam nativos.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest('a[href^="#/"]');

    if (!anchor || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    navigate(anchor.getAttribute('href'));
  });

  if (!window.location.hash) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/home`);
  }

  handleHashChange();
  registerServiceWorker();
}

initRouter();
