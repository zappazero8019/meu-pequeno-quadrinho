/** DOM mínimo para testar a serialização a partir do motor de desenho real. */

export function installFakeCanvas() {
  class FakeContext {
    constructor(canvas) {
      this.canvas = canvas;
      this.lineWidth = 1;
      this.lineCap = 'butt';
      this.lineJoin = 'miter';
      this.strokeStyle = '#000000';
      this.fillStyle = '#000000';
    }

    setTransform() {}
    fillRect() {}
    drawImage() {}
    beginPath() {}
    moveTo() {}
    quadraticCurveTo() {}
    arc() {}
    fill() {}
    stroke() {}
  }

  class FakeCanvas {
    constructor() {
      this.width = 300;
      this.height = 150;
      this.context = new FakeContext(this);
      this.rect = { left: 0, top: 0, width: 360, height: 640 };
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

  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`tag inesperada: ${tag}`);
      return new FakeCanvas();
    }
  };

  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
    removeEventListener() {}
  };

  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  function pointerEvent(type, x, y, pointerId = 1) {
    return {
      pointerId,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pressure: 0.5,
      preventDefault() {},
      getCoalescedEvents() {
        return [];
      }
    };
  }

  function drawStroke(canvas, points, pointerId = 1) {
    canvas.dispatch('pointerdown', pointerEvent('pointerdown', ...points[0], pointerId));
    points.slice(1, -1).forEach((point) => {
      canvas.dispatch('pointermove', pointerEvent('pointermove', ...point, pointerId));
    });
    canvas.dispatch('pointerup', pointerEvent('pointerup', ...points.at(-1), pointerId));
  }

  return { FakeCanvas, pointerEvent, drawStroke };
}
