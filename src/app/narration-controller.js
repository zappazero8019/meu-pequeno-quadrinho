/**
 * Narração por página com a voz original da criança (MediaRecorder).
 *
 * Esta camada não desenha e não conhece a tela: ela solicita o microfone só
 * quando a criança toca em "Gravar", guarda o áudio como Blob no IndexedDB e
 * notifica a interface sobre gravação, reprodução e erros. Nenhum áudio sai do
 * dispositivo; não há síntese de voz nem serviço externo.
 *
 * As dependências são injetáveis para que os testes possam simular o
 * MediaRecorder, permissão negada, falha de armazenamento e quota excedida sem
 * usar microfone nem banco real.
 */

import {
  deleteNarrationForStory,
  getNarration,
  saveNarrationForStory
} from './database.js';
import { flushPendingSaves } from './story-storage.js';

export const NARRATION_STATE = Object.freeze({
  IDLE: 'idle',
  REQUESTING: 'requesting',
  RECORDING: 'recording',
  PROCESSING: 'processing',
  SAVING: 'saving',
  PLAYING: 'playing',
  ERROR: 'error'
});

export const NARRATION_REASON = Object.freeze({
  UNSUPPORTED: 'unsupported',
  PERMISSION_DENIED: 'permission-denied',
  NO_MICROPHONE: 'no-microphone',
  RECORDING_ERROR: 'recording-error',
  INTERRUPTED: 'interrupted',
  STORAGE_ERROR: 'storage-error',
  QUOTA: 'quota',
  INVALID_PAGE: 'invalid-page',
  NOT_FOUND: 'not-found',
  PLAYBACK_ERROR: 'playback-error',
  BUSY: 'busy',
  CANCELLED: 'cancelled'
});

const MESSAGES = {
  [NARRATION_REASON.UNSUPPORTED]: 'Este navegador não suporta gravação de voz.',
  [NARRATION_REASON.PERMISSION_DENIED]: 'Permissão do microfone negada. Peça ajuda para liberar o uso.',
  [NARRATION_REASON.NO_MICROPHONE]: 'Nenhum microfone foi encontrado neste dispositivo.',
  [NARRATION_REASON.RECORDING_ERROR]: 'A gravação falhou. Tente novamente.',
  [NARRATION_REASON.INTERRUPTED]: 'A gravação foi interrompida. Tente novamente.',
  [NARRATION_REASON.STORAGE_ERROR]: 'A gravação não foi salva neste dispositivo.',
  [NARRATION_REASON.QUOTA]: 'Não há espaço suficiente. A gravação não foi salva.',
  [NARRATION_REASON.INVALID_PAGE]: 'Não foi possível associar a narração a esta página.',
  [NARRATION_REASON.NOT_FOUND]: 'Esta página ainda não tem narração.',
  [NARRATION_REASON.PLAYBACK_ERROR]: 'Não foi possível reproduzir a narração.',
  [NARRATION_REASON.BUSY]: 'Termine a gravação atual antes de continuar.',
  [NARRATION_REASON.CANCELLED]: 'Gravação cancelada.'
};

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

export class NarrationError extends Error {
  constructor(reason, message, cause) {
    super(message || MESSAGES[reason] || 'Falha na narração.', cause === undefined ? undefined : { cause });
    this.name = 'NarrationError';
    this.reason = reason;
  }
}

const listeners = new Set();

let status = {
  state: NARRATION_STATE.IDLE,
  reason: null,
  message: 'Narração pronta.',
  storyId: null,
  pageId: null,
  hasRecording: false,
  durationMs: 0,
  elapsedMs: 0
};

let recorder = null;
let stream = null;
let chunks = [];
let cleanups = [];
let timer = null;
let startedAt = 0;
let recordingKey = null;
let recordingMimeType = '';
let previousRecording = { hasRecording: false, durationMs: 0 };
let discardRecording = false;
let discardReason = null;
let unsaved = null;
let stopPromise = null;
let stopResolvers = [];
let audio = null;
let audioKey = null;
let audioUrl = null;

function cleanId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function keyParts(key) {
  const storyId = cleanId(key?.storyId);
  const pageId = cleanId(key?.pageId);
  if (!storyId || !pageId) return null;
  return { storyId, pageId };
}

function sameKey(left, right) {
  return Boolean(
    left && right && left.storyId === right.storyId && left.pageId === right.pageId
  );
}

function nowValue(deps) {
  return typeof deps.now === 'function' ? deps.now() : Date.now();
}

function statusObject() {
  return { ...status, supported: isNarrationSupported() };
}

function setStatus(patch) {
  const next = { ...status, ...patch };
  const changed = Object.keys(next).some((key) => next[key] !== status[key]);
  status = next;
  if (changed) listeners.forEach((listener) => listener(statusObject()));
}

function setError(reason, deps = {}, extra = {}) {
  setStatus({
    state: NARRATION_STATE.ERROR,
    reason,
    message: MESSAGES[reason] || MESSAGES[NARRATION_REASON.RECORDING_ERROR],
    elapsedMs: 0,
    ...extra
  });
  return { ok: false, reason, error: extra.error || null };
}

export function subscribeNarrationStatus(listener) {
  listeners.add(listener);
  listener(statusObject());
  return () => listeners.delete(listener);
}

export function getNarrationStatus() {
  return statusObject();
}

export function isNarrationSupported(deps = {}) {
  const Recorder = deps.MediaRecorder || globalThis.MediaRecorder;
  const media = deps.mediaDevices || globalThis.navigator?.mediaDevices;
  return typeof Recorder === 'function' && typeof media?.getUserMedia === 'function';
}

export function isNarrationRecording() {
  return Boolean(recorder || status.state === NARRATION_STATE.REQUESTING);
}

export function isNarrationBusy() {
  return isNarrationRecording()
    || status.state === NARRATION_STATE.PROCESSING
    || status.state === NARRATION_STATE.SAVING;
}

export function formatDuration(value) {
  const seconds = Math.max(0, Math.round((Number(value) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function reasonFromError(error, fallback = NARRATION_REASON.STORAGE_ERROR) {
  if (error instanceof NarrationError) return error.reason;
  if (error?.reason && MESSAGES[error.reason]) return error.reason;

  const name = error?.name || '';
  const code = error?.code;

  if (
    code === 'QUOTA_EXCEEDED' ||
    code === 'QUOTA_EXCEEDED_ERROR' ||
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22
  ) {
    return NARRATION_REASON.QUOTA;
  }
  if (code === 'INVALID_DATA') return NARRATION_REASON.INVALID_PAGE;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return NARRATION_REASON.PERMISSION_DENIED;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return NARRATION_REASON.NO_MICROPHONE;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return NARRATION_REASON.RECORDING_ERROR;
  }
  return fallback;
}

function on(target, type, handler) {
  if (!target) return () => {};
  if (typeof target.addEventListener === 'function') {
    target.addEventListener(type, handler);
    return () => target.removeEventListener?.(type, handler);
  }
  const property = `on${type}`;
  target[property] = handler;
  return () => { target[property] = null; };
}

function clearCleanups() {
  cleanups.splice(0).forEach((remove) => {
    try {
      remove();
    } catch {
      /* o alvo já foi liberado */
    }
  });
}

function clearTimer(deps) {
  if (timer === null) return;
  const clear = deps.clearInterval || globalThis.clearInterval;
  clear?.(timer);
  timer = null;
}

function stopTracks() {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop?.();
    } catch {
      /* a trilha já foi encerrada */
    }
  });
  stream = null;
}

function pickMimeType(Recorder) {
  if (typeof Recorder.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find((candidate) => Recorder.isTypeSupported(candidate)) || '';
}

function resolveStop(result) {
  stopPromise = null;
  stopResolvers.splice(0).forEach((resolve) => resolve(result));
  return result;
}

async function persist(record, deps) {
  if (typeof deps.saveNarration === 'function') return deps.saveNarration(record);

  // O desenho pode ter uma gravação em andamento; esperar evita que o toque
  // de `updatedAt` da narração corra ao lado de um snapshot mais antigo.
  await flushPendingSaves();
  return saveNarrationForStory(record);
}

async function finishRecording(deps) {
  if (!recorder) return;

  const active = recorder;
  recorder = null;
  clearTimer(deps);
  clearCleanups();
  stopTracks();

  if (discardRecording) {
    const reason = discardReason || NARRATION_REASON.CANCELLED;
    discardRecording = false;
    discardReason = null;
    chunks = [];
    recordingKey = null;
    setStatus({
      state: reason === NARRATION_REASON.CANCELLED ? NARRATION_STATE.IDLE : NARRATION_STATE.ERROR,
      reason,
      message: MESSAGES[reason],
      elapsedMs: 0
    });
    resolveStop({ ok: false, reason });
    return;
  }

  const key = recordingKey || { storyId: status.storyId, pageId: status.pageId };
  const durationMs = Math.max(1, Math.round(nowValue(deps) - startedAt));
  const mimeType = recordingMimeType || chunks[0]?.type || 'audio/webm';
  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];
  recordingKey = null;

  if (!blob.size) {
    setError(NARRATION_REASON.RECORDING_ERROR, deps, { ...key });
    resolveStop({ ok: false, reason: NARRATION_REASON.RECORDING_ERROR });
    return;
  }

  unsaved = { ...key, blob, mimeType, durationMs };
  setStatus({
    state: NARRATION_STATE.SAVING,
    reason: null,
    message: 'Salvando narração...',
    ...key
  });

  try {
    const saved = await persist(unsaved, deps);
    unsaved = null;
    setStatus({
      state: NARRATION_STATE.IDLE,
      reason: null,
      message: `Narração salva · ${formatDuration(durationMs)}`,
      hasRecording: true,
      durationMs,
      elapsedMs: 0,
      ...key
    });
    resolveStop({
      ok: true,
      reason: null,
      key,
      narration: saved?.narration || saved || null
    });
  } catch (error) {
    const reason = reasonFromError(error);
    setError(reason, deps, {
      ...key,
      hasRecording: previousRecording.hasRecording,
      durationMs: previousRecording.durationMs
    });
    resolveStop({ ok: false, reason, error, key });
  }

  void active;
}

export async function startRecording(key, deps = {}) {
  const parts = keyParts(key);
  if (!parts) return setError(NARRATION_REASON.INVALID_PAGE, deps);

  if (isNarrationBusy()) return setError(NARRATION_REASON.BUSY, deps, parts);

  stopPlayback(deps);

  if (!isNarrationSupported(deps)) return setError(NARRATION_REASON.UNSUPPORTED, deps, parts);

  const Recorder = deps.MediaRecorder || globalThis.MediaRecorder;
  const media = deps.mediaDevices || globalThis.navigator?.mediaDevices;

  previousRecording = {
    hasRecording: status.hasRecording && sameKey(status, parts),
    durationMs: status.hasRecording && sameKey(status, parts) ? status.durationMs : 0
  };

  setStatus({
    state: NARRATION_STATE.REQUESTING,
    reason: null,
    message: 'Pedindo permissão para usar o microfone...',
    ...parts,
    hasRecording: previousRecording.hasRecording,
    durationMs: previousRecording.durationMs,
    elapsedMs: 0
  });

  let acquired;
  try {
    acquired = await media.getUserMedia({ audio: true });
  } catch (error) {
    return setError(reasonFromError(error, NARRATION_REASON.PERMISSION_DENIED), deps, {
      ...parts,
      error
    });
  }

  // O usuário pode ter saído da tela enquanto a permissão era pedida.
  if (status.state !== NARRATION_STATE.REQUESTING) {
    acquired?.getTracks?.().forEach((track) => track.stop?.());
    return { ok: false, reason: NARRATION_REASON.CANCELLED };
  }

  stream = acquired;
  recordingKey = parts;
  chunks = [];
  unsaved = null;
  discardRecording = false;
  discardReason = null;
  recordingMimeType = pickMimeType(Recorder);

  try {
    const options = recordingMimeType ? { mimeType: recordingMimeType } : undefined;
    recorder = options ? new Recorder(stream, options) : new Recorder(stream);
  } catch (error) {
    stopTracks();
    return setError(NARRATION_REASON.RECORDING_ERROR, deps, { ...parts, error });
  }

  cleanups.push(on(recorder, 'dataavailable', (event) => {
    if (event?.data && (event.data.size === undefined || event.data.size > 0)) chunks.push(event.data);
  }));
  cleanups.push(on(recorder, 'stop', () => void finishRecording(deps)));
  cleanups.push(on(recorder, 'error', (event) => {
    discardReason = NARRATION_REASON.RECORDING_ERROR;
    discardRecording = true;
    setError(discardReason, deps, { ...parts, error: event?.error });
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* já estava parando */
      }
    }
  }));

  stream.getAudioTracks?.().forEach((track) => {
    cleanups.push(on(track, 'ended', () => {
      if (!recorder || recorder.state !== 'recording') return;
      discardReason = NARRATION_REASON.INTERRUPTED;
      discardRecording = true;
      setError(discardReason, deps, parts);
      try {
        recorder.stop();
      } catch {
        /* já estava parando */
      }
    }));
  });

  startedAt = nowValue(deps);
  const tick = () => {
    if (status.state !== NARRATION_STATE.RECORDING) return;
    setStatus({ elapsedMs: Math.max(0, nowValue(deps) - startedAt) });
  };
  const interval = deps.setInterval || globalThis.setInterval;
  timer = interval ? interval(tick, 200) : null;

  try {
    recorder.start();
  } catch (error) {
    clearTimer(deps);
    stopTracks();
    recorder = null;
    return setError(NARRATION_REASON.RECORDING_ERROR, deps, { ...parts, error });
  }

  setStatus({
    state: NARRATION_STATE.RECORDING,
    reason: null,
    message: `Gravando... ${formatDuration(0)}`,
    ...parts,
    elapsedMs: 0
  });

  return { ok: true, reason: null, ...parts };
}

export function stopRecording(deps = {}) {
  if (stopPromise) return stopPromise;
  if (!recorder || recorder.state !== 'recording') {
    return Promise.resolve({ ok: false, reason: NARRATION_REASON.BUSY });
  }

  clearTimer(deps);
  setStatus({
    state: NARRATION_STATE.PROCESSING,
    message: 'Finalizando narração...'
  });

  stopPromise = new Promise((resolve) => stopResolvers.push(resolve));

  try {
    recorder.stop();
  } catch (error) {
    setError(NARRATION_REASON.RECORDING_ERROR, deps, { error });
    resolveStop({ ok: false, reason: NARRATION_REASON.RECORDING_ERROR, error });
  }

  return stopPromise;
}

export function cancelRecording(deps = {}) {
  if (!recorder) {
    discardReason = null;
    setStatus({
      state: NARRATION_STATE.IDLE,
      reason: NARRATION_REASON.CANCELLED,
      message: MESSAGES[NARRATION_REASON.CANCELLED],
      elapsedMs: 0
    });
    return { ok: false, reason: NARRATION_REASON.CANCELLED };
  }

  discardRecording = true;
  discardReason = null;
  clearTimer(deps);
  if (recorder.state === 'recording') {
    try {
      recorder.stop();
    } catch {
      stopTracks();
      recorder = null;
      clearCleanups();
      resolveStop({ ok: false, reason: NARRATION_REASON.CANCELLED });
    }
  } else {
    stopTracks();
    recorder = null;
    clearCleanups();
    resolveStop({ ok: false, reason: NARRATION_REASON.CANCELLED });
  }

  return { ok: false, reason: NARRATION_REASON.CANCELLED };
}

export async function retrySaveNarration(deps = {}) {
  if (!unsaved) return { ok: false, reason: NARRATION_REASON.NOT_FOUND };
  if (isNarrationBusy()) return setError(NARRATION_REASON.BUSY, deps);

  const record = unsaved;
  setStatus({
    state: NARRATION_STATE.SAVING,
    reason: null,
    message: 'Salvando narração...',
    storyId: record.storyId,
    pageId: record.pageId
  });

  try {
    const saved = await persist(record, deps);
    unsaved = null;
    setStatus({
      state: NARRATION_STATE.IDLE,
      reason: null,
      message: `Narração salva · ${formatDuration(record.durationMs)}`,
      hasRecording: true,
      durationMs: record.durationMs,
      elapsedMs: 0,
      storyId: record.storyId,
      pageId: record.pageId
    });
    return { ok: true, reason: null, narration: saved?.narration || saved || null };
  } catch (error) {
    const reason = reasonFromError(error);
    setError(reason, deps, {
      storyId: record.storyId,
      pageId: record.pageId,
      hasRecording: previousRecording.hasRecording,
      durationMs: previousRecording.durationMs
    });
    return { ok: false, reason, error };
  }
}

/** Consulta a narração da página; erro de leitura nunca vira "sem narração". */
export async function loadPageNarration(key, deps = {}) {
  const parts = keyParts(key);
  if (!parts) return setError(NARRATION_REASON.INVALID_PAGE, deps);

  setStatus({
    state: NARRATION_STATE.IDLE,
    reason: null,
    message: 'Narração pronta.',
    ...parts,
    hasRecording: false,
    durationMs: 0,
    elapsedMs: 0
  });

  const loader = deps.getNarration || getNarration;
  try {
    const record = await loader(parts.storyId, parts.pageId);
    const matches = record && record.storyId === parts.storyId && record.pageId === parts.pageId;
    setStatus({
      hasRecording: Boolean(matches),
      durationMs: matches ? Number(record.durationMs) || 0 : 0,
      message: matches
        ? `Esta página já tem narração · ${formatDuration(record.durationMs)}`
        : 'Nenhuma narração nesta página.'
    });
    return matches ? record : null;
  } catch (error) {
    setError(NARRATION_REASON.STORAGE_ERROR, deps, { ...parts, error });
    return null;
  }
}

function audioFactory(deps) {
  if (typeof deps.createAudio === 'function') return deps.createAudio;
  return (url) => new Audio(url);
}

function objectUrlFactory(deps) {
  if (typeof deps.createObjectURL === 'function') return deps.createObjectURL;
  return globalThis.URL?.createObjectURL?.bind(globalThis.URL) || null;
}

function revokeObjectUrl(deps) {
  if (!audioUrl) return;
  const revoke = typeof deps.revokeObjectURL === 'function'
    ? deps.revokeObjectURL
    : globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
  try {
    revoke?.(audioUrl);
  } catch {
    /* URL já liberada */
  }
  audioUrl = null;
}

export function stopPlayback(deps = {}) {
  if (audio) {
    audio.onended = null;
    audio.onpause = null;
    try {
      audio.pause?.();
    } catch {
      /* o áudio já estava parado */
    }
    if (typeof audio.currentTime === 'number') audio.currentTime = 0;
  }
  audio = null;
  audioKey = null;
  revokeObjectUrl(deps);

  if (status.state === NARRATION_STATE.PLAYING) {
    setStatus({ state: NARRATION_STATE.IDLE, message: 'Narração pronta.' });
  }
}

async function ensureAudio(key, deps) {
  if (audio && sameKey(audioKey, key)) return audio;

  stopPlayback(deps);
  const record = await loadPageNarration(key, deps);
  if (!record) {
    setError(NARRATION_REASON.NOT_FOUND, deps, key);
    return null;
  }

  const createUrl = objectUrlFactory(deps);
  if (!createUrl) {
    setError(NARRATION_REASON.UNSUPPORTED, deps, key);
    return null;
  }

  try {
    audioUrl = createUrl(record.blob);
    audio = audioFactory(deps)(audioUrl);
    audioKey = { ...key };
    audio.onended = () => {
      setStatus({
        state: NARRATION_STATE.IDLE,
        message: `Fim da narração · ${formatDuration(record.durationMs)}`
      });
    };
    audio.onpause = () => {
      if (status.state === NARRATION_STATE.PLAYING) {
        setStatus({ state: NARRATION_STATE.IDLE, message: 'Narração pausada.' });
      }
    };
    return audio;
  } catch (error) {
    revokeObjectUrl(deps);
    audio = null;
    setError(NARRATION_REASON.PLAYBACK_ERROR, deps, { ...key, error });
    return null;
  }
}

export async function playNarration(key, deps = {}) {
  const parts = keyParts(key);
  if (!parts) return setError(NARRATION_REASON.INVALID_PAGE, deps);
  if (isNarrationBusy()) return setError(NARRATION_REASON.BUSY, deps, parts);

  const element = await ensureAudio(parts, deps);
  if (!element) return { ok: false, reason: status.reason };

  try {
    const end = Number(element.duration);
    if (Number.isFinite(end) && end > 0 && Number(element.currentTime) >= end - 0.05) {
      element.currentTime = 0;
    }
    await element.play();
    setStatus({
      state: NARRATION_STATE.PLAYING,
      reason: null,
      message: 'Reproduzindo narração...',
      ...parts
    });
    return { ok: true, reason: null, ...parts };
  } catch (error) {
    setError(NARRATION_REASON.PLAYBACK_ERROR, deps, { ...parts, error });
    return { ok: false, reason: NARRATION_REASON.PLAYBACK_ERROR, error };
  }
}

export function pauseNarration(deps = {}) {
  if (!audio) return { ok: false, reason: NARRATION_REASON.NOT_FOUND };
  try {
    audio.pause?.();
  } catch {
    /* já estava pausado */
  }
  setStatus({ state: NARRATION_STATE.IDLE, message: 'Narração pausada.' });
  return { ok: true, reason: null };
}

export async function replayNarration(key, deps = {}) {
  stopPlayback(deps);
  return playNarration(key, deps);
}

export async function deletePageNarration(key, deps = {}) {
  const parts = keyParts(key);
  if (!parts) return setError(NARRATION_REASON.INVALID_PAGE, deps);
  if (isNarrationBusy()) return setError(NARRATION_REASON.BUSY, deps, parts);

  stopPlayback(deps);
  const remove = deps.deleteNarration || deleteNarrationForStory;

  try {
    const deleted = Boolean(await remove(parts.storyId, parts.pageId));
    setStatus({
      state: NARRATION_STATE.IDLE,
      reason: null,
      message: deleted ? 'Narração excluída.' : 'Esta página já não tinha narração.',
      ...parts,
      hasRecording: false,
      durationMs: 0,
      elapsedMs: 0
    });
    return { ok: true, reason: null, deleted, ...parts };
  } catch (error) {
    const reason = reasonFromError(error);
    setError(reason, deps, { ...parts, error });
    return { ok: false, reason, error };
  }
}

/** Uso exclusivo dos testes, para isolar o estado entre casos. */
export function resetNarrationForTests() {
  clearTimer({});
  clearCleanups();
  stopTracks();
  stopPlayback({});
  recorder = null;
  chunks = [];
  recordingKey = null;
  recordingMimeType = '';
  previousRecording = { hasRecording: false, durationMs: 0 };
  discardRecording = false;
  discardReason = null;
  unsaved = null;
  stopPromise = null;
  stopResolvers.splice(0).forEach((resolve) => resolve({ ok: false, reason: NARRATION_REASON.CANCELLED }));
  status = {
    state: NARRATION_STATE.IDLE,
    reason: null,
    message: 'Narração pronta.',
    storyId: null,
    pageId: null,
    hasRecording: false,
    durationMs: 0,
    elapsedMs: 0
  };
  listeners.clear();
}
