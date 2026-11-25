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
let unmountActiveScreen = null;
let currentQuery = new URLSearchParams();

function normalizeRoute(value) {
  if (!value) return 'home';
  return String(value)
    .split('?')[0]
    .replace(/^#\/?/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function queryFromHash(value) {
  const raw = String(value || '');
  const marker = raw.indexOf('?');
  return new URLSearchParams(marker === -1 ? '' : raw.slice(marker + 1));
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

  // Telas com recursos contínuos (como o canvas) podem encerrar escutas e
  // guardar seu estado antes de serem substituídas.
  if (typeof unmountActiveScreen === 'function') unmountActiveScreen();
  unmountActiveScreen = null;

  app.innerHTML = screen.render(context);
  if (typeof screen.mount === 'function') screen.mount(app, context);
  if (typeof screen.unmount === 'function') unmountActiveScreen = screen.unmount;

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

function navigate(route, { replace = false, query = null } = {}) {
  let target = normalizeRoute(route);
  if (!isValidRoute(target)) target = 'not-found';

  const params = new URLSearchParams();
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
  }
  const search = params.toString();
  const nextHash = `#/${target}${search ? `?${search}` : ''}`;

  if (replace && target === getState().currentRoute && window.location.hash === nextHash) {
    rerender();
    return;
  }

  if (!replace) pushHistory(getState().currentRoute);

  currentQuery = new URLSearchParams(search);
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
  currentQuery = queryFromHash(window.location.hash);

  // Mudanças externas (botão voltar do navegador ou digitação manual) reiniciam
  // a pilha interna para evitar retornos surpreendentes a telas já abandonadas.
  if (!internalNavigation) clearHistory();
  internalNavigation = false;

  if (!isValidRoute(requested)) {
    currentQuery = new URLSearchParams();
    if (window.location.hash !== '#/not-found') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/not-found`);
    }
  }

  setCurrentRoute(route);
  renderRoute(route);
}

const context = {
  navigate,
  goBack,
  rerender,
  getState,
  getQueryParam: (name) => currentQuery.get(name)
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
