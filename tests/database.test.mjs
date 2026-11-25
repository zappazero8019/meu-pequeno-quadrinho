/**
 * Testes da infraestrutura IndexedDB da Fase 3.1.
 *
 * Executar com:
 *   node --test tests/database.test.mjs
 *
 * O banco usado aqui é um polyfill mínimo em `tests/helpers/fake-indexeddb.mjs`.
 * Ele não toca no banco real do navegador e não adiciona dependências externas.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  installFakeIndexedDB,
  resetFakeIndexedDB,
  setFakeFailure
} from './helpers/fake-indexeddb.mjs';

installFakeIndexedDB();

const {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  initDatabase,
  isDatabaseAvailable,
  closeDatabase,
  createStory,
  getStory,
  listStories,
  updateStory,
  deleteStory
} = await import('../src/app/database.js');

const { createEmptyDrawingDocument } = await import('../src/app/drawing-data.js');

beforeEach(async () => {
  await closeDatabase();
  resetFakeIndexedDB();
});

function pages(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `pagina-${index + 1}`,
    order: index,
    drawing: createEmptyDrawingDocument(),
    updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`
  }));
}

function storyInput(title = 'História de teste', extra = {}) {
  return {
    title,
    author: 'Ana',
    pages: pages(),
    ...extra
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, 'DatabaseError');
    assert.equal(error.code, code);
    return true;
  });
}

test('1. inicialização cria o banco na versão 1 com o object store de histórias', async () => {
  const db = await initDatabase();

  assert.equal(db.name, DB_NAME);
  assert.equal(db.version, DB_VERSION);
  assert.equal(db.objectStoreNames.contains(STORE_NAME), true);
  assert.equal(await isDatabaseAvailable(), true);
  assert.equal(await initDatabase(), db, 'a conexão deve ser reutilizada');
});

test('2. criação de uma história com identificador e datas estáveis', async () => {
  const story = await createStory(storyInput('Primeira aventura'));

  assert.equal(typeof story.id, 'string');
  assert.ok(story.id.length > 0);
  assert.equal(story.title, 'Primeira aventura');
  assert.equal(story.author, 'Ana');
  assert.equal(story.pageCount, 2);
  assert.equal(story.cover, null);
  assert.equal(story.createdAt, story.updatedAt);
});

test('3. busca pelo ID retorna a história ou null', async () => {
  const created = await createStory(storyInput('Buscável'));

  assert.deepEqual(await getStory(created.id), created);
  assert.equal(await getStory('id-que-nao-existe'), null);
});

test('4. listagem traz todas as histórias, da mais recente primeiro', async () => {
  await createStory(storyInput('Antiga', {
    updatedAt: '2026-01-01T00:00:00.000Z'
  }));
  await createStory(storyInput('Recente', {
    updatedAt: '2026-02-01T00:00:00.000Z'
  }));

  const listed = await listStories();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].title, 'Recente');
  assert.equal(listed[1].title, 'Antiga');
});

test('5. atualização substitui os dados sem duplicar a história', async () => {
  const created = await createStory(storyInput('Antes'));
  const updated = await updateStory(created.id, {
    title: 'Depois',
    author: 'Bia',
    pages: pages(3)
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.title, 'Depois');
  assert.equal(updated.author, 'Bia');
  assert.equal(updated.pageCount, 3);
  assert.ok(updated.updatedAt >= created.updatedAt);

  const listed = await listStories();
  assert.equal(listed.length, 1);
  assert.deepEqual(await getStory(created.id), updated);

  const withUndefined = await updateStory(created.id, { title: 'Depois', pages: undefined });
  assert.equal(withUndefined.pageCount, 3, 'undefined no patch não deve apagar páginas');
});

test('6. exclusão afeta exclusivamente a história solicitada', async () => {
  const first = await createStory(storyInput('Primeira'));
  const second = await createStory(storyInput('Segunda'));

  assert.equal(await deleteStory(first.id), true);
  assert.equal(await getStory(first.id), null);
  assert.equal((await getStory(second.id)).title, 'Segunda');
  assert.equal(await deleteStory(first.id), false);
  assert.equal((await listStories()).length, 1);
});

test('7. histórias diferentes permanecem isoladas', async () => {
  const first = await createStory(storyInput('Isolada A'));
  const second = await createStory(storyInput('Isolada B'));

  await updateStory(first.id, { title: 'A modificada' });

  assert.equal((await getStory(second.id)).title, 'Isolada B');
  assert.equal((await getStory(second.id)).pageCount, 2);

  await deleteStory(first.id);
  assert.equal((await getStory(second.id)).title, 'Isolada B');
});

test('8. persistência após fechar e reabrir a conexão', async () => {
  const created = await createStory(storyInput('Persistente'));

  await closeDatabase();
  const reopened = await initDatabase();
  assert.equal(reopened.version, DB_VERSION);

  assert.deepEqual(await getStory(created.id), created);
  assert.equal((await listStories()).length, 1);
});

test('9. armazenamento e recuperação de múltiplas páginas', async () => {
  const threePages = pages(3);
  const created = await createStory(storyInput('Três páginas', {
    pages: threePages
  }));

  assert.equal(created.pageCount, 3);
  assert.deepEqual(created.pages.map((page) => page.order), [0, 1, 2]);

  const loaded = await getStory(created.id);
  assert.deepEqual(loaded.pages, threePages);
});

test('10. preservação de coordenadas, cores, espessuras, ferramentas e limpeza', async () => {
  const drawing = {
    version: 1,
    historyIndex: 4,
    actions: [
      {
        kind: 'stroke',
        ops: [
          { type: 'dot', x: 12.5, y: -30.25, width: 10, color: '#ff5a5f', tool: 'pencil' },
          { type: 'segment', x1: 1, y1: 2, cx: 3, cy: 4, x2: 5, y2: 6, width: 10, color: '#ff5a5f', tool: 'pencil' }
        ]
      },
      {
        kind: 'stroke',
        ops: [
          { type: 'dot', x: 0, y: 0, width: 18, color: '#4d96ff', tool: 'brush' }
        ]
      },
      {
        kind: 'stroke',
        ops: [
          { type: 'dot', x: 9, y: 9, width: 30, color: '#ffffff', tool: 'eraser' }
        ]
      },
      { kind: 'clear' }
    ]
  };

  const created = await createStory(storyInput('Desenho completo', {
    pages: [{ id: 'unica', order: 0, drawing }]
  }));
  const loaded = await getStory(created.id);

  assert.deepEqual(loaded.pages[0].drawing, drawing);
  assert.equal(loaded.pages[0].drawing.actions[2].ops[0].tool, 'eraser');
  assert.equal(loaded.pages[0].drawing.actions[3].kind, 'clear');
});

test('11. ordem dos traços e posição de Desfazer/Refazer são preservadas', async () => {
  const actions = [10, 20, 30].map((x) => ({
    kind: 'stroke',
    ops: [{ type: 'dot', x, y: 0, width: 5, color: '#ff9f43', tool: 'pencil' }]
  }));
  const drawing = { version: 1, actions, historyIndex: 2 };

  const created = await createStory(storyInput('Ordem', {
    pages: [{ id: 'unica', order: 0, drawing }]
  }));
  const loaded = await getStory(created.id);
  const restored = loaded.pages[0].drawing;

  assert.deepEqual(restored.actions.map((action) => action.ops[0].x), [10, 20, 30]);
  assert.equal(restored.historyIndex, 2);
});

test('12. tratamento de indisponibilidade, quota, transação e falhas de leitura/gravação', async () => {
  delete globalThis.indexedDB;
  assert.equal(await isDatabaseAvailable(), false);
  await expectCode(createStory(storyInput('Sem banco')), 'UNAVAILABLE');
  installFakeIndexedDB();

  setFakeFailure('open', new Error('open falhou'));
  await expectCode(initDatabase(), 'OPEN_FAILED');
  setFakeFailure('open', null);

  setFakeFailure('add', new Error('gravação falhou'));
  await expectCode(createStory(storyInput('Falha de gravação')), 'WRITE_FAILED');
  setFakeFailure('add', null);

  const quotaError = new Error('quota');
  quotaError.name = 'QuotaExceededError';
  setFakeFailure('add', quotaError);
  await expectCode(createStory(storyInput('Sem espaço')), 'QUOTA_EXCEEDED');
  setFakeFailure('add', null);

  const created = await createStory(storyInput('Para abortar'));
  setFakeFailure('delete', new Error('delete falhou'));
  await expectCode(deleteStory(created.id), 'WRITE_FAILED');
  setFakeFailure('delete', null);

  const abortError = new Error('abortada');
  abortError.name = 'AbortError';
  setFakeFailure('delete', abortError);
  await expectCode(deleteStory(created.id), 'TRANSACTION_FAILED');
  setFakeFailure('delete', null);
});

test('13. comportamento diante de dados inválidos', async () => {
  await expectCode(createStory({ title: '   ', pages: [] }), 'INVALID_DATA');
  await expectCode(createStory(storyInput('ID inválido', { id: 123 })), 'INVALID_DATA');
  await expectCode(getStory(42), 'INVALID_DATA');

  const withFunction = {
    version: 1,
    actions: [{
      kind: 'stroke',
      ops: [{ type: 'dot', x: 0, y: 0, width: 5, color: '#ff0000', tool: () => {} }]
    }],
    historyIndex: 1
  };
  await expectCode(
    createStory(storyInput('Função', { pages: [{ id: 'p', order: 0, drawing: withFunction }] })),
    'INVALID_DATA'
  );

  await expectCode(
    createStory(storyInput('Ordem inválida', { pages: [{ id: 'p', order: -1 }] })),
    'INVALID_DATA'
  );

  const circularCover = {};
  circularCover.self = circularCover;
  await expectCode(createStory(storyInput('Circular', { cover: circularCover })), 'INVALID_DATA');

  const created = await createStory(storyInput('Atualização inexistente'));
  assert.equal(await updateStory('id-ausente', { title: 'Nada' }), null);
  assert.equal((await getStory(created.id)).title, 'Atualização inexistente');
});

test('14. compatibilidade com a estrutura real do motor de desenho', async () => {
  const { FakeCanvas, drawStroke } = (await import('./helpers/fake-canvas.mjs')).installFakeCanvas();
  const {
    createDrawingEngine,
    serializePageDrawing,
    DEFAULT_COLOR,
    DEFAULT_SIZE
  } = await import('../src/app/drawing.js');

  const canvas = new FakeCanvas();
  const draft = {};
  const engine = createDrawingEngine(canvas, draft, 1);

  engine.setTool('pencil');
  engine.setColor(DEFAULT_COLOR);
  engine.setSize(DEFAULT_SIZE);
  drawStroke(canvas, [[180, 100], [180, 300]], 1);

  engine.setTool('brush');
  drawStroke(canvas, [[100, 200], [260, 200]], 2);

  engine.setTool('eraser');
  drawStroke(canvas, [[180, 100], [180, 300]], 3);

  engine.clear();

  const drawing = serializePageDrawing(draft, 1);
  assert.equal(drawing.version, 1);
  assert.equal(drawing.actions.length, 4);
  assert.equal(drawing.historyIndex, 4);
  assert.equal(drawing.actions[0].ops[0].tool, 'pencil');
  assert.equal(drawing.actions[1].ops[0].tool, 'brush');
  assert.ok(drawing.actions[2].ops.every((op) => op.color === '#ffffff' && op.tool === 'eraser'));
  assert.equal(drawing.actions[3].kind, 'clear');

  engine.undo();
  assert.equal(serializePageDrawing(draft, 1).historyIndex, 3);

  const created = await createStory(storyInput('Do motor', {
    pages: [{ id: 'pagina-1', order: 0, drawing }]
  }));
  const loaded = await getStory(created.id);

  assert.deepEqual(loaded.pages[0].drawing, drawing);
  engine.destroy();
});
