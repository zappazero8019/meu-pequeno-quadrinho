/**
 * Estado em memória da aplicação.
 *
 * O rascunho continua vivendo apenas na memória, mas agora carrega um `storyId`
 * estável e os metadados mínimos que a camada de persistência (Fase 3.2) usa
 * para gravar e recuperar a história no IndexedDB. Nenhum dado é espelhado em
 * localStorage: o conteúdo das histórias permanece somente no banco local.
 */

export const MAX_PAGES = 3;

function makeStoryId() {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `story-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makePages(now) {
  return Array.from({ length: MAX_PAGES }, (_, index) => ({
    id: `pagina-${index + 1}`,
    order: index,
    updatedAt: now
  }));
}

function createEmptyDraft(storyId = makeStoryId()) {
  const now = new Date().toISOString();

  return {
    storyId,
    title: '',
    author: '',
    cover: null,
    createdAt: now,
    updatedAt: null,
    page: 1,
    pageCount: MAX_PAGES,
    pages: makePages(now),
    editorReady: false,
    storyLoaded: false,
    drawingsRestored: false
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

export function createDraft({ title, author, storyId } = {}) {
  const fresh = createEmptyDraft(storyId);
  state.draft = {
    ...fresh,
    title: (title || '').trim(),
    author: (author || '').trim()
  };
  state.readerPage = 1;
}

/**
 * Prepara o rascunho para um ID recebido pela URL. Se for outro ID, troca o
 * rascunho por um vazio para que desenhos antigos nunca sejam reaproveitados.
 */
export function prepareDraftForStory(storyId) {
  const clean = typeof storyId === 'string' ? storyId.trim() : '';
  if (!clean || state.draft.storyId === clean) return;

  const previous = state.draft;
  state.draft = {
    ...createEmptyDraft(clean),
    title: previous.title || '',
    author: previous.author || ''
  };
  state.readerPage = 1;
}

export function setEditorReady(ready) {
  state.draft.editorReady = Boolean(ready);
}

export function setPage(page) {
  const numeric = Number(page);
  const total = Math.max(1, Number(state.draft.pageCount) || MAX_PAGES);
  state.draft.page = Math.min(total, Math.max(1, Number.isFinite(numeric) ? numeric : 1));
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
