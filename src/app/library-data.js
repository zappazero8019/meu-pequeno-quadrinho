/**
 * Regras da biblioteca funcional (Fase 3.3).
 *
 * Este módulo não substitui o banco: ele apenas usa `listStories`, `getStory`
 * e `deleteStory` de `database.js`, prepara os dados para exibição e controla
 * abertura/exclusão. As funções aceitam dependências injetadas para que os
 * testes possam simular falhas sem tocar no banco real do navegador.
 */

import {
  deleteStory,
  getStory,
  listStories
} from './database.js';
import { prepareDraftForStory } from './state.js';

export const LIBRARY_STATE = Object.freeze({
  LOADING: 'loading',
  EMPTY: 'empty',
  READY: 'ready',
  ERROR: 'error'
});

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

let pendingDeleteId = null;
let deletion = null;

function cleanId(id) {
  return typeof id === 'string' ? id.trim() : '';
}

/** Capas são opcionais; aceita apenas origens que o navegador pode exibir. */
function coverSource(cover) {
  if (typeof cover === 'string') {
    return /^(data:image\/|https?:\/\/|blob:|\.\/|\/)/i.test(cover) ? cover : null;
  }
  if (!cover || typeof cover !== 'object') return null;

  for (const key of ['dataUrl', 'src', 'url', 'image', 'cover']) {
    const value = cover[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

export function formatUpdatedAt(value) {
  if (!value) return 'data desconhecida';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'data desconhecida';

  try {
    return DATE_FORMATTER.format(date);
  } catch {
    return 'data desconhecida';
  }
}

/** Converte o registro persistido em dados seguros para um cartão da UI. */
export function normalizeStoryCard(story) {
  if (!story || typeof story !== 'object' || !cleanId(story.id)) return null;

  const updatedAt = typeof story.updatedAt === 'string'
    ? story.updatedAt
    : new Date().toISOString();

  return {
    id: story.id,
    title: typeof story.title === 'string' && story.title.trim()
      ? story.title.trim()
      : 'História sem título',
    author: typeof story.author === 'string' ? story.author.trim() : '',
    cover: coverSource(story.cover),
    pageCount: Array.isArray(story.pages)
      ? story.pages.length
      : Number(story.pageCount) || 0,
    createdAt: story.createdAt || null,
    updatedAt,
    updatedLabel: formatUpdatedAt(updatedAt)
  };
}

/** Carrega a biblioteca. Erro de leitura nunca é apresentado como lista vazia. */
export async function loadLibrary(deps = {}) {
  const loader = deps.listStories || listStories;

  try {
    const result = await loader();
    const stories = (Array.isArray(result) ? result : [])
      .map(normalizeStoryCard)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return {
      state: stories.length ? LIBRARY_STATE.READY : LIBRARY_STATE.EMPTY,
      stories,
      error: null
    };
  } catch (error) {
    return {
      state: LIBRARY_STATE.ERROR,
      stories: [],
      error
    };
  }
}

/** A história mais recente já vem primeiro de `loadLibrary()`. */
export function getLatestStory(library) {
  if (Array.isArray(library)) return library[0] || null;
  return library?.stories?.[0] || null;
}

/**
 * Abre uma história existente pelo ID. A consulta prévia evita que um cartão
 * antigo (ou um link manual) crie acidentalmente um registro novo: só depois
 * de confirmar o ID é que o rascunho é preparado e a rota é navegada.
 */
export async function openStory(id, context, deps = {}) {
  const storyId = cleanId(id);
  if (!storyId) return { ok: false, reason: 'invalid', storyId: null, story: null };

  const lookup = deps.getStory || getStory;
  let story;
  try {
    story = await lookup(storyId);
  } catch (error) {
    return { ok: false, reason: 'error', error, storyId, story: null };
  }

  if (!story || !cleanId(story.id)) {
    return { ok: false, reason: 'missing', storyId, story: null };
  }

  const prepare = deps.prepareDraftForStory || prepareDraftForStory;
  prepare(story.id);

  const navigate = deps.navigate || ((route, options) => context?.navigate?.(route, options));
  if (typeof navigate !== 'function') {
    return { ok: false, reason: 'navigation', storyId: story.id, story };
  }

  navigate('editor', { query: { story: story.id } });
  return { ok: true, reason: null, storyId: story.id, story };
}

/** Etapa de confirmação da interface; o cancelamento não toca no banco. */
export function beginDelete(id) {
  pendingDeleteId = cleanId(id) || null;
  return pendingDeleteId;
}

export function cancelDelete(id) {
  if (!cleanId(id) || pendingDeleteId === cleanId(id)) pendingDeleteId = null;
  return pendingDeleteId;
}

export function getPendingDeleteId() {
  return pendingDeleteId;
}

export function isDeleteInProgress(id) {
  if (!deletion) return false;
  return !id || deletion.id === cleanId(id);
}

/**
 * Executa a exclusão confirmada. Chamadas repetidas para o mesmo ID enquanto a
 * transação está em andamento recebem a mesma promessa, sem novas exclusões.
 */
export function confirmDelete(id, deps = {}) {
  const storyId = cleanId(id);
  if (!storyId) {
    return Promise.resolve({ ok: false, reason: 'invalid', id: null, deleted: false });
  }

  if (deletion) {
    if (deletion.id === storyId) return deletion.promise;
    return Promise.resolve({ ok: false, reason: 'busy', id: storyId, deleted: false });
  }

  const remove = deps.deleteStory || deleteStory;
  const entry = { id: storyId, promise: null };
  deletion = entry;

  entry.promise = (async () => {
    try {
      const deleted = Boolean(await remove(storyId));
      if (deleted && pendingDeleteId === storyId) pendingDeleteId = null;
      return { ok: true, reason: null, id: storyId, deleted };
    } catch (error) {
      return { ok: false, reason: 'error', id: storyId, deleted: false, error };
    } finally {
      if (deletion === entry) deletion = null;
    }
  })();

  return entry.promise;
}

/** Uso exclusivo dos testes, para isolar o estado entre casos. */
export function resetLibraryDataForTests() {
  pendingDeleteId = null;
  deletion = null;
}
