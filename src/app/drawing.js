/**
 * Motor de desenho da Fase 2.2.
 *
 * Responsabilidade: transformar eventos de ponteiro em traços em um canvas 2D
 * e manter o histórico de Desfazer/Refazer de cada página. A interface (botões,
 * cores, espessura) vive em `src/screens/editor.js`.
 *
 * O espaço lógico é centrado em (0, 0) e medido em pixels CSS: toda a área
 * visível do canvas é válida para desenho, independentemente da proporção da
 * tela. O buffer interno cresce quando necessário, copiando o conteúdo anterior
 * sem distorção. Nada é gravado em disco ou banco de dados.
 */

import {
  DRAWING_DATA_VERSION,
  cloneDrawingAction,
  createEmptyDrawingDocument,
  validateDrawingDocument
} from './drawing-data.js';

const LEGACY_WIDTH = 600;
const LEGACY_HEIGHT = 500;
const BUFFER_SCALE = 2;
const MAX_DPR = 3;
const EDGE_PADDING = 32;
const BACKGROUND = '#ffffff';

/**
 * Cada página guarda no máximo 30 ações. Ao completar uma ação nova depois do
 * limite, a ação mais antiga é descartada; os desenhos já feitos no canvas não
 * são alterados, mas deixam de poder ser desfeitos.
 */
const MAX_HISTORY_ACTIONS = 30;

export const DEFAULT_TOOL = 'pencil';
export const DEFAULT_COLOR = '#ff5a5f';
export const DEFAULT_SIZE = 10;

export const DRAWING_TOOLS = [
  { id: 'pencil', label: 'Lápis', icon: 'pencil' },
  { id: 'brush', label: 'Pincel', icon: 'brush' },
  { id: 'eraser', label: 'Borracha', icon: 'eraser' }
];

export const DRAWING_COLORS = [
  { name: 'Vermelho', value: '#ff5a5f' },
  { name: 'Laranja', value: '#ff9f43' },
  { name: 'Amarelo', value: '#f5b700' },
  { name: 'Verde', value: '#4ecb71' },
  { name: 'Azul', value: '#4d96ff' },
  { name: 'Roxo', value: '#5b45c6' },
  { name: 'Rosa', value: '#ef6ea8' },
  { name: 'Azul-marinho', value: '#26324a' }
];

export const DRAWING_SIZES = [
  { label: 'Fino', value: 5 },
  { label: 'Médio', value: 10 },
  { label: 'Grosso', value: 18 }
];

/** Preferências compartilhadas por todas as páginas da sessão atual. */
const preferences = {
  tool: DEFAULT_TOOL,
  color: DEFAULT_COLOR,
  size: DEFAULT_SIZE
};

/** Mapa fraco: quando um novo rascunho é criado, seus buffers podem ser coletados. */
const buffersByDraft = new WeakMap();

export function getDrawingPreferences() {
  return { ...preferences };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createHistory() {
  return { actions: [], index: 0 };
}

function canUndoHistory(history) {
  return history.index > 0;
}

function canRedoHistory(history) {
  return history.index < history.actions.length;
}

function appendHistoryAction(history, action) {
  // Um novo traço depois de Desfazer descarta o histórico de Refazer.
  history.actions.length = history.index;
  history.actions.push(action);

  if (history.actions.length > MAX_HISTORY_ACTIONS) {
    history.actions.splice(0, history.actions.length - MAX_HISTORY_ACTIONS);
  }

  history.index = history.actions.length;
}

function historyHasContent(history) {
  let hasContent = false;
  for (let index = 0; index < history.index; index += 1) {
    const action = history.actions[index];
    if (action.kind === 'clear') hasContent = false;
    else if (action.ops && action.ops.length) hasContent = true;
  }
  return hasContent;
}

function paintHistoryOp(context, operation) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = operation.width;
  context.strokeStyle = operation.color;
  context.fillStyle = operation.color;

  if (operation.type === 'dot') {
    context.beginPath();
    context.arc(operation.x, operation.y, operation.width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.beginPath();
  context.moveTo(operation.x1, operation.y1);
  context.quadraticCurveTo(operation.cx, operation.cy, operation.x2, operation.y2);
  context.stroke();
}

function applyHistory(record) {
  const { context, canvas, history } = record;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  applyBufferTransform(record);

  for (let index = 0; index < history.index; index += 1) {
    const action = history.actions[index];
    if (action.kind === 'clear') {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = BACKGROUND;
      context.fillRect(0, 0, canvas.width, canvas.height);
      applyBufferTransform(record);
      continue;
    }

    action.ops.forEach((operation) => paintHistoryOp(context, operation));
  }
}

function applyBufferTransform(record) {
  record.context.setTransform(
    BUFFER_SCALE,
    0,
    0,
    BUFFER_SCALE,
    -record.left * BUFFER_SCALE,
    -record.top * BUFFER_SCALE
  );
}

function createPageBufferFromBounds(left, top, width, height, history = createHistory()) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * BUFFER_SCALE));
  canvas.height = Math.max(1, Math.ceil(height * BUFFER_SCALE));

  const context = canvas.getContext('2d', { alpha: false });
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const record = { canvas, context, left, top, width, height, history };
  applyBufferTransform(record);
  return record;
}

function createPageBuffer(viewWidth, viewHeight) {
  const width = Math.max(1, viewWidth) + EDGE_PADDING * 2;
  const height = Math.max(1, viewHeight) + EDGE_PADDING * 2;

  return createPageBufferFromBounds(
    -width / 2,
    -height / 2,
    width,
    height
  );
}

function getPages(draft) {
  let pages = buffersByDraft.get(draft);
  if (!pages) {
    pages = new Map();
    buffersByDraft.set(draft, pages);
  }

  return pages;
}

function getPageBuffer(pages, page, viewWidth, viewHeight) {
  const stored = pages.get(page);

  // Converte buffers do formato antigo (600 × 500 unidades, origem no canto)
  // para o espaço lógico centralizado, preservando o desenho existente.
  if (stored && !stored.context && typeof stored.getContext === 'function') {
    const scale = Math.min(viewWidth / LEGACY_WIDTH, viewHeight / LEGACY_HEIGHT);
    const converted = createPageBuffer(LEGACY_WIDTH * scale, LEGACY_HEIGHT * scale);
    const destinationX = (-LEGACY_WIDTH / 2 * scale - converted.left) * BUFFER_SCALE;
    const destinationY = (-LEGACY_HEIGHT / 2 * scale - converted.top) * BUFFER_SCALE;

    converted.context.setTransform(1, 0, 0, 1, 0, 0);
    converted.context.drawImage(
      stored,
      destinationX,
      destinationY,
      stored.width * scale,
      stored.height * scale
    );
    applyBufferTransform(converted);
    pages.set(page, converted);
    return converted;
  }

  if (!stored) {
    const created = createPageBuffer(viewWidth, viewHeight);
    pages.set(page, created);
    return created;
  }

  return stored;
}

function ensureCoverage(pages, page, record, left, top, right, bottom) {
  if (
    left >= record.left &&
    top >= record.top &&
    right <= record.left + record.width &&
    bottom <= record.top + record.height
  ) {
    return record;
  }

  const newLeft = Math.min(record.left, left);
  const newTop = Math.min(record.top, top);
  const newRight = Math.max(record.left + record.width, right);
  const newBottom = Math.max(record.top + record.height, bottom);
  const grown = createPageBufferFromBounds(
    newLeft,
    newTop,
    newRight - newLeft,
    newBottom - newTop,
    record.history
  );

  grown.context.setTransform(1, 0, 0, 1, 0, 0);
  grown.context.drawImage(
    record.canvas,
    (record.left - newLeft) * BUFFER_SCALE,
    (record.top - newTop) * BUFFER_SCALE
  );
  applyBufferTransform(grown);
  pages.set(page, grown);

  return grown;
}

function midpoint(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

/**
 * Cria uma instância ligada a um elemento canvas já existente no DOM.
 * @param {HTMLCanvasElement} canvas elemento visível
 * @param {object} draft objeto de rascunho usado como chave dos buffers
 * @param {number} page página atual do rascunho
 */
export function createDrawingEngine(canvas, draft, page, onHistoryChange) {
  const visibleContext = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const pages = getPages(draft);

  let strokeRecording = null;
  let activePointerId = null;
  let previousPoint = null;
  let previousMidpoint = null;
  let resizeObserver = null;
  let destroyed = false;

  let buffer = null;
  let bufferContext = null;
  let viewWidth = 0;
  let viewHeight = 0;
  let pixelScale = 1;

  function notifyHistory() {
    if (typeof onHistoryChange !== 'function' || !buffer) return;
    onHistoryChange({
      canUndo: canUndoHistory(buffer.history),
      canRedo: canRedoHistory(buffer.history)
    });
  }

  function effectiveSize(event) {
    const base = preferences.size;

    if (preferences.tool === 'brush') return base * 1.8;
    if (preferences.tool === 'eraser') return Math.min(base * 2.2, 30);

    // Pressão é um bônus para canetas: sem ela o traço continua idêntico.
    if (
      event &&
      event.pointerType === 'pen' &&
      Number.isFinite(event.pressure) &&
      event.pressure > 0
    ) {
      return base * (0.5 + event.pressure * 0.75);
    }

    return base;
  }

  function configureStroke(context, event) {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = effectiveSize(event);
    context.strokeStyle = preferences.tool === 'eraser' ? BACKGROUND : preferences.color;
    context.fillStyle = context.strokeStyle;
  }

  function toBasePoint(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };

    // Um pixel CSS visível corresponde a uma unidade lógica. O limite aplicado
    // é apenas a própria borda do canvas, nunca o antigo retângulo 6:5.
    return {
      x: clamp(event.clientX - rect.left - rect.width / 2, -rect.width / 2, rect.width / 2),
      y: clamp(event.clientY - rect.top - rect.height / 2, -rect.height / 2, rect.height / 2)
    };
  }

  function drawOnBoth(contexts, draw, recordInto) {
    contexts.forEach((context) => {
      configureStroke(context, draw.event);
      draw.paint(context);
    });

    // Registra uma operação leve por traço concluído, nunca por pixel.
    if (recordInto) {
      recordInto.push({
        ...draw.op,
        width: bufferContext.lineWidth,
        color: bufferContext.strokeStyle,
        tool: preferences.tool
      });
    }
  }

  function drawDot(point, event, recordInto) {
    drawOnBoth([bufferContext, visibleContext], {
      event,
      op: { type: 'dot', x: point.x, y: point.y },
      paint(context) {
        context.beginPath();
        context.arc(point.x, point.y, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
      }
    }, recordInto);
  }

  function drawSegment(from, control, to, event, recordInto) {
    drawOnBoth([bufferContext, visibleContext], {
      event,
      op: {
        type: 'segment',
        x1: from.x,
        y1: from.y,
        cx: control.x,
        cy: control.y,
        x2: to.x,
        y2: to.y
      },
      paint(context) {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.quadraticCurveTo(control.x, control.y, to.x, to.y);
        context.stroke();
      }
    }, recordInto);
  }

  function repaintVisible() {
    if (!buffer) return;

    visibleContext.setTransform(1, 0, 0, 1, 0, 0);
    visibleContext.fillStyle = BACKGROUND;
    visibleContext.fillRect(0, 0, canvas.width, canvas.height);

    // Transformação idêntica à usada na conversão de coordenadas: o centro do
    // canvas é a origem lógica e a escala é uniforme (sem distorção).
    visibleContext.setTransform(
      pixelScale,
      0,
      0,
      pixelScale,
      (viewWidth * pixelScale) / 2,
      (viewHeight * pixelScale) / 2
    );
    visibleContext.drawImage(
      buffer.canvas,
      0,
      0,
      buffer.canvas.width,
      buffer.canvas.height,
      buffer.left,
      buffer.top,
      buffer.width,
      buffer.height
    );
  }

  function resize() {
    if (destroyed) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    viewWidth = rect.width;
    viewHeight = rect.height;
    pixelScale = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);

    const pixelWidth = Math.max(1, Math.round(viewWidth * pixelScale));
    const pixelHeight = Math.max(1, Math.round(viewHeight * pixelScale));

    // Só altera o bitmap quando o tamanho realmente muda: evita recriações
    // desnecessárias e mantém o traço atual intacto.
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    if (!buffer) buffer = getPageBuffer(pages, page, viewWidth, viewHeight);

    buffer = ensureCoverage(
      pages,
      page,
      buffer,
      -viewWidth / 2 - EDGE_PADDING,
      -viewHeight / 2 - EDGE_PADDING,
      viewWidth / 2 + EDGE_PADDING,
      viewHeight / 2 + EDGE_PADDING
    );
    bufferContext = buffer.context;

    repaintVisible();
  }

  function finishStroke(endPoint, event) {
    if (endPoint && previousPoint && previousMidpoint) {
      drawSegment(previousMidpoint, previousPoint, endPoint, event, strokeRecording);
    }

    const pointerId = activePointerId;
    activePointerId = null;
    previousPoint = null;
    previousMidpoint = null;

    if (strokeRecording && strokeRecording.length) {
      appendHistoryAction(buffer.history, { kind: 'stroke', ops: strokeRecording });
      notifyHistory();
    }
    strokeRecording = null;

    if (
      pointerId !== null &&
      typeof canvas.hasPointerCapture === 'function' &&
      canvas.hasPointerCapture(pointerId) &&
      typeof canvas.releasePointerCapture === 'function'
    ) {
      canvas.releasePointerCapture(pointerId);
    }
  }

  function handlePointerDown(event) {
    if (destroyed || activePointerId !== null || !bufferContext) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    activePointerId = event.pointerId;
    if (typeof canvas.setPointerCapture === 'function') {
      // Eventos sintéticos não têm um ponteiro ativo para capturar; nesse caso
      // seguimos sem captura em vez de interromper o traço.
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* captura indisponível */
      }
    }

    strokeRecording = [];
    previousPoint = toBasePoint(event);
    previousMidpoint = previousPoint;
    drawDot(previousPoint, event, strokeRecording);
  }

  function handlePointerMove(event) {
    if (destroyed || event.pointerId !== activePointerId || !previousPoint) return;

    event.preventDefault();
    const samples =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const points = samples.length ? samples : [event];

    points.forEach((sample) => {
      const point = toBasePoint(sample);
      const middle = midpoint(previousPoint, point);

      // Curva quadrática entre os pontos médios suaviza o traço sem atraso.
      drawSegment(previousMidpoint, previousPoint, middle, sample, strokeRecording);
      previousPoint = point;
      previousMidpoint = middle;
    });
  }

  function handlePointerUp(event) {
    if (destroyed || event.pointerId !== activePointerId) return;
    event.preventDefault();
    finishStroke(toBasePoint(event), event);
  }

  function handlePointerCancel(event) {
    if (destroyed || event.pointerId !== activePointerId) return;
    finishStroke(null, event);
  }

  function handleLostPointerCapture(event) {
    if (destroyed || event.pointerId !== activePointerId) return;
    finishStroke(null, event);
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerCancel);
  canvas.addEventListener('lostpointercapture', handleLostPointerCapture);

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  resize();
  notifyHistory();

  return {
    setTool(tool) {
      if (DRAWING_TOOLS.some((item) => item.id === tool)) preferences.tool = tool;
    },
    setColor(color) {
      if (DRAWING_COLORS.some((item) => item.value === color)) preferences.color = color;
    },
    setSize(size) {
      if (DRAWING_SIZES.some((item) => item.value === size)) preferences.size = size;
    },
    canUndo() {
      return Boolean(buffer && canUndoHistory(buffer.history));
    },
    canRedo() {
      return Boolean(buffer && canRedoHistory(buffer.history));
    },
    undo() {
      if (destroyed || !buffer || !canUndoHistory(buffer.history)) return false;

      finishStroke(null, null);
      buffer.history.index -= 1;
      applyHistory(buffer);
      repaintVisible();
      notifyHistory();
      return true;
    },
    redo() {
      if (destroyed || !buffer || !canRedoHistory(buffer.history)) return false;

      finishStroke(null, null);
      buffer.history.index += 1;
      applyHistory(buffer);
      repaintVisible();
      notifyHistory();
      return true;
    },
    clear() {
      if (destroyed || !bufferContext) return;

      // Encerra um traço em andamento para que nenhum segmento pendente volte
      // a aparecer depois da limpeza.
      finishStroke(null, null);

      if (historyHasContent(buffer.history)) {
        appendHistoryAction(buffer.history, { kind: 'clear' });
      }

      bufferContext.setTransform(1, 0, 0, 1, 0, 0);
      bufferContext.fillStyle = BACKGROUND;
      bufferContext.fillRect(0, 0, buffer.canvas.width, buffer.canvas.height);
      applyBufferTransform(buffer);

      repaintVisible();
      notifyHistory();
    },
    redraw: resize,
    destroy() {
      if (destroyed) return;
      finishStroke(null, null);
      destroyed = true;

      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      canvas.removeEventListener('lostpointercapture', handleLostPointerCapture);

      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', resize);
    }
  };
}

/**
 * Converte o histórico em memória de uma página em um documento serializável.
 * Não há canvas, contexto 2D nem função no resultado: apenas a sequência de
 * ações e a posição atual de Desfazer/Refazer (`historyIndex`).
 *
 * Esta função é a ponte com o banco de dados. Ela não salva nada e não altera o
 * desenho exibido; quem decide quando gravar é a camada de persistência.
 */
export function serializePageDrawing(draft, page) {
  const pages = buffersByDraft.get(draft);
  const record = pages?.get(page);

  if (!record || !record.history) return createEmptyDrawingDocument();

  const history = record.history;
  const actions = history.actions.map((action) => cloneDrawingAction(action));
  const historyIndex = Math.min(
    Math.max(0, Number.isFinite(history.index) ? Math.trunc(history.index) : actions.length),
    actions.length
  );

  return { version: DRAWING_DATA_VERSION, actions, historyIndex };
}

/** Limites lógicos necessários para repintar todas as operações restauradas. */
function drawingBounds(actions) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  actions.forEach((action) => {
    if (action.kind !== 'stroke') return;

    action.ops.forEach((op) => {
      const radius = op.width / 2;
      const xs = op.type === 'dot' ? [op.x] : [op.x1, op.cx, op.x2];
      const ys = op.type === 'dot' ? [op.y] : [op.y1, op.cy, op.y2];

      xs.forEach((x) => {
        left = Math.min(left, x - radius);
        right = Math.max(right, x + radius);
      });
      ys.forEach((y) => {
        top = Math.min(top, y - radius);
        bottom = Math.max(bottom, y + radius);
      });
    });
  });

  if (!Number.isFinite(left)) return null;
  return { left, top, right, bottom };
}

/**
 * Reconstrói o buffer de uma página a partir de um documento serializado.
 *
 * Cria um buffer novo (nunca reaproveita canvas antigo), dimensionado para a
 * área visível atual e para todas as coordenadas registradas. Depois repinta o
 * histórico completo e restaura `historyIndex`, mantendo Desfazer/Refazer.
 * O espaço lógico e a pintura são exatamente os mesmos do traço ao vivo.
 */
export function restorePageDrawing(draft, page, drawing, view = {}) {
  const document = validateDrawingDocument(drawing);
  const actions = document.actions.map((action, index) => cloneDrawingAction(action, index));

  const viewWidth = Math.max(1, Number(view.width) || 360);
  const viewHeight = Math.max(1, Number(view.height) || 640);
  const bounds = drawingBounds(actions);

  const left = Math.min(-viewWidth / 2 - EDGE_PADDING, bounds ? bounds.left - EDGE_PADDING : Infinity);
  const top = Math.min(-viewHeight / 2 - EDGE_PADDING, bounds ? bounds.top - EDGE_PADDING : Infinity);
  const right = Math.max(viewWidth / 2 + EDGE_PADDING, bounds ? bounds.right + EDGE_PADDING : -Infinity);
  const bottom = Math.max(viewHeight / 2 + EDGE_PADDING, bounds ? bounds.bottom + EDGE_PADDING : -Infinity);

  const record = createPageBufferFromBounds(left, top, right - left, bottom - top, {
    actions,
    index: document.historyIndex
  });

  applyHistory(record);
  getPages(draft).set(page, record);

  return { version: DRAWING_DATA_VERSION, actions, historyIndex: document.historyIndex };
}
