/**
 * Integração entre o editor e o IndexedDB (Fase 3.2).
 *
 * Esta camada não desenha e não conhece eventos de ponteiro. Ela apenas:
 * - garante que o rascunho tenha uma história identificável no banco;
 * - reconstrói os buffers do motor a partir dos documentos serializados;
 * - recebe pedidos de gravação e os executa em uma fila serial.
 *
 * A fila mantém no máximo uma transação em andamento. Alterações que chegam
 * durante essa transação são agrupadas em um único snapshot posterior: a ordem
 * é preservada, a versão mais recente sempre vence e nenhum estado "Salvo" é
 * anunciado antes da confirmação da transação.
 */

import {
  createStory,
  getStory,
  updateStory
} from './database.js';
import { restorePageDrawing, serializePageDrawing } from './drawing.js';

const SAVING = 'saving';
const SAVED = 'saved';
const ERROR = 'error';

const MESSAGES = {
  [SAVING]: 'Salvando...',
  [SAVED]: 'Salvo.',
  [ERROR]: 'Erro ao salvar.'
};

let status = SAVED;
let lastError = null;
let sequence = 0;
let inFlight = false;
let pendingSnapshot = null;
const listeners = new Set();
const drainResolvers = [];
const loadingDrafts = new WeakMap();

function statusObject() {
  return {
    state: status,
    message: MESSAGES[status],
    error: lastError,
    pending: inFlight || Boolean(pendingSnapshot)
  };
}

function setStatus(next, error = null) {
  if (status === next && lastError === error) return;
  status = next;
  lastError = error;
  listeners.forEach((listener) => listener(statusObject()));
}

function resolveDrains() {
  while (drainResolvers.length) drainResolvers.shift()(statusObject());
}

export function subscribeSaveStatus(listener) {
  listeners.add(listener);
  listener(statusObject());
  return () => listeners.delete(listener);
}

export function getSaveStatus() {
  return statusObject();
}

/** Resolve quando a fila terminar (com sucesso ou erro explícito). */
export function flushPendingSaves() {
  if (!inFlight && !pendingSnapshot) return Promise.resolve(statusObject());
  return new Promise((resolve) => drainResolvers.push(resolve));
}

function orderedPages(draft) {
  return [...(draft.pages || [])]
    .filter((page) => page && page.id)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function makeSnapshot(draft) {
  const pages = orderedPages(draft).map((page) => ({
    id: page.id,
    order: page.order,
    updatedAt: page.updatedAt,
    drawing: serializePageDrawing(draft, page.order + 1)
  }));

  return {
    draft,
    sequence: ++sequence,
    exists: Boolean(draft.storyLoaded),
    id: draft.storyId,
    title: draft.title,
    author: draft.author,
    cover: draft.cover ?? null,
    createdAt: draft.createdAt,
    pages
  };
}

function storyPatch(snapshot) {
  return {
    title: snapshot.title,
    author: snapshot.author,
    cover: snapshot.cover,
    pages: snapshot.pages
  };
}

/**
 * Grava um snapshot. Se o registro ainda não existe, cria sempre com o mesmo
 * `id` do rascunho. Um CONFLICT significa que uma tentativa anterior já criou
 * a história; nesse caso recuperamos o registro e atualizamos, sem duplicar.
 */
async function persistSnapshot(snapshot) {
  const patch = storyPatch(snapshot);

  if (snapshot.exists) {
    const updated = await updateStory(snapshot.id, patch);
    if (updated) return updated;

    // O registro desapareceu entre a leitura e a gravação: recria com o mesmo
    // identificador, sem gerar uma segunda história.
    return createStory({ ...patch, id: snapshot.id, createdAt: snapshot.createdAt });
  }

  try {
    return await createStory({ ...patch, id: snapshot.id, createdAt: snapshot.createdAt });
  } catch (error) {
    const alreadyCreated = error?.code === 'CONFLICT' || error?.name === 'ConstraintError';
    if (!alreadyCreated) throw error;

    const existing = await getStory(snapshot.id);
    if (!existing) throw error;

    snapshot.exists = true;
    snapshot.draft.storyLoaded = true;
    return updateStory(snapshot.id, patch);
  }
}

async function runQueue(firstSnapshot) {
  inFlight = true;
  let current = firstSnapshot;

  try {
    while (current) {
      let next = null;

      try {
        const saved = await persistSnapshot(current);
        current.draft.storyLoaded = true;
        current.draft.updatedAt = saved?.updatedAt || new Date().toISOString();

        if (pendingSnapshot && pendingSnapshot.sequence > current.sequence) {
          next = pendingSnapshot;
          next.exists = Boolean(next.draft.storyLoaded);
          pendingSnapshot = null;
          setStatus(SAVING);
        } else {
          pendingSnapshot = null;
          setStatus(SAVED);
          break;
        }
      } catch (error) {
        // O snapshot pendente é mais novo e contém o estado completo; ele
        // substitui com segurança o snapshot que falhou. Se não houver outro,
        // o próprio snapshot falho fica guardado para nova tentativa.
        pendingSnapshot = pendingSnapshot && pendingSnapshot.sequence > current.sequence
          ? pendingSnapshot
          : current;
        setStatus(ERROR, error);
        break;
      }

      current = next;
    }
  } finally {
    inFlight = false;
    resolveDrains();
  }
}

/**
 * Enfileira o estado atual do rascunho. Chamado depois de uma ação concluída,
 * nunca durante PointerMove. Retorna uma promessa que termina quando a fila
 * terminar.
 */
export function requestSave(draft) {
  if (!draft || !draft.storyId) return flushPendingSaves();

  const snapshot = makeSnapshot(draft);
  setStatus(SAVING);

  if (inFlight) {
    // Agrupa alterações próximas: somente o snapshot mais recente é gravado
    // depois que a transação atual confirmar.
    pendingSnapshot = snapshot;
  } else {
    void runQueue(snapshot);
  }

  return flushPendingSaves();
}

/** Tenta novamente a gravação que falhou, ou gravar o estado atual do rascunho. */
export function retrySave(draft) {
  if (inFlight) return flushPendingSaves();

  const snapshot = pendingSnapshot || (draft ? makeSnapshot(draft) : null);
  if (!snapshot) return flushPendingSaves();

  pendingSnapshot = null;
  setStatus(SAVING);
  void runQueue(snapshot);
  return flushPendingSaves();
}

function applyStoryToDraft(draft, story) {
  draft.storyId = story.id;
  draft.title = story.title;
  draft.author = story.author;
  draft.cover = story.cover ?? null;
  draft.createdAt = story.createdAt;
  draft.updatedAt = story.updatedAt;
  draft.pageCount = story.pages.length;
  draft.pages = story.pages.map((page) => ({
    id: page.id,
    order: page.order,
    updatedAt: page.updatedAt
  }));
  draft.page = Math.min(Math.max(1, Number(draft.page) || 1), draft.pages.length || 1);
}

function restoreDrawings(draft, story, view) {
  if (draft.drawingsRestored || !story) return;

  story.pages.forEach((page) => {
    restorePageDrawing(draft, page.order + 1, page.drawing, view);
  });

  draft.drawingsRestored = true;
}

/**
 * Carrega (ou cria) a história do rascunho e reconstrói os buffers do motor.
 * Em caso de falha, o rascunho permanece em memória e o indicador mostra erro.
 */
async function performEnsureStoryLoaded(draft, view) {
  setStatus(SAVING);

  try {
    let story = null;
    try {
      story = await getStory(draft.storyId);
    } catch (error) {
      if (error?.code !== 'UNAVAILABLE') throw error;
    }

    if (!story) {
      story = await createStory({
        id: draft.storyId,
        title: draft.title,
        author: draft.author,
        cover: draft.cover ?? null,
        createdAt: draft.createdAt,
        pages: orderedPages(draft).map((page) => ({
          id: page.id,
          order: page.order,
          updatedAt: page.updatedAt
        }))
      });
    }

    applyStoryToDraft(draft, story);
    draft.storyLoaded = true;
    restoreDrawings(draft, story, view);
    setStatus(SAVED);
  } catch (error) {
    setStatus(ERROR, error);
  }

  return statusObject();
}

/** Carrega (ou cria) a história do rascunho e reconstrói os buffers do motor. */
export function ensureStoryLoaded(draft, view = {}) {
  if (!draft || !draft.storyId) return Promise.resolve(statusObject());
  if (draft.storyLoaded && draft.drawingsRestored) return Promise.resolve(statusObject());

  const running = loadingDrafts.get(draft);
  if (running) return running;

  const promise = performEnsureStoryLoaded(draft, view).finally(() => {
    loadingDrafts.delete(draft);
  });
  loadingDrafts.set(draft, promise);
  return promise;
}

/** Marca a página alterada para atualizar seu `updatedAt` no próximo snapshot. */
export function markPageChanged(draft, pageNumber) {
  const now = new Date().toISOString();
  const page = (draft.pages || []).find((item) => item.order === pageNumber - 1);
  if (page) page.updatedAt = now;
  draft.updatedAt = now;
}

/** Uso exclusivo dos testes, para isolar filas entre casos. */
export function resetStoryStorageForTests() {
  sequence = 0;
  inFlight = false;
  pendingSnapshot = null;
  status = SAVED;
  lastError = null;
  drainResolvers.splice(0).forEach((resolve) => resolve(statusObject()));
}
