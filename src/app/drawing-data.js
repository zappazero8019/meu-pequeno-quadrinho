/**
 * Formato serializável das operações de desenho (Fase 3.1).
 *
 * Este módulo é puro: não usa canvas, contexto 2D, eventos nem funções. Ele
 * apenas valida e copia os dados que o motor de desenho já registra por página:
 * ações de traço (ponto/segmento com cor, espessura e ferramenta) e ações de
 * limpeza. Assim o IndexedDB recebe somente valores estruturalmente clonáveis.
 *
 * A reconstrução visual continua sendo feita pelo motor em memória. Aqui não
 * há restauração automática nem integração com o editor.
 */

export const DRAWING_DATA_VERSION = 1;

const VALID_TOOLS = new Set(['pencil', 'brush', 'eraser']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function invalid(message) {
  throw new TypeError(`Desenho inválido: ${message}`);
}

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(`${field} deve ser um número finito`);
  }
  return value;
}

function validColor(value, field) {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
    invalid(`${field} deve ser uma cor hexadecimal`);
  }
  return value;
}

/** Copia uma operação, descartando qualquer referência não serializável. */
function cloneOperation(operation, index) {
  if (!operation || typeof operation !== 'object') {
    invalid(`ops[${index}] não é um objeto`);
  }

  const width = finiteNumber(operation.width, `ops[${index}].width`);
  const color = validColor(operation.color, `ops[${index}].color`);
  const hasTool = Object.prototype.hasOwnProperty.call(operation, 'tool');
  if (hasTool && !VALID_TOOLS.has(operation.tool)) {
    invalid(`ops[${index}].tool não é uma ferramenta conhecida`);
  }

  const copy = { type: operation.type, width, color };
  if (hasTool) copy.tool = operation.tool;

  if (operation.type === 'dot') {
    copy.x = finiteNumber(operation.x, `ops[${index}].x`);
    copy.y = finiteNumber(operation.y, `ops[${index}].y`);
    return copy;
  }

  if (operation.type === 'segment') {
    copy.x1 = finiteNumber(operation.x1, `ops[${index}].x1`);
    copy.y1 = finiteNumber(operation.y1, `ops[${index}].y1`);
    copy.cx = finiteNumber(operation.cx, `ops[${index}].cx`);
    copy.cy = finiteNumber(operation.cy, `ops[${index}].cy`);
    copy.x2 = finiteNumber(operation.x2, `ops[${index}].x2`);
    copy.y2 = finiteNumber(operation.y2, `ops[${index}].y2`);
    return copy;
  }

  invalid(`ops[${index}].type desconhecido`);
}

/** Copia uma ação do histórico, preservando a ordem das operações. */
export function cloneDrawingAction(action, index = 0) {
  if (!action || typeof action !== 'object') {
    invalid(`actions[${index}] não é um objeto`);
  }

  if (action.kind === 'clear') return { kind: 'clear' };

  if (action.kind === 'stroke') {
    if (!Array.isArray(action.ops)) {
      invalid(`actions[${index}].ops deve ser uma lista`);
    }
    return {
      kind: 'stroke',
      ops: action.ops.map((operation, operationIndex) =>
        cloneOperation(operation, operationIndex)
      )
    };
  }

  invalid(`actions[${index}].kind desconhecido`);
}

/** Documento vazio usado para páginas recém-criadas. */
export function createEmptyDrawingDocument() {
  return { version: DRAWING_DATA_VERSION, actions: [], historyIndex: 0 };
}

/**
 * Valida e normaliza um documento completo antes de gravá-lo no banco.
 * `historyIndex` representa a posição atual de Desfazer/Refazer no motor.
 */
export function validateDrawingDocument(document) {
  if (!document || typeof document !== 'object') invalid('documento ausente');
  if (document.version !== DRAWING_DATA_VERSION) {
    invalid(`versão ${String(document.version)} não suportada`);
  }
  if (!Array.isArray(document.actions)) invalid('actions deve ser uma lista');

  const actions = document.actions.map((action, index) => cloneDrawingAction(action, index));
  const historyIndex = document.historyIndex === undefined
    ? actions.length
    : document.historyIndex;

  if (
    !Number.isInteger(historyIndex) ||
    historyIndex < 0 ||
    historyIndex > actions.length
  ) {
    invalid('historyIndex está fora do intervalo das ações');
  }

  return { version: DRAWING_DATA_VERSION, actions, historyIndex };
}
