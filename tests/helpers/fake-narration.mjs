/** Fakes mínimos de MediaRecorder, microfone e áudio para testes sem hardware. */

class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type, event = {}) {
    this.listeners.get(type)?.forEach((handler) => handler(event));
  }
}

class FakeTrack extends Emitter {
  constructor() {
    super();
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  constructor() {
    this.tracks = [new FakeTrack()];
  }

  getTracks() {
    return [...this.tracks];
  }

  getAudioTracks() {
    return [...this.tracks];
  }
}

class FakeMediaRecorder extends Emitter {
  static instances = [];

  static isTypeSupported(type) {
    return /^audio\/(webm|mp4|ogg)/i.test(type);
  }

  constructor(stream, options = {}) {
    super();
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.chunks = [];
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    if (this.state !== 'inactive') throw new Error('MediaRecorder já iniciado');
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') throw new Error('MediaRecorder já parado');
    this.state = 'inactive';
    const type = this.options.mimeType || 'audio/webm';
    this.emit('dataavailable', { data: new Blob(this.chunks, { type }) });
    this.emit('stop', {});
  }

  fail(error) {
    this.emit('error', { error });
    if (this.state !== 'inactive') this.stop();
  }

  endMicrophone() {
    this.stream.tracks[0].emit('ended', {});
  }
}

class FakeAudio {
  constructor(url) {
    this.url = url;
    this.currentTime = 0;
    this.duration = 3;
    this.paused = true;
    this.playCount = 0;
    this.pauseCount = 0;
    this.onended = null;
    this.onpause = null;
  }

  async play() {
    this.playCount += 1;
    this.paused = false;
  }

  pause() {
    this.pauseCount += 1;
    this.paused = true;
    this.onpause?.();
  }

  finish() {
    this.onended?.();
  }
}

/**
 * Cria dependências isoladas. `advance(ms)` move o relógio e dispara os ticks
 * do cronômetro de gravação sem usar timers reais.
 */
export function createNarrationDeps({
  getUserMediaError = null,
  supported = true,
  now = 1_700_000_000_000
} = {}) {
  const streams = [];
  const audios = [];
  const urls = new Map();
  const intervals = new Map();
  let clock = now;
  let nextId = 1;

  const mediaDevices = {
    async getUserMedia() {
      if (getUserMediaError) throw getUserMediaError;
      const stream = new FakeStream();
      streams.push(stream);
      return stream;
    }
  };

  const deps = {
    MediaRecorder: supported ? FakeMediaRecorder : undefined,
    mediaDevices: supported ? mediaDevices : undefined,
    now: () => clock,
    setInterval(callback) {
      const id = nextId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    createObjectURL(blob) {
      const url = `blob:fake/${nextId++}`;
      urls.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      urls.delete(url);
    },
    createAudio(url) {
      const audio = new FakeAudio(url);
      audios.push(audio);
      return audio;
    }
  };

  return {
    deps,
    Recorder: FakeMediaRecorder,
    streams,
    audios,
    urls,
    advance(ms) {
      clock += ms;
      intervals.forEach((callback) => callback());
    }
  };
}
