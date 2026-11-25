/**
 * Testes da integração IndexedDB ↔ editor (Fase 3.2).
 *
 * Executar com:
 *   node --test tests/story-storage.test.mjs
 *
 * Usa os mesmos fakes locais das fases anteriores: nenhuma dependência externa,
 * nenhum banco real do navegador e nenhum canvas do sistema.
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
const { createDraft, getState, setPage } = await import('../src/app/state.js');
const {
  closeDatabase,
  getStory,
  initDatabase,
  listStories
} = await import('../src/app/database.js');
const {
  createDrawingEngine,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
  serializePageDrawing
} = await import('../src/app/drawing.js');
const storage = await import('../src/app/story-storage.js');

const {
  ensureStoryLoaded,
  flushPendingSaves,
  getSaveStatus,
  markPageChanged,
  requestSave,
  resetStoryStorageForTests,
  retrySave,
  subscribeSaveStatus
} = storage;

const activeEngines = [];

beforeEach(async () => {
  await closeDatabase();
  resetFakeIndexedDB();
  resetStoryStorageForTests();
});

afterEach(() => {
  activeEngines.splice(0).forEach((engine) => engine.destroy());
});

function signature(draft, page) {
  return JSON.stringify(serializePageDrawing(draft, page));
}

function attachEngine(draft, page, view) {
  const canvas = new FakeCanvas();
  let baseline = signature(draft, page);

  const engine = createDrawingEngine(canvas, draft, page, () => {
    const current = signature(draft, page);
    if (current === baseline) return;
    baseline = current;
    markPageChanged(draft, page);
    void requestSave(draft);
  });

  engine.setTool('pencil');
  engine.setColor(DEFAULT_COLOR);
  engine.setSize(DEFAULT_SIZE);
  activeEngines.push(engine);
  return { canvas, engine };
}

async function makeSession(title = 'História de teste') {
  createDraft({ title, author: 'Ana' });
  const draft = getState().draft;
  const view = { width: 360, height: 640 };

  await ensureStoryLoaded(draft, view);
  const { canvas, engine } = attachEngine(draft, draft.page, view);

  return { draft, canvas, engine, view };
}

function assertStatus(state) {
  assert.equal(getSaveStatus().state, state, `esperado status ${state}`);
}

test('1. criar história e salvar o primeiro desenho', async () => {
  const { draft, canvas, engine } = await makeSession();

  drawStroke(canvas, [[120, 120], [160, 150]], 1);
  await flushPendingSaves();

  const story = await getStory(draft.storyId);
  assert.equal(story.id, draft.storyId);
  assert.equal(story.title, 'História de teste');
  assert.equal(story.author, 'Ana');
  assert.equal(story.pageCount, 3);
  assert.equal(story.pages[0].drawing.actions.length, 1);
  assert.equal(story.pages[0].drawing.actions[0].ops[0].tool, 'pencil');
  assertStatus('saved');
  engine.destroy();
});

test('2. salvar múltiplos traços na ordem correta', async () => {
  const { draft, canvas } = await makeSession();

  drawStroke(canvas, [[60, 80], [90, 100]], 1);
  drawStroke(canvas, [[140, 180], [170, 200]], 2);
  drawStroke(canvas, [[220, 280], [250, 300]], 3);
  await flushPendingSaves();

  const drawing = (await getStory(draft.storyId)).pages[0].drawing;
  assert.deepEqual(drawing.actions.map((action) => action.ops[0].x).map((x) => Math.round(x)), [-120, -40, 40]);
  assert.equal(drawing.historyIndex, 3);
});

test('3. salvar borracha com cor branca e ferramenta preservadas', async () => {
  const { draft, canvas, engine } = await makeSession();
  engine.setTool('eraser');

  drawStroke(canvas, [[100, 100], [180, 140]], 4);
  await flushPendingSaves();

  const ops = (await getStory(draft.storyId)).pages[0].drawing.actions[0].ops;
  assert.ok(ops.length > 0);
  assert.ok(ops.every((op) => op.tool === 'eraser' && op.color === '#ffffff'));
});

test('4. salvar Apagar tudo como ação de limpeza', async () => {
  const { draft, canvas, engine } = await makeSession();

  drawStroke(canvas, [[100, 100], [160, 160]], 5);
  engine.clear();
  await flushPendingSaves();

  const actions = (await getStory(draft.storyId)).pages[0].drawing.actions;
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.at(-1), { kind: 'clear' });
});

test('5. salvar Desfazer com o histórico de refazer preservado', async () => {
  const { draft, canvas, engine } = await makeSession();

  drawStroke(canvas, [[80, 100], [110, 130]], 6);
  drawStroke(canvas, [[180, 200], [210, 230]], 7);
  engine.undo();
  await flushPendingSaves();

  const drawing = (await getStory(draft.storyId)).pages[0].drawing;
  assert.equal(drawing.actions.length, 2);
  assert.equal(drawing.historyIndex, 1);
  assert.equal(drawing.actions[1].ops[0].tool, 'pencil');
});

test('6. salvar Refazer após o Desfazer', async () => {
  const { draft, canvas, engine } = await makeSession();

  drawStroke(canvas, [[80, 100], [110, 130]], 8);
  drawStroke(canvas, [[180, 200], [210, 230]], 9);
  engine.undo();
  await flushPendingSaves();
  engine.redo();
  await flushPendingSaves();

  const drawing = (await getStory(draft.storyId)).pages[0].drawing;
  assert.equal(drawing.historyIndex, 2);
  assert.equal(drawing.actions.length, 2);
});

test('7. recuperar desenho após fechar e reabrir a conexão', async () => {
  const first = await makeSession('Persistente');
  drawStroke(first.canvas, [[90, 110], [150, 170]], 10);
  await flushPendingSaves();

  const saved = (await getStory(first.draft.storyId)).pages[0].drawing;
  await closeDatabase();
  await initDatabase();

  createDraft({ title: 'Rascunho novo', author: 'Outro', storyId: first.draft.storyId });
  const recovered = getState().draft;
  await ensureStoryLoaded(recovered, first.view);

  assert.equal(recovered.title, 'Persistente');
  assert.equal(recovered.author, 'Ana');
  assert.deepEqual(serializePageDrawing(recovered, 1), saved);
});

test('8. recuperar histórico de Desfazer/Refazer', async () => {
  const first = await makeSession('Histórico');
  drawStroke(first.canvas, [[60, 80], [90, 100]], 11);
  drawStroke(first.canvas, [[140, 180], [170, 200]], 12);
  drawStroke(first.canvas, [[220, 280], [250, 300]], 13);
  first.engine.undo();
  first.engine.undo();
  await flushPendingSaves();

  const saved = (await getStory(first.draft.storyId)).pages[0].drawing;
  assert.equal(saved.historyIndex, 1);

  await closeDatabase();
  await initDatabase();
  createDraft({ title: 'Temporário', author: 'Temporário', storyId: first.draft.storyId });
  const recovered = getState().draft;
  await ensureStoryLoaded(recovered, first.view);

  const restored = serializePageDrawing(recovered, 1);
  assert.equal(restored.historyIndex, 1);
  assert.equal(restored.actions.length, 3);
  assert.equal(restored.actions[1].ops[0].tool, 'pencil');
  assert.equal(restored.actions[2].ops[0].tool, 'pencil');

  const { engine: replay } = attachEngine(recovered, 1, first.view);
  assert.equal(replay.canUndo(), true);
  assert.equal(replay.canRedo(), true);
});

test('9. salvar alterações em páginas diferentes', async () => {
  const { draft, view } = await makeSession();
  const pageOne = attachEngine(draft, 1, view);
  drawStroke(pageOne.canvas, [[80, 100], [120, 140]], 14);

  setPage(2);
  const pageTwo = attachEngine(draft, 2, view);
  drawStroke(pageTwo.canvas, [[200, 300], [240, 340]], 15);
  await flushPendingSaves();

  const stored = await getStory(draft.storyId);
  assert.equal(stored.pages[0].drawing.actions.length, 1);
  assert.equal(stored.pages[1].drawing.actions.length, 1);
  assert.ok(stored.pages[0].updatedAt);
  assert.ok(stored.pages[1].updatedAt);
});

test('10. trocar rapidamente de página durante gravações', async () => {
  const { draft, view } = await makeSession();
  const first = attachEngine(draft, 1, view);
  drawStroke(first.canvas, [[70, 90], [100, 120]], 16);

  setPage(2);
  const second = attachEngine(draft, 2, view);
  drawStroke(second.canvas, [[220, 260], [260, 300]], 17);

  setPage(3);
  const third = attachEngine(draft, 3, view);
  drawStroke(third.canvas, [[120, 520], [170, 560]], 18);

  await flushPendingSaves();

  const stories = await listStories();
  assert.equal(stories.length, 1);
  assert.deepEqual(stories[0].pages.map((page) => page.drawing.actions.length), [1, 1, 1]);
});

test('11. gravação antiga não sobrescreve a mais recente', async () => {
  const { draft, canvas } = await makeSession();

  drawStroke(canvas, [[80, 100], [110, 130]], 19);
  void requestSave(draft);

  draft.title = 'Título mais recente';
  markPageChanged(draft, 1);
  await requestSave(draft);

  const stories = await listStories();
  assert.equal(stories.length, 1);
  assert.equal(stories[0].id, draft.storyId);
  assert.equal(stories[0].title, 'Título mais recente');
  assertStatus('saved');
});

test('12. tratar falha de quota sem perder o registro anterior', async () => {
  const { draft, canvas } = await makeSession();
  const before = await getStory(draft.storyId);
  const quota = new Error('sem espaço');
  quota.name = 'QuotaExceededError';

  setFakeFailure('put', quota);
  try {
    drawStroke(canvas, [[90, 100], [130, 140]], 20);
    await flushPendingSaves();

    assertStatus('error');
    assert.equal(getSaveStatus().error.code, 'QUOTA_EXCEEDED');
    assert.deepEqual(await getStory(draft.storyId), before);
  } finally {
    setFakeFailure('put', null);
  }
});

test('13. tratar falha de transação sem apagar a história', async () => {
  const { draft, canvas } = await makeSession();
  const before = await getStory(draft.storyId);
  const abort = new Error('abortada');
  abort.name = 'AbortError';

  setFakeFailure('put', abort);
  try {
    drawStroke(canvas, [[100, 110], [150, 160]], 21);
    await flushPendingSaves();

    assertStatus('error');
    assert.equal(getSaveStatus().error.code, 'TRANSACTION_FAILED');
    assert.deepEqual(await getStory(draft.storyId), before);
  } finally {
    setFakeFailure('put', null);
  }
});

test('14. repetir gravação após erro', async () => {
  const { draft, canvas } = await makeSession();
  const quota = new Error('sem espaço');
  quota.name = 'QuotaExceededError';

  setFakeFailure('put', quota);
  drawStroke(canvas, [[100, 120], [140, 160]], 22);
  await flushPendingSaves();
  assertStatus('error');
  setFakeFailure('put', null);

  await retrySave(draft);
  await flushPendingSaves();

  assertStatus('saved');
  const story = await getStory(draft.storyId);
  assert.equal(story.pages[0].drawing.actions.length, 1);
  assert.equal((await listStories()).length, 1);
});

test('15. estado Salvo só aparece depois da confirmação', async () => {
  const { draft } = await makeSession();
  const before = await getStory(draft.storyId);
  const states = [];
  const unsubscribe = subscribeSaveStatus((next) => states.push(next.state));

  const pending = requestSave(draft);
  assertStatus('saving');
  assert.deepEqual(await getStory(draft.storyId), before);

  await pending;
  unsubscribe();

  assert.ok(states.includes('saving'));
  assert.equal(states.at(-1), 'saved');
  assertStatus('saved');
});

test('16. desenho continua funcionando após a recuperação', async () => {
  const first = await makeSession('Recuperação');
  drawStroke(first.canvas, [[100, 120], [150, 170]], 23);
  await flushPendingSaves();
  const saved = (await getStory(first.draft.storyId)).pages[0].drawing;

  await closeDatabase();
  await initDatabase();
  createDraft({ title: 'Temporário', author: 'Temporário', storyId: first.draft.storyId });
  const recovered = getState().draft;
  await ensureStoryLoaded(recovered, first.view);

  const replay = attachEngine(recovered, 1, first.view);
  assert.equal(replay.engine.canUndo(), true);
  assert.equal(replay.engine.canRedo(), false);

  drawStroke(replay.canvas, [[200, 260], [250, 300]], 24);
  await flushPendingSaves();
  replay.engine.undo();
  await flushPendingSaves();
  replay.engine.redo();
  await flushPendingSaves();

  const finalDrawing = (await getStory(recovered.storyId)).pages[0].drawing;
  assert.deepEqual(finalDrawing.actions.slice(0, saved.actions.length), saved.actions);
  assert.equal(finalDrawing.actions.length, 2);
  assert.equal(finalDrawing.historyIndex, 2);
});

test('17. IndexedDB indisponível mantém o rascunho em memória', async () => {
  await closeDatabase();
  const fake = globalThis.indexedDB;
  delete globalThis.indexedDB;

  try {
    createDraft({ title: 'Sem banco', author: 'Ana' });
    const draft = getState().draft;
    const status = await ensureStoryLoaded(draft, { width: 360, height: 640 });

    assert.equal(status.state, 'error');
    assert.equal(status.error.code, 'UNAVAILABLE');
    assert.equal(draft.title, 'Sem banco');
    assert.equal(draft.author, 'Ana');
    assert.equal(draft.storyLoaded, false);
    assert.equal(draft.drawingsRestored, false);
  } finally {
    globalThis.indexedDB = fake;
  }
});

test('18. falha na recuperação preserva o rascunho e permite nova tentativa', async () => {
  const first = await makeSession('Recuperar depois');
  drawStroke(first.canvas, [[90, 110], [140, 160]], 25);
  await flushPendingSaves();
  const saved = (await getStory(first.draft.storyId)).pages[0].drawing;

  await closeDatabase();
  await initDatabase();
  createDraft({ title: 'Temporário', author: 'Temporário', storyId: first.draft.storyId });
  const recovered = getState().draft;

  const abort = new Error('leitura abortada');
  abort.name = 'AbortError';
  setFakeFailure('get', abort);
  let status;
  try {
    status = await ensureStoryLoaded(recovered, first.view);
  } finally {
    setFakeFailure('get', null);
  }

  assert.equal(status.state, 'error');
  assert.equal(status.error.code, 'TRANSACTION_FAILED');
  assert.equal(recovered.title, 'Temporário');
  assert.equal(recovered.storyLoaded, false);
  assert.equal(recovered.drawingsRestored, false);

  status = await ensureStoryLoaded(recovered, first.view);
  assert.equal(status.state, 'saved');
  assert.equal(recovered.title, 'Recuperar depois');
  assert.deepEqual(serializePageDrawing(recovered, 1), saved);
});

test('19. fechar a conexão durante a gravação preserva a nova tentativa', async () => {
  const { draft, canvas } = await makeSession();
  const before = await getStory(draft.storyId);
  const abort = new Error('conexão fechada');
  abort.name = 'AbortError';

  setFakeFailure('put', abort);
  try {
    drawStroke(canvas, [[130, 140], [180, 190]], 26);
    await closeDatabase();
    await flushPendingSaves();

    assertStatus('error');
    assert.equal(getSaveStatus().error.code, 'TRANSACTION_FAILED');
  } finally {
    setFakeFailure('put', null);
  }

  assert.deepEqual(await getStory(draft.storyId), before);
  await retrySave(draft);
  await flushPendingSaves();

  assertStatus('saved');
  assert.equal((await getStory(draft.storyId)).pages[0].drawing.actions.length, 1);
  assert.equal((await listStories()).length, 1);
});
