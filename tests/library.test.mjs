/**
 * Testes da biblioteca funcional (Fase 3.3).
 *
 * Executar com:
 *   node --test tests/library.test.mjs
 *
 * Usa os mesmos fakes locais das fases anteriores: nenhum banco real, nenhum
 * canvas do sistema e nenhuma dependência externa.
 */

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeCanvas } from './helpers/fake-canvas.mjs';
import {
  installFakeIndexedDB,
  resetFakeIndexedDB,
  setFakeFailure
} from './helpers/fake-indexeddb.mjs';

const { FakeCanvas, drawStroke } = installFakeCanvas();
installFakeIndexedDB();

const {
  closeDatabase,
  createStory,
  getStory,
  listStories
} = await import('../src/app/database.js');
const { createEmptyDrawingDocument } = await import('../src/app/drawing-data.js');
const { createDraft, getState } = await import('../src/app/state.js');
const {
  createDrawingEngine,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
  serializePageDrawing
} = await import('../src/app/drawing.js');
const {
  ensureStoryLoaded,
  flushPendingSaves,
  markPageChanged,
  requestSave,
  resetStoryStorageForTests
} = await import('../src/app/story-storage.js');
const library = await import('../src/app/library-data.js');

const {
  beginDelete,
  cancelDelete,
  confirmDelete,
  getLatestStory,
  getPendingDeleteId,
  isDeleteInProgress,
  LIBRARY_STATE,
  loadLibrary,
  openStory,
  resetLibraryDataForTests
} = library;

const activeEngines = [];

beforeEach(async () => {
  await closeDatabase();
  resetFakeIndexedDB();
  resetLibraryDataForTests();
  resetStoryStorageForTests();
});

afterEach(() => {
  activeEngines.splice(0).forEach((engine) => engine.destroy());
});

function pages(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `pagina-${index + 1}`,
    order: index,
    drawing: createEmptyDrawingDocument(),
    updatedAt: '2026-01-01T00:00:00.000Z'
  }));
}

function makeStory(title, extra = {}) {
  return createStory({
    title,
    author: 'Ana',
    pages: pages(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra
  });
}

function navigationContext() {
  const calls = [];
  return {
    calls,
    navigate(route, options) {
      calls.push({ route, options });
    },
    goBack() {}
  };
}

function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

test('1. biblioteca sem histórias', async () => {
  const result = await loadLibrary();

  assert.equal(result.state, LIBRARY_STATE.EMPTY);
  assert.deepEqual(result.stories, []);
  assert.equal(result.error, null);
  assert.deepEqual(await listStories(), []);
});

test('2. listagem de uma história persistida', async () => {
  const created = await makeStory('Primeira aventura');
  const result = await loadLibrary();

  assert.equal(result.state, LIBRARY_STATE.READY);
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0].id, created.id);
  assert.equal(result.stories[0].title, 'Primeira aventura');
});

test('3. listagem de várias histórias', async () => {
  const first = await makeStory('História A', { updatedAt: '2026-01-01T00:00:00.000Z' });
  const second = await makeStory('História B', { updatedAt: '2026-02-01T00:00:00.000Z' });
  const third = await makeStory('História C', { updatedAt: '2026-03-01T00:00:00.000Z' });

  const result = await loadLibrary();
  assert.equal(result.state, LIBRARY_STATE.READY);
  assert.deepEqual(
    result.stories.map((story) => story.id),
    [third.id, second.id, first.id]
  );
});

test('4. ordenação pelas histórias mais recentemente atualizadas', async () => {
  await makeStory('Antiga', { updatedAt: '2026-01-01T00:00:00.000Z' });
  await makeStory('Mais recente', { updatedAt: '2026-03-01T00:00:00.000Z' });
  await makeStory('Intermediária', { updatedAt: '2026-02-01T00:00:00.000Z' });

  const result = await loadLibrary();
  assert.deepEqual(
    result.stories.map((story) => story.title),
    ['Mais recente', 'Intermediária', 'Antiga']
  );
});

test('5. metadados exibidos: título, autor, capa, páginas e atualização', async () => {
  await makeStory('Aventura colorida', {
    author: 'Bia',
    cover: 'data:image/svg+xml;base64,PHN2Zy8+',
    pages: pages(3),
    updatedAt: '2026-03-04T12:30:00.000Z'
  });

  const card = (await loadLibrary()).stories[0];
  assert.equal(card.title, 'Aventura colorida');
  assert.equal(card.author, 'Bia');
  assert.equal(card.cover, 'data:image/svg+xml;base64,PHN2Zy8+');
  assert.equal(card.pageCount, 3);
  assert.equal(card.updatedAt, '2026-03-04T12:30:00.000Z');
  assert.match(card.updatedLabel, /2026/);
  assert.notEqual(card.updatedLabel, 'data desconhecida');
});

test('6. abertura navega para a história correta', async () => {
  const first = await makeStory('Abrir esta');
  await makeStory('Não abrir');
  const context = navigationContext();

  const result = await openStory(first.id, context);

  assert.equal(result.ok, true);
  assert.equal(result.storyId, first.id);
  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.calls[0], {
    route: 'editor',
    options: { query: { story: first.id } }
  });
  assert.equal(getState().draft.storyId, first.id);
});

test('7. abertura preserva o ID original e não duplica a história', async () => {
  const created = await makeStory('Identidade estável');
  const context = navigationContext();

  await openStory(created.id, context);

  assert.equal(getState().draft.storyId, created.id);
  assert.equal((await getStory(created.id)).createdAt, created.createdAt);
  assert.equal((await listStories()).length, 1);
});

test('8. retomada da última história pela tela inicial', async () => {
  await makeStory('Mais antiga', { updatedAt: '2026-01-01T00:00:00.000Z' });
  const recent = await makeStory('Última história', { updatedAt: '2026-04-01T00:00:00.000Z' });

  const latest = getLatestStory(await loadLibrary());
  assert.equal(latest.id, recent.id);

  const context = navigationContext();
  const result = await openStory(latest.id, context);
  assert.equal(result.ok, true);
  assert.equal(context.calls[0].options.query.story, recent.id);
});

test('9. cancelamento da exclusão não altera os dados', async () => {
  const created = await makeStory('Cancelar exclusão');

  assert.equal(beginDelete(created.id), created.id);
  assert.equal(getPendingDeleteId(), created.id);
  cancelDelete(created.id);

  assert.equal(getPendingDeleteId(), null);
  assert.equal((await getStory(created.id)).title, 'Cancelar exclusão');
  assert.equal((await listStories()).length, 1);
});

test('10. exclusão confirmada remove somente a história escolhida', async () => {
  const first = await makeStory('Excluir esta');
  const second = await makeStory('Manter esta');

  beginDelete(first.id);
  const result = await confirmDelete(first.id);

  assert.deepEqual(result, { ok: true, reason: null, id: first.id, deleted: true });
  assert.equal(await getStory(first.id), null);
  assert.equal((await getStory(second.id)).title, 'Manter esta');
  assert.equal(getPendingDeleteId(), null);
});

test('11. listagem é atualizada após exclusão confirmada', async () => {
  const first = await makeStory('Removida');
  await makeStory('Restante');

  await confirmDelete(first.id);
  const result = await loadLibrary();

  assert.equal(result.state, LIBRARY_STATE.READY);
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0].title, 'Restante');
});

test('12. falha na exclusão mantém a história visível', async () => {
  const created = await makeStory('Não excluir com erro');
  setFakeFailure('delete', namedError('AbortError', 'transação abortada'));

  try {
    const result = await confirmDelete(created.id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'TRANSACTION_FAILED');
  } finally {
    setFakeFailure('delete', null);
  }

  assert.equal((await getStory(created.id)).title, 'Não excluir com erro');
  assert.equal((await loadLibrary()).stories.length, 1);
  assert.equal(isDeleteInProgress(created.id), false);
});

test('13. falha na leitura do banco não é confundida com biblioteca vazia', async () => {
  const created = await makeStory('História preservada');
  setFakeFailure('getAll', namedError('AbortError', 'leitura abortada'));

  let result;
  try {
    result = await loadLibrary();
  } finally {
    setFakeFailure('getAll', null);
  }

  assert.equal(result.state, LIBRARY_STATE.ERROR);
  assert.deepEqual(result.stories, []);
  assert.equal(result.error.code, 'TRANSACTION_FAILED');
  assert.equal((await getStory(created.id)).title, 'História preservada');
});

test('14. proteção contra exclusões repetidas durante a operação', async () => {
  const created = await makeStory('Clique repetido');
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;

  const slowDelete = async () => {
    calls += 1;
    await gate;
    return true;
  };

  const first = confirmDelete(created.id, { deleteStory: slowDelete });
  const second = confirmDelete(created.id, { deleteStory: slowDelete });

  assert.equal(first, second, 'chamadas repetidas devem reutilizar a mesma promessa');
  assert.equal(calls, 1);
  assert.equal(isDeleteInProgress(created.id), true);

  release();
  const result = await first;

  assert.equal(result.deleted, true);
  assert.equal(calls, 1);
  assert.equal(isDeleteInProgress(created.id), false);
});

test('15. desenhos persistem após abrir a história pela biblioteca', async () => {
  createDraft({ title: 'Desenho da biblioteca', author: 'Ana' });
  const draft = getState().draft;
  const view = { width: 360, height: 640 };

  await ensureStoryLoaded(draft, view);
  const canvas = new FakeCanvas();
  let baseline = JSON.stringify(serializePageDrawing(draft, 1));

  const engine = createDrawingEngine(canvas, draft, 1, () => {
    const current = JSON.stringify(serializePageDrawing(draft, 1));
    if (current === baseline) return;
    baseline = current;
    markPageChanged(draft, 1);
    void requestSave(draft);
  });
  activeEngines.push(engine);
  engine.setTool('pencil');
  engine.setColor(DEFAULT_COLOR);
  engine.setSize(DEFAULT_SIZE);

  drawStroke(canvas, [[100, 120], [150, 170]], 31);
  await flushPendingSaves();

  const saved = await getStory(draft.storyId);
  const latest = getLatestStory(await loadLibrary());
  assert.equal(latest.id, draft.storyId);

  createDraft({ title: 'Rascunho temporário', author: 'Outro' });
  const opened = await openStory(latest.id, navigationContext());
  assert.equal(opened.ok, true);
  assert.equal(getState().draft.storyId, draft.storyId);

  await ensureStoryLoaded(getState().draft, view);
  assert.equal(getState().draft.title, 'Desenho da biblioteca');
  assert.deepEqual(serializePageDrawing(getState().draft, 1), saved.pages[0].drawing);
  assert.equal((await getStory(draft.storyId)).createdAt, saved.createdAt);
  assert.equal((await listStories()).length, 1);
});

test('16. abrir um ID inexistente não cria nova história', async () => {
  const created = await makeStory('Única história');
  const context = navigationContext();

  const result = await openStory('id-que-nao-existe', context);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing');
  assert.equal(context.calls.length, 0);
  assert.equal((await listStories()).length, 1);
  assert.equal((await getStory(created.id)).title, 'Única história');
});

test('17. falha ao consultar o ID não navega nem cria história', async () => {
  const created = await makeStory('Preservada na abertura');
  const context = navigationContext();
  const error = namedError('AbortError', 'leitura abortada');

  const result = await openStory(created.id, context, {
    getStory: async () => { throw error; }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.equal(context.calls.length, 0);
  assert.equal((await listStories()).length, 1);
});
