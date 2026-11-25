/**
 * Testes da narração por página e dos controles do editor (modo expandido).
 *
 * Executar com:
 *   node --test tests/narration.test.mjs
 *
 * Nenhum microfone real, nenhum banco real e nenhum canvas do sistema são
 * usados: MediaRecorder, getUserMedia e áudio são fakes locais.
 */

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeCanvas } from './helpers/fake-canvas.mjs';
import {
  getFakeDatabase,
  installFakeIndexedDB,
  resetFakeIndexedDB,
  setFakeFailure
} from './helpers/fake-indexeddb.mjs';
import { createNarrationDeps } from './helpers/fake-narration.mjs';

const { FakeCanvas, drawStroke } = installFakeCanvas();
installFakeIndexedDB();

const {
  closeDatabase,
  createStory,
  DB_NAME,
  DB_VERSION,
  getNarration,
  getStory,
  initDatabase,
  listNarrations,
  listStories,
  NARRATION_STORE_NAME,
  STORE_NAME,
  saveNarrationForStory
} = await import('../src/app/database.js');
const { createEmptyDrawingDocument, validateDrawingDocument } = await import('../src/app/drawing-data.js');
const {
  createDrawingEngine,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
  serializePageDrawing
} = await import('../src/app/drawing.js');
const {
  createDraft,
  getState,
  setPage
} = await import('../src/app/state.js');
const {
  ensureStoryLoaded,
  flushPendingSaves,
  getSaveStatus,
  markPageChanged,
  requestSave,
  resetStoryStorageForTests
} = await import('../src/app/story-storage.js');
const narration = await import('../src/app/narration-controller.js');

const {
  cancelRecording,
  deletePageNarration,
  formatDuration,
  getNarrationStatus,
  isNarrationSupported,
  loadPageNarration,
  NARRATION_REASON,
  NARRATION_STATE,
  pauseNarration,
  playNarration,
  replayNarration,
  resetNarrationForTests,
  retrySaveNarration,
  startRecording,
  stopRecording,
  stopPlayback
} = narration;

const activeEngines = [];

beforeEach(async () => {
  await closeDatabase();
  resetFakeIndexedDB();
  resetStoryStorageForTests();
  resetNarrationForTests();
});

afterEach(() => {
  activeEngines.splice(0).forEach((engine) => engine.destroy());
});

function pages(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    id: `pagina-${index + 1}`,
    order: index,
    drawing: createEmptyDrawingDocument(),
    updatedAt: '2026-01-01T00:00:00.000Z'
  }));
}

async function makeStory(title) {
  return createStory({
    title,
    author: 'Ana',
    pages: pages(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
}

function key(storyId, pageNumber = 1) {
  return { storyId, pageId: `pagina-${pageNumber}` };
}

function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

async function recordAudio(target, harness, text = 'voz da criança', advanceMs = 0) {
  const started = await startRecording(target, harness.deps);
  assert.equal(started.ok, true, `gravação não iniciou: ${started.reason}`);

  const recorder = harness.Recorder.instances.at(-1);
  assert.ok(recorder, 'MediaRecorder não foi criado');
  recorder.chunks.push(new Blob([text], { type: 'audio/webm' }));
  if (advanceMs) harness.advance(advanceMs);

  return stopRecording(harness.deps);
}

function attachEngine(draft, page, view) {
  const canvas = new FakeCanvas();
  let baseline = JSON.stringify(serializePageDrawing(draft, page));

  const engine = createDrawingEngine(canvas, draft, page, () => {
    const current = JSON.stringify(serializePageDrawing(draft, page));
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

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('abortada'));
  });
}

test('1. gravar e recuperar áudio', async () => {
  const story = await makeStory('Gravação simples');
  const harness = createNarrationDeps();

  const result = await recordAudio(key(story.id), harness, 'primeira voz', 3200);

  assert.equal(result.ok, true, `falha ao salvar: ${result.reason}`);
  const saved = await getNarration(story.id, 'pagina-1');
  assert.ok(saved);
  assert.equal(await saved.blob.text(), 'primeira voz');
  assert.match(saved.mimeType, /^audio\/webm/);
  assert.ok(saved.durationMs >= 3000);

  await loadPageNarration(key(story.id), harness.deps);
  const status = getNarrationStatus();
  assert.equal(status.hasRecording, true);
  assert.match(status.message, /já tem narração/);
  assert.equal(formatDuration(saved.durationMs), '0:03');
});

test('2. associação correta entre história e página', async () => {
  const story = await makeStory('História associada');
  const other = await makeStory('Outra história');
  const harness = createNarrationDeps();

  await recordAudio(key(story.id, 2), harness, 'voz da página 2');

  const correct = await getNarration(story.id, 'pagina-2');
  assert.equal(await correct.blob.text(), 'voz da página 2');
  assert.equal(correct.storyId, story.id);
  assert.equal(correct.pageId, 'pagina-2');

  assert.equal(await getNarration(story.id, 'pagina-1'), null);
  assert.equal(await getNarration(story.id, 'pagina-3'), null);
  assert.equal(await getNarration(other.id, 'pagina-2'), null);
  assert.equal((await listNarrations(story.id)).length, 1);
  assert.equal((await listNarrations(other.id)).length, 0);
});

test('3. páginas com narrações independentes', async () => {
  const story = await makeStory('Duas narrações');
  const harness = createNarrationDeps();

  await recordAudio(key(story.id, 1), harness, 'narração um');
  await recordAudio(key(story.id, 3), harness, 'narração três');

  const first = await getNarration(story.id, 'pagina-1');
  const third = await getNarration(story.id, 'pagina-3');
  assert.notEqual(first.id, third.id);
  assert.equal(await first.blob.text(), 'narração um');
  assert.equal(await third.blob.text(), 'narração três');
  assert.equal(await getNarration(story.id, 'pagina-2'), null);
  assert.equal((await listNarrations(story.id)).length, 2);
});

test('4. reprodução, pausa, reprodução novamente e exclusão', async () => {
  const story = await makeStory('Ouvir narração');
  const harness = createNarrationDeps();
  await recordAudio(key(story.id), harness);

  const played = await playNarration(key(story.id), harness.deps);
  assert.equal(played.ok, true);
  assert.equal(harness.audios.length, 1);
  assert.equal(harness.audios[0].playCount, 1);
  assert.equal(getNarrationStatus().state, NARRATION_STATE.PLAYING);

  const paused = pauseNarration(harness.deps);
  assert.equal(paused.ok, true);
  assert.equal(harness.audios[0].paused, true);
  assert.equal(getNarrationStatus().message, 'Narração pausada.');

  const replayed = await replayNarration(key(story.id), harness.deps);
  assert.equal(replayed.ok, true);
  assert.equal(harness.audios.at(-1).playCount, 1);
  assert.equal(harness.audios.length, 2, 'reproduzir novamente recria o áudio do zero');

  stopPlayback(harness.deps);
  assert.equal(harness.urls.size, 0, 'a URL temporária do áudio foi liberada');

  const removed = await deletePageNarration(key(story.id), harness.deps);
  assert.equal(removed.ok, true);
  assert.equal(removed.deleted, true);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);
  assert.equal(getNarrationStatus().hasRecording, false);
});

test('5. persistência da narração após fechar e reabrir', async () => {
  const story = await makeStory('Persistente');
  const harness = createNarrationDeps();
  await recordAudio(key(story.id), harness, 'voz que volta');

  await closeDatabase();
  await initDatabase();

  const recovered = await getNarration(story.id, 'pagina-1');
  assert.ok(recovered);
  assert.equal(await recovered.blob.text(), 'voz que volta');

  createDraft({ title: 'Rascunho temporário', author: 'Outro', storyId: story.id });
  const draft = getState().draft;
  await ensureStoryLoaded(draft, { width: 360, height: 640 });
  assert.equal(draft.title, 'Persistente');
  assert.equal((await getNarration(draft.storyId, 'pagina-1')).durationMs, recovered.durationMs);
});

test('6. permissão negada ao microfone', async () => {
  const story = await makeStory('Permissão negada');
  const denied = namedError('NotAllowedError', 'usuário negou');
  const harness = createNarrationDeps({ getUserMediaError: denied });

  const result = await startRecording(key(story.id), harness.deps);

  assert.equal(result.ok, false);
  assert.equal(result.reason, NARRATION_REASON.PERMISSION_DENIED);
  assert.match(getNarrationStatus().message, /permissão/i);
  assert.equal(harness.streams.length, 0);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);
  assert.equal((await getStory(story.id)).title, 'Permissão negada');
});

test('7. navegador sem suporte a MediaRecorder', async () => {
  const story = await makeStory('Sem suporte');
  const harness = createNarrationDeps({ supported: false });

  assert.equal(isNarrationSupported(harness.deps), false);

  const result = await startRecording(key(story.id), harness.deps);

  assert.equal(result.ok, false);
  assert.equal(result.reason, NARRATION_REASON.UNSUPPORTED);
  assert.match(getNarrationStatus().message, /não suporta/i);
  assert.equal(harness.streams.length, 0);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);
});

test('8. falha de armazenamento preserva história e permite tentar novamente', async () => {
  const story = await makeStory('Falha de gravação');
  const before = await getStory(story.id);
  const harness = createNarrationDeps();

  setFakeFailure('put', namedError('AbortError', 'transação abortada'));
  let result;
  try {
    result = await recordAudio(key(story.id), harness, 'voz não salva');
  } finally {
    setFakeFailure('put', null);
  }

  assert.equal(result.ok, false);
  assert.equal(result.reason, NARRATION_REASON.STORAGE_ERROR);
  assert.match(getNarrationStatus().message, /não foi salva/i);
  assert.deepEqual(await getStory(story.id), before);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);

  const retried = await retrySaveNarration(harness.deps);
  assert.equal(retried.ok, true);
  assert.equal(await (await getNarration(story.id, 'pagina-1')).blob.text(), 'voz não salva');
});

test('9. quota excedida não apaga o desenho nem finge que salvou', async () => {
  const story = await makeStory('Quota excedida');
  const before = await getStory(story.id);
  const harness = createNarrationDeps();

  setFakeFailure('put', namedError('QuotaExceededError', 'sem espaço'));
  let result;
  try {
    result = await recordAudio(key(story.id), harness, 'voz grande');
  } finally {
    setFakeFailure('put', null);
  }

  assert.equal(result.ok, false);
  assert.equal(result.reason, NARRATION_REASON.QUOTA);
  assert.match(getNarrationStatus().message, /não foi salva/i);
  assert.deepEqual(await getStory(story.id), before);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);
});

test('10. migração do banco preserva histórias existentes', async () => {
  const oldStory = {
    id: 'historia-antiga',
    title: 'História antes da migração',
    author: 'Ana',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cover: null,
    pages: [{
      id: 'pagina-1',
      order: 0,
      drawing: createEmptyDrawingDocument(),
      updatedAt: '2026-01-01T00:00:00.000Z'
    }],
    pageCount: 1
  };

  const openV1 = globalThis.indexedDB.open(DB_NAME, 1);
  openV1.onupgradeneeded = () => openV1.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
  const dbV1 = await requestDone(openV1);
  const insert = dbV1.transaction(STORE_NAME, 'readwrite');
  insert.objectStore(STORE_NAME).put(oldStory);
  await transactionDone(insert);
  dbV1.close();

  await initDatabase();

  const record = getFakeDatabase(DB_NAME);
  assert.equal(record.version, DB_VERSION);
  assert.equal(record.stores.has(NARRATION_STORE_NAME), true);

  const stories = await listStories();
  assert.equal(stories.length, 1);
  assert.equal(stories[0].id, oldStory.id);
  assert.deepEqual(stories[0].pages[0].drawing, validateDrawingDocument(oldStory.pages[0].drawing));

  const saved = await saveNarrationForStory({
    storyId: oldStory.id,
    pageId: 'pagina-1',
    blob: new Blob(['narração migrada'], { type: 'audio/webm' }),
    durationMs: 1200
  });
  assert.ok(saved.narration);
  assert.equal((await getNarration(oldStory.id, 'pagina-1')).durationMs, 1200);
  assert.equal((await getStory(oldStory.id)).pages[0].drawing.actions.length, 0);
});

test('11. navegação entre páginas com narrações separadas', async () => {
  createDraft({ title: 'Navegação', author: 'Ana' });
  const draft = getState().draft;
  const view = { width: 360, height: 640 };
  await ensureStoryLoaded(draft, view);

  const first = attachEngine(draft, 1, view);
  drawStroke(first.canvas, [[80, 100], [120, 140]], 1);
  await flushPendingSaves();

  setPage(2);
  const second = attachEngine(draft, 2, view);
  drawStroke(second.canvas, [[200, 260], [250, 300]], 2);
  await flushPendingSaves();

  const harness = createNarrationDeps();
  await recordAudio(key(draft.storyId, 1), harness, 'voz página 1');
  await recordAudio(key(draft.storyId, 2), harness, 'voz página 2');

  const saved = await getStory(draft.storyId);
  assert.equal(saved.pages[0].drawing.actions.length, 1);
  assert.equal(saved.pages[1].drawing.actions.length, 1);
  assert.equal(await (await getNarration(draft.storyId, 'pagina-1')).blob.text(), 'voz página 1');
  assert.equal(await (await getNarration(draft.storyId, 'pagina-2')).blob.text(), 'voz página 2');
});

test('12. salvamento pendente é concluído antes da troca de página', async () => {
  createDraft({ title: 'Troca segura', author: 'Ana' });
  const draft = getState().draft;
  const view = { width: 360, height: 640 };
  await ensureStoryLoaded(draft, view);

  const { canvas } = attachEngine(draft, 1, view);
  drawStroke(canvas, [[90, 110], [140, 160]], 3);

  const pending = requestSave(draft);
  assert.equal(getSaveStatus().state, 'saving');
  await pending;
  await flushPendingSaves();

  setPage(2);
  const saved = await getStory(draft.storyId);
  assert.equal(saved.pages[0].drawing.actions.length, 1);
  assert.equal(getSaveStatus().state, 'saved');
});

test('13. apagar tudo não apaga a narração', async () => {
  createDraft({ title: 'Limpeza', author: 'Ana' });
  const draft = getState().draft;
  const view = { width: 360, height: 640 };
  await ensureStoryLoaded(draft, view);

  const { canvas, engine } = attachEngine(draft, 1, view);
  drawStroke(canvas, [[100, 120], [150, 180]], 4);
  await flushPendingSaves();

  const harness = createNarrationDeps();
  await recordAudio(key(draft.storyId), harness, 'narração preservada');
  engine.clear();
  await flushPendingSaves();

  const saved = await getStory(draft.storyId);
  assert.deepEqual(saved.pages[0].drawing.actions.at(-1), { kind: 'clear' });
  assert.equal(await (await getNarration(draft.storyId, 'pagina-1')).blob.text(), 'narração preservada');
  assert.equal((await listNarrations(draft.storyId)).length, 1);
});

test('14. narração preserva autosave e histórico de desenho', async () => {
  createDraft({ title: 'Histórico e voz', author: 'Ana' });
  const draft = getState().draft;
  const view = { width: 360, height: 640 };
  await ensureStoryLoaded(draft, view);

  const { canvas, engine } = attachEngine(draft, 1, view);
  drawStroke(canvas, [[80, 100], [120, 140]], 5);
  drawStroke(canvas, [[180, 220], [220, 260]], 6);
  engine.undo();
  engine.redo();
  await flushPendingSaves();
  const drawingBefore = serializePageDrawing(draft, 1);

  const harness = createNarrationDeps();
  await recordAudio(key(draft.storyId), harness, 'voz com histórico');

  const saved = await getStory(draft.storyId);
  assert.deepEqual(saved.pages[0].drawing, drawingBefore);
  assert.equal(saved.pages[0].drawing.historyIndex, 2);
  assert.equal(saved.pages[0].drawing.actions.length, 2);
  assert.equal(await (await getNarration(draft.storyId, 'pagina-1')).blob.text(), 'voz com histórico');

  await closeDatabase();
  await initDatabase();
  createDraft({ title: 'Rascunho', author: 'Outro', storyId: draft.storyId });
  const recovered = getState().draft;
  await ensureStoryLoaded(recovered, view);
  assert.deepEqual(serializePageDrawing(recovered, 1), drawingBefore);
  assert.equal((await getNarration(recovered.storyId, 'pagina-1')).durationMs > 0, true);
});

test('15. cancelar a gravação libera o microfone e não salva áudio', async () => {
  const story = await makeStory('Cancelamento');
  const harness = createNarrationDeps();

  await startRecording(key(story.id), harness.deps);
  const result = cancelRecording(harness.deps);

  assert.equal(result.reason, NARRATION_REASON.CANCELLED);
  assert.equal(harness.streams[0].tracks[0].stopped, true);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);
  assert.equal((await getStory(story.id)).title, 'Cancelamento');
});

test('16. microfone interrompido não salva áudio parcial', async () => {
  const story = await makeStory('Interrompida');
  const harness = createNarrationDeps();

  await startRecording(key(story.id), harness.deps);
  const recorder = harness.Recorder.instances.at(-1);
  recorder.chunks.push(new Blob(['parcial'], { type: 'audio/webm' }));
  recorder.endMicrophone();
  await Promise.resolve();

  const status = getNarrationStatus();
  assert.equal(status.state, NARRATION_STATE.ERROR);
  assert.equal(status.reason, NARRATION_REASON.INTERRUPTED);
  assert.match(status.message, /interrompida/i);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);
  assert.equal(harness.streams[0].tracks[0].stopped, true);
});

test('17. falha do MediaRecorder não salva áudio parcial', async () => {
  const story = await makeStory('Falha do gravador');
  const harness = createNarrationDeps();

  await startRecording(key(story.id), harness.deps);
  const recorder = harness.Recorder.instances.at(-1);
  recorder.chunks.push(new Blob(['parcial'], { type: 'audio/webm' }));
  recorder.fail(namedError('UnknownError', 'falha no gravador'));
  await Promise.resolve();

  const status = getNarrationStatus();
  assert.equal(status.state, NARRATION_STATE.ERROR);
  assert.equal(status.reason, NARRATION_REASON.RECORDING_ERROR);
  assert.match(status.message, /gravação falhou/i);
  assert.equal(await getNarration(story.id, 'pagina-1'), null);
});
