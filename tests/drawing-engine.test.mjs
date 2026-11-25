/**
 * Testes do motor de desenho sem dependências externas.
 *
 * Executar com:
 *   node --test tests/drawing-engine.test.mjs
 *
 * O DOM usado aqui é mínimo: apenas o necessário para registrar chamadas 2D e
 * simular eventos de ponteiro. As coordenadas verificadas são as coordenadas
 * lógicas recebidas pelo contexto, antes da transformação para bitmap.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
    this.transform = [1, 0, 0, 1, 0, 0];
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.strokeStyle = '#000000';
    this.fillStyle = '#000000';
    this.path = [];
  }

  setTransform(a, b, c, d, e, f) {
    this.transform = [a, b, c, d, e, f];
  }

  fillRect(...args) {
    this.calls.push({
      type: 'fillRect',
      args,
      transform: [...this.transform],
      fillStyle: this.fillStyle
    });
  }

  drawImage(...args) {
    this.calls.push({ type: 'drawImage', args, transform: [...this.transform] });
  }

  beginPath() {
    this.path = [];
  }

  moveTo(x, y) {
    this.path.push({ type: 'moveTo', x, y });
  }

  quadraticCurveTo(cx, cy, x, y) {
    this.path.push({ type: 'quadraticCurveTo', cx, cy, x, y });
  }

  arc(x, y, r, start, end) {
    this.path.push({ type: 'arc', x, y, r, start, end });
  }

  fill() {
    this.calls.push({
      type: 'fill',
      path: [...this.path],
      transform: [...this.transform],
      fillStyle: this.fillStyle,
      lineWidth: this.lineWidth
    });
  }

  stroke() {
    this.calls.push({
      type: 'stroke',
      path: [...this.path],
      transform: [...this.transform],
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth
    });
  }
}

class FakeCanvas {
  constructor() {
    this.width = 300;
    this.height = 150;
    this.context = new FakeContext(this);
    this.rect = { left: 0, top: 0, width: 360, height: 200 };
    this.listeners = new Map();
  }

  getContext() {
    return this.context;
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.forEach((handler) => handler(event));
  }

  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}

globalThis.createdCanvases = [];

globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = new FakeCanvas();
    globalThis.createdCanvases.push(canvas);
    return canvas;
  }
};

globalThis.window = {
  devicePixelRatio: 2,
  addEventListener() {},
  removeEventListener() {}
};

globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
};

const {
  createDrawingEngine,
  DEFAULT_COLOR,
  DEFAULT_SIZE
} = await import('../src/app/drawing.js');

function makeEngine(width, height, dpr = 2, options = {}) {
  window.devicePixelRatio = dpr;
  globalThis.createdCanvases.length = 0;

  const canvas = new FakeCanvas();
  canvas.rect = { left: 0, top: 0, width, height };
  const draft = options.draft || {};
  const historyStates = [];
  const engine = createDrawingEngine(
    canvas,
    draft,
    options.page || 1,
    (state) => historyStates.push(state)
  );

  engine.setTool('pencil');
  engine.setColor(DEFAULT_COLOR);
  engine.setSize(DEFAULT_SIZE);

  return {
    canvas,
    engine,
    draft,
    context: canvas.context,
    bufferContext: globalThis.createdCanvases.at(-1)?.context,
    historyStates
  };
}

function pointerEvent(type, x, y, pointerId = 1, extra = {}) {
  return {
    pointerId,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pressure: 0.5,
    preventDefault() {
      this.defaultPrevented = true;
    },
    getCoalescedEvents() {
      return [];
    },
    ...extra
  };
}

function drawStroke(canvas, points, pointerId = 1) {
  canvas.dispatch('pointerdown', pointerEvent('pointerdown', ...points[0], pointerId));
  for (const point of points.slice(1, -1)) {
    canvas.dispatch('pointermove', pointerEvent('pointermove', ...point, pointerId));
  }
  canvas.dispatch('pointerup', pointerEvent('pointerup', ...points.at(-1), pointerId));
}

function dots(context) {
  return context.calls
    .filter((call) => call.type === 'fill')
    .map((call) => call.path.find((item) => item.type === 'arc'))
    .filter(Boolean);
}

function segments(context) {
  return context.calls
    .filter((call) => call.type === 'stroke')
    .map((call) => call.path.find((item) => item.type === 'quadraticCurveTo'))
    .filter(Boolean);
}

function near(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperado ${expected}, recebido ${actual}`
  );
}

test('traço começa e avança junto à borda superior', () => {
  const { canvas, context } = makeEngine(360, 640);
  drawStroke(canvas, [[180, 2], [180, 20], [180, 40]]);

  near(dots(context)[0].x, 0);
  near(dots(context)[0].y, -318);
  assert.ok(segments(context).some((point) => point.y > -300));
});

test('traço começa e avança junto à borda inferior', () => {
  const { canvas, context } = makeEngine(360, 640);
  drawStroke(canvas, [[180, 638], [180, 620], [180, 600]]);

  near(dots(context)[0].y, 318);
  assert.ok(segments(context).some((point) => point.y < 300));
});

test('traço começa e avança junto à borda esquerda', () => {
  const { canvas, context } = makeEngine(360, 640);
  drawStroke(canvas, [[2, 320], [20, 320], [40, 320]]);

  near(dots(context)[0].x, -178);
  near(dots(context)[0].y, 0);
  assert.ok(segments(context).some((point) => point.x > -150));
});

test('traço começa e avança junto à borda direita', () => {
  const { canvas, context } = makeEngine(360, 640);
  drawStroke(canvas, [[358, 320], [340, 320], [320, 320]]);

  near(dots(context)[0].x, 178);
  assert.ok(segments(context).some((point) => point.x < 150));
});

test('traço diagonal atravessa a área inteira sem zona morta', () => {
  const { canvas, context } = makeEngine(360, 640);
  drawStroke(canvas, [[3, 3], [180, 320], [357, 637]]);

  const points = segments(context);
  assert.ok(points.some((point) => point.cx < -100 && point.cy < -100));
  assert.ok(points.some((point) => point.x > 100 && point.y > 100));
});

test('largura maior que o buffer antigo não é limitada a 600 unidades', () => {
  const { canvas, context } = makeEngine(780, 320);
  drawStroke(canvas, [[778, 160], [700, 160]]);

  assert.ok(dots(context)[0].x > 300);
  near(dots(context)[0].x, 388);
});

test('lápis, pincel e borracha usam a mesma conversão de coordenadas', () => {
  const { canvas, engine, context } = makeEngine(360, 640);

  engine.setTool('brush');
  drawStroke(canvas, [[180, 2], [180, 40]], 11);
  near(dots(context).at(-1).y, -318);
  assert.equal(context.calls.filter((call) => call.type === 'stroke').at(-1).lineWidth, 18);

  engine.setTool('eraser');
  drawStroke(canvas, [[180, 638], [180, 600]], 12);
  near(dots(context).at(-1).y, 318);
  assert.equal(context.calls.filter((call) => call.type === 'fill').at(-1).fillStyle, '#ffffff');
});

test('eventos coalescidos preservam o ponto final', () => {
  const { canvas, context } = makeEngine(360, 640);
  const down = pointerEvent('pointerdown', 180, 2, 21);
  const move = pointerEvent('pointermove', 180, 300, 21);
  move.getCoalescedEvents = () => [
    pointerEvent('pointermove', 180, 100, 21),
    pointerEvent('pointermove', 180, 200, 21)
  ];
  const up = pointerEvent('pointerup', 180, 638, 21);

  canvas.dispatch('pointerdown', down);
  canvas.dispatch('pointermove', move);
  canvas.dispatch('pointerup', up);

  near(dots(context)[0].y, -318);
  assert.ok(segments(context).length >= 3);
  assert.ok(segments(context).at(-1).y > 100);
});

test('retrato, paisagem e volta ao retrato preservam o desenho', () => {
  const { canvas, engine, context } = makeEngine(360, 640);
  drawStroke(canvas, [[180, 100], [180, 300]]);
  const original = dots(context)[0];

  const containsOriginal = () => {
    const draw = context.calls.filter((call) => call.type === 'drawImage').at(-1);
    const [left, top, width, height] = draw.args.slice(5);
    assert.ok(
      original.x >= left && original.x <= left + width &&
      original.y >= top && original.y <= top + height,
      'o desenho anterior deve continuar dentro da área repintada'
    );
  };

  containsOriginal();

  canvas.rect = { left: 0, top: 0, width: 780, height: 320 };
  engine.redraw();
  containsOriginal();

  context.calls.length = 0;
  drawStroke(canvas, [[778, 160], [700, 160]]);
  near(dots(context)[0].x, 388);

  canvas.rect = { left: 0, top: 0, width: 360, height: 640 };
  engine.redraw();
  containsOriginal();
});

function countDots(context) {
  return context.calls.filter((call) => call.type === 'fill').length;
}

function countStrokes(context) {
  return context.calls.filter((call) => call.type === 'stroke').length;
}

test('desfazer e refazer um traço', () => {
  const { canvas, engine, bufferContext, historyStates } = makeEngine(360, 640);
  drawStroke(canvas, [[180, 100], [180, 300]]);
  assert.equal(engine.canUndo(), true);
  assert.equal(engine.canRedo(), false);

  bufferContext.calls.length = 0;
  engine.undo();
  assert.equal(engine.canUndo(), false);
  assert.equal(engine.canRedo(), true);
  assert.equal(countDots(bufferContext), 0);

  bufferContext.calls.length = 0;
  engine.redo();
  assert.equal(engine.canUndo(), true);
  assert.equal(engine.canRedo(), false);
  assert.ok(countDots(bufferContext) > 0);
  assert.ok(countStrokes(bufferContext) > 0);
  assert.deepEqual(historyStates.at(-1), { canUndo: true, canRedo: false });
});

test('desfazer e refazer vários traços em sequência', () => {
  const { canvas, engine, bufferContext } = makeEngine(360, 640);
  drawStroke(canvas, [[60, 100], [60, 300]], 1);
  drawStroke(canvas, [[180, 100], [180, 300]], 2);
  drawStroke(canvas, [[300, 100], [300, 300]], 3);

  for (let step = 0; step < 3; step += 1) {
    assert.equal(engine.undo(), true);
  }
  assert.equal(engine.canUndo(), false);
  assert.equal(engine.canRedo(), true);

  for (let step = 0; step < 3; step += 1) {
    assert.equal(engine.redo(), true);
  }
  assert.equal(engine.canUndo(), true);
  assert.equal(engine.canRedo(), false);

  bufferContext.calls.length = 0;
  engine.undo();
  bufferContext.calls.length = 0;
  engine.redo();
  assert.ok(countDots(bufferContext) >= 3);
});

test('desfazer uma ação da borracha', () => {
  const { canvas, engine, bufferContext } = makeEngine(360, 640);

  drawStroke(canvas, [[180, 100], [180, 300]], 1);
  engine.setTool('eraser');
  drawStroke(canvas, [[180, 100], [180, 300]], 2);

  bufferContext.calls.length = 0;
  engine.undo();
  const painted = bufferContext.calls.filter(
    (call) => call.type === 'fill' || call.type === 'stroke'
  );
  assert.ok(painted.length > 0);
  assert.ok(painted.some((call) => (call.fillStyle || call.strokeStyle) === DEFAULT_COLOR));
  assert.ok(!painted.some((call) => (call.fillStyle || call.strokeStyle) === '#ffffff'));
});

test('desfazer e refazer Apagar tudo', () => {
  const { canvas, engine, bufferContext } = makeEngine(360, 640);
  drawStroke(canvas, [[180, 100], [180, 300]]);

  engine.clear();
  assert.equal(engine.canUndo(), true);

  bufferContext.calls.length = 0;
  engine.undo();
  assert.ok(countDots(bufferContext) > 0);
  assert.ok(countStrokes(bufferContext) > 0);

  bufferContext.calls.length = 0;
  engine.redo();
  const whiteFills = bufferContext.calls.filter(
    (call) => call.type === 'fillRect' && call.fillStyle === '#ffffff'
  );
  assert.ok(whiteFills.length > 0);
  assert.equal(engine.canRedo(), false);
});

test('novo traço após desfazer elimina o histórico de refazer', () => {
  const { canvas, engine } = makeEngine(360, 640);
  drawStroke(canvas, [[80, 100], [80, 300]], 1);
  drawStroke(canvas, [[280, 100], [280, 300]], 2);

  engine.undo();
  assert.equal(engine.canRedo(), true);

  drawStroke(canvas, [[180, 100], [180, 300]], 3);
  assert.equal(engine.canRedo(), false);
  assert.equal(engine.canUndo(), true);
});

test('histórico é independente por página', () => {
  const draft = {};
  const first = makeEngine(360, 640, 2, { draft, page: 1 });
  drawStroke(first.canvas, [[180, 100], [180, 300]]);
  first.engine.destroy();

  const second = makeEngine(360, 640, 2, { draft, page: 2 });
  assert.equal(second.engine.canUndo(), false);
  drawStroke(second.canvas, [[180, 100], [180, 300]]);
  assert.equal(second.engine.canUndo(), true);
  second.engine.destroy();

  const again = makeEngine(360, 640, 2, { draft, page: 1 });
  assert.equal(again.engine.canUndo(), true);
  again.engine.undo();
  assert.equal(again.engine.canUndo(), false);

  const otherAgain = makeEngine(360, 640, 2, { draft, page: 2 });
  assert.equal(otherAgain.engine.canUndo(), true);
});

test('desfazer continua funcionando após redimensionamento', () => {
  const { canvas, engine } = makeEngine(360, 640);
  drawStroke(canvas, [[180, 100], [180, 300]]);

  canvas.rect = { left: 0, top: 0, width: 780, height: 320 };
  engine.redraw();
  const resizedBufferContext = globalThis.createdCanvases.at(-1).context;
  assert.equal(engine.canUndo(), true);

  resizedBufferContext.calls.length = 0;
  engine.undo();
  assert.equal(countDots(resizedBufferContext), 0);

  resizedBufferContext.calls.length = 0;
  engine.redo();
  assert.ok(countDots(resizedBufferContext) > 0);
});

test('desfazer e refazer funcionam no modo expandido', () => {
  const { canvas, engine, bufferContext } = makeEngine(1180, 760);
  drawStroke(canvas, [[590, 2], [590, 60], [590, 120]], 1);
  drawStroke(canvas, [[590, 758], [590, 700], [590, 640]], 2);

  bufferContext.calls.length = 0;
  engine.undo();
  assert.equal(countDots(bufferContext), 1);

  bufferContext.calls.length = 0;
  engine.undo();
  assert.equal(countDots(bufferContext), 0);

  bufferContext.calls.length = 0;
  engine.redo();
  assert.equal(countDots(bufferContext), 1);

  bufferContext.calls.length = 0;
  engine.redo();
  assert.equal(countDots(bufferContext), 2);
});

test('desfazer e refazer funcionam em retrato e paisagem', () => {
  const draft = {};
  const portrait = makeEngine(360, 640, 2, { draft, page: 1 });
  drawStroke(portrait.canvas, [[180, 100], [180, 300]]);
  portrait.engine.destroy();

  const landscape = makeEngine(780, 360, 2, { draft, page: 1 });
  assert.equal(landscape.engine.canUndo(), true);
  landscape.engine.undo();
  assert.equal(landscape.engine.canRedo(), true);
  landscape.engine.redo();
  assert.equal(landscape.engine.canUndo(), true);

  const bufferContext = globalThis.createdCanvases.at(-1).context;
  bufferContext.calls.length = 0;
  landscape.engine.undo();
  assert.equal(countDots(bufferContext), 0);
  landscape.engine.destroy();
});
