/**
 * Estado em memória da aplicação.
 *
 * IMPORTANTE: nada aqui é gravado em localStorage, IndexedDB ou arquivos.
 * Os dados existem apenas enquanto a aba está aberta e servem para demonstrar
 * a navegação e a estrutura visual da Fase 1.
 */

const MAX_PAGES = 3;

function createEmptyDraft() {
  return {
    title: '',
    author: '',
    page: 1,
    pageCount: MAX_PAGES,
    editorReady: false
  };
}

const state = {
  draft: createEmptyDraft(),
  readerPage: 1,
  currentRoute: 'home',
  history: []
};

export function getState() {
  return state;
}

export function createDraft({ title, author }) {
  state.draft = {
    ...createEmptyDraft(),
    title: title.trim(),
    author: author.trim()
  };
  state.readerPage = 1;
}

export function setEditorReady(ready) {
  state.draft.editorReady = Boolean(ready);
}

export function setPage(page) {
  const numeric = Number(page);
  state.draft.page = Math.min(MAX_PAGES, Math.max(1, Number.isFinite(numeric) ? numeric : 1));
}

export function setReaderPage(page) {
  const numeric = Number(page);
  state.readerPage = Math.min(MAX_PAGES, Math.max(1, Number.isFinite(numeric) ? numeric : 1));
}

export function setCurrentRoute(route) {
  state.currentRoute = route;
}

export function pushHistory(route) {
  if (!route) return;
  state.history.push(route);
  if (state.history.length > 20) state.history.shift();
}

export function popHistory() {
  return state.history.pop() || null;
}

export function clearHistory() {
  state.history.length = 0;
}
