/**
 * Banco local de histórias com IndexedDB (Fase 3.1).
 *
 * Responsabilidade: guardar uma única cópia atual de cada história, com suas
 * páginas e desenhos serializáveis. Não há integração com a interface, salvamento
 * automático, restauração no canvas nem sincronização: esta camada apenas expõe
 * operações assíncronas reutilizáveis.
 *
 * O armazenamento é limitado pelo navegador e pelo dispositivo. Nenhuma
 * quantidade máxima de histórias ou páginas é imposta por este módulo.
 */

import {
  createEmptyDrawingDocument,
  validateDrawingDocument
} from './drawing-data.js';

export const DB_NAME = 'meu-pequeno-quadrinho';
// v2 adiciona somente a loja `narrations`; nenhum registro existente é apagado.
export const DB_VERSION = 2;
export const STORE_NAME = 'stories';
export const NARRATION_STORE_NAME = 'narrations';

/** Erro único para que as telas possam distinguir falhas do banco. */
export class DatabaseError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DatabaseError';
    this.code = code;
  }
}

let connectionPromise = null;
let activeConnection = null;

function nowIso() {
  return new Date().toISOString();
}

function invalid(message) {
  throw new TypeError(message);
}

function invalidData(message, cause) {
  return new DatabaseError('INVALID_DATA', `Dados inválidos: ${message}`, cause);
}

function wrapError(error, fallbackCode, message) {
  if (error instanceof DatabaseError) return error;

  const name = error?.name || '';
  const detail = error?.message || '';

  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error?.code === 22 ||
    /quota|espaço insuficiente/i.test(detail)
  ) {
    return new DatabaseError(
      'QUOTA_EXCEEDED',
      'Não há espaço suficiente no dispositivo para salvar esta história.',
      error
    );
  }

  if (name === 'AbortError' || name === 'InvalidStateError') {
    return new DatabaseError(
      'TRANSACTION_FAILED',
      'A transação com o banco não pôde ser concluída.',
      error
    );
  }

  if (name === 'ConstraintError') {
    return new DatabaseError(
      'CONFLICT',
      'Já existe uma história com este identificador.',
      error
    );
  }

  if (name === 'DataCloneError' || name === 'DataError') {
    return new DatabaseError(
      'INVALID_DATA',
      'Estes dados não podem ser armazenados pelo navegador.',
      error
    );
  }

  return new DatabaseError(fallbackCode, message, error);
}

function makeId() {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `story-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function requireString(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') invalid(`${field} deve ser um texto`);
  const text = value.trim();
  if (!allowEmpty && !text) invalid(`${field} não pode ficar vazio`);
  return text;
}

function normalizeTimestamp(value, field, fallback = nowIso()) {
  if (value === undefined || value === null || value === '') return fallback;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) invalid(`${field} é uma data inválida`);
    return value.toISOString();
  }

  if (typeof value !== 'string') invalid(`${field} deve ser uma data em texto`);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(`${field} não é uma data válida`);
  return date.toISOString();
}

/** Aceita somente valores que o IndexedDB consegue clonar sem perdas. */
function toSerializable(value, path, seen = new Set()) {
  if (value === null) return null;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;

  if (type === 'number') {
    if (!Number.isFinite(value)) invalid(`${path} deve ser um número finito`);
    return value;
  }

  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    invalid(`${path} não é serializável`);
  }

  if (value instanceof Date) return normalizeTimestamp(value, path);

  if (seen.has(value)) invalid(`${path} contém uma referência circular`);

  if (Array.isArray(value)) {
    seen.add(value);
    const copy = value.map((item, index) => toSerializable(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return copy;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    seen.add(value);
    const copy = {};
    Object.keys(value).forEach((key) => {
      copy[key] = toSerializable(value[key], `${path}.${key}`, seen);
    });
    seen.delete(value);
    return copy;
  }

  invalid(`${path} deve ser um objeto simples, sem canvas ou funções`);
}

function normalizePages(pages) {
  if (pages === undefined || pages === null) return [];
  if (!Array.isArray(pages)) invalid('pages deve ser uma lista');

  const seenIds = new Set();

  return pages.map((page, index) => {
    const field = `pages[${index}]`;
    if (!page || typeof page !== 'object') invalid(`${field} deve ser um objeto`);

    const id = requireString(page.id, `${field}.id`);
    if (seenIds.has(id)) invalid(`${field}.id está duplicado nesta história`);
    seenIds.add(id);

    const order = page.order === undefined ? index : page.order;
    if (!Number.isInteger(order) || order < 0) invalid(`${field}.order deve ser um inteiro não negativo`);

    const updatedAt = normalizeTimestamp(page.updatedAt, `${field}.updatedAt`);

    let drawing;
    try {
      drawing = page.drawing === undefined || page.drawing === null
        ? createEmptyDrawingDocument()
        : validateDrawingDocument(page.drawing);
    } catch (error) {
      invalid(`${field}.drawing: ${error.message}`);
    }

    return { id, order, drawing, updatedAt };
  });
}

function normalizeStory(input, { existing = null, creating = false } = {}) {
  if (!input || typeof input !== 'object') invalid('a história deve ser um objeto');

  let id;
  if (creating) {
    id = input.id === undefined || input.id === null || input.id === ''
      ? makeId()
      : requireString(input.id, 'id');
  } else {
    id = requireString(existing?.id, 'id');
  }

  const createdAt = existing
    ? normalizeTimestamp(existing.createdAt, 'createdAt')
    : normalizeTimestamp(input.createdAt, 'createdAt');
  const updatedAt = creating
    ? normalizeTimestamp(input.updatedAt, 'updatedAt', createdAt)
    : nowIso();

  const title = requireString(input.title, 'title');
  const author = input.author === undefined || input.author === null
    ? ''
    : requireString(input.author, 'author', { allowEmpty: true });
  const cover = input.cover === undefined || input.cover === null
    ? null
    : toSerializable(input.cover, 'cover');
  const pages = normalizePages(input.pages);

  // pageCount é derivado de pages: nunca fica dessincronizado nem duplicado.
  return { id, title, author, createdAt, updatedAt, cover, pages, pageCount: pages.length };
}

function cleanPatch(patch) {
  if (patch === undefined || patch === null) return {};
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    invalid('os dados de atualização devem ser um objeto');
  }

  const clean = {};
  Object.keys(patch).forEach((key) => {
    // `undefined` não deve apagar um campo já gravado; `null` continua válido
    // para limpar, por exemplo, a capa.
    if (patch[key] !== undefined) clean[key] = patch[key];
  });
  return clean;
}

function validateId(id) {
  try {
    return requireString(id, 'id');
  } catch (error) {
    throw invalidData(error.message, error);
  }
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error('Requisição IndexedDB falhou')
    );
  });
}

function indexedDbGlobal() {
  const idb = globalThis.indexedDB;
  if (!idb || typeof idb.open !== 'function') {
    throw new DatabaseError(
      'UNAVAILABLE',
      'IndexedDB não está disponível neste navegador ou contexto.'
    );
  }
  return idb;
}

/**
 * Abre (ou reutiliza) a conexão. A criação do store acontece somente na
 * atualização de versão inicial; erros nunca apagam nem recriam o banco.
 */
export async function initDatabase() {
  if (connectionPromise) return connectionPromise;

  connectionPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDbGlobal().open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(wrapError(error, 'OPEN_FAILED', 'Não foi possível abrir o banco.'));
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }

      // Migração v1 → v2: cria a loja de áudio sem tocar nas histórias.
      if (event.newVersion >= 2 && !db.objectStoreNames.contains(NARRATION_STORE_NAME)) {
        const store = db.createObjectStore(NARRATION_STORE_NAME, { keyPath: 'id' });
        if (typeof store.createIndex === 'function') {
          store.createIndex('storyId', 'storyId', { unique: false });
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      activeConnection = db;
      db.onversionchange = () => {
        db.close();
        if (activeConnection === db) activeConnection = null;
        connectionPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      reject(wrapError(
        request.error || new Error('Falha ao abrir o banco'),
        'OPEN_FAILED',
        'Não foi possível abrir o banco.'
      ));
    };

    request.onblocked = () => {
      reject(new DatabaseError(
        'OPEN_FAILED',
        'A abertura do banco foi bloqueada por outra aba aberta.'
      ));
    };
  }).catch((error) => {
    connectionPromise = null;
    throw error;
  });

  return connectionPromise;
}

/** Verifica disponibilidade sem alterar dados nem forçar recriação. */
export async function isDatabaseAvailable() {
  try {
    await initDatabase();
    return true;
  } catch {
    return false;
  }
}

/** Encerra a conexão cacheada. Útil em testes e em descarregamento controlado. */
export async function closeDatabase() {
  const pending = connectionPromise;
  connectionPromise = null;

  const db = activeConnection || (pending ? await pending.catch(() => null) : null);
  activeConnection = null;

  if (db && typeof db.close === 'function') db.close();
}

async function withStore(mode, work, storeName = STORE_NAME) {
  const db = await initDatabase();
  const fallbackCode = mode === 'readonly' ? 'READ_FAILED' : 'WRITE_FAILED';
  const fallbackMessage = mode === 'readonly'
    ? 'Falha ao ler o banco de dados.'
    : 'Falha ao gravar no banco de dados.';

  let transaction;
  try {
    transaction = db.transaction(storeName, mode);
  } catch (error) {
    throw wrapError(error, fallbackCode, fallbackMessage);
  }

  const completion = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error('Transação falhou')
    );
    transaction.onabort = () => reject(
      transaction.error || Object.assign(new Error('Transação abortada'), { name: 'AbortError' })
    );
  });
  // Se `work` falhar antes da transação terminar, o abort também rejeitará a
  // promessa; este handler evita apenas um aviso de rejeição não tratada.
  completion.catch(() => {});

  try {
    const result = await work(transaction.objectStore(storeName), transaction);
    await completion;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* a transação já estava encerrada */
    }
    throw wrapError(error, fallbackCode, fallbackMessage);
  }
}

function cloneStory(story) {
  return toSerializable(story, 'story');
}

/** Cria uma história nova com identificador estável e único. */
export async function createStory(input) {
  let story;
  try {
    story = normalizeStory(input, { creating: true });
  } catch (error) {
    throw invalidData(error.message, error);
  }

  return withStore('readwrite', async (store) => {
    await requestPromise(store.add(story));
    return cloneStory(story);
  });
}

/** Busca uma história pelo ID. Retorna `null` quando não existe. */
export async function getStory(id) {
  const key = validateId(id);

  return withStore('readonly', async (store) => {
    const found = await requestPromise(store.get(key));
    return found ? cloneStory(found) : null;
  });
}

/** Lista todas as histórias, sem limite artificial, da mais recente primeiro. */
export async function listStories() {
  const stories = await withStore('readonly', async (store) => {
    const all = await requestPromise(store.getAll());
    return Array.isArray(all) ? all.map(cloneStory) : [];
  });

  return stories.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Substitui os dados da história indicada pelo ID. O identificador e a data de
 * criação são preservados; `updatedAt` passa a ser o momento da atualização.
 * Retorna `null` se o ID não existe, sem criar uma nova história.
 */
export async function updateStory(id, patch) {
  const key = validateId(id);

  return withStore('readwrite', async (store) => {
    const existing = await requestPromise(store.get(key));
    if (!existing) return null;

    let story;
    try {
      story = normalizeStory(
        { ...existing, ...cleanPatch(patch), id: key },
        { existing }
      );
    } catch (error) {
      throw invalidData(error.message, error);
    }

    await requestPromise(store.put(story));
    return cloneStory(story);
  });
}

/** Exclui somente a história solicitada e suas narrações, sem afetar outras. */
export async function deleteStory(id) {
  const key = validateId(id);
  const db = await initDatabase();

  let transaction;
  try {
    // Uma única transação cobre os dois stores: não sobra narração órfã se a
    // exclusão da história for confirmada.
    transaction = db.transaction([STORE_NAME, NARRATION_STORE_NAME], 'readwrite');
  } catch (error) {
    throw wrapError(error, 'WRITE_FAILED', 'Falha ao gravar no banco de dados.');
  }

  const completion = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Transação falhou'));
    transaction.onabort = () => reject(
      transaction.error || Object.assign(new Error('Transação abortada'), { name: 'AbortError' })
    );
  });
  completion.catch(() => {});

  try {
    const stories = transaction.objectStore(STORE_NAME);
    const existing = await requestPromise(stories.get(key));
    if (!existing) {
      await completion;
      return false;
    }

    await requestPromise(stories.delete(key));

    const narrations = transaction.objectStore(NARRATION_STORE_NAME);
    const records = await requestPromise(narrations.getAll());
    const doomed = (Array.isArray(records) ? records : [])
      .filter((record) => record?.storyId === key);

    for (const record of doomed) {
      await requestPromise(narrations.delete(record.id));
    }

    await completion;
    return true;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* a transação já estava encerrada */
    }
    throw wrapError(error, 'WRITE_FAILED', 'Falha ao gravar no banco de dados.');
  }
}

/* ------------------------------------------------------------ narrações */

function narrationKey(storyId, pageId) {
  // Chave determinística: gravar a mesma página substitui o áudio anterior,
  // sem gerar duas cópias da mesma narração.
  return JSON.stringify([storyId, pageId]);
}

function validateNarrationKey(storyId, pageId) {
  return narrationKey(
    validateId(storyId),
    validateId(pageId)
  );
}

function normalizeNarration(input) {
  if (!input || typeof input !== 'object') invalid('a narração deve ser um objeto');

  const storyId = validateId(input.storyId);
  const pageId = validateId(input.pageId);
  const blob = input.blob;
  const isBlob = typeof Blob !== 'undefined' && blob instanceof Blob;
  const isBlobLike = blob && typeof blob.size === 'number' && typeof blob.arrayBuffer === 'function';
  if (!isBlob && !isBlobLike) invalid('blob deve ser um Blob de áudio');

  const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim()
    ? input.mimeType.trim()
    : (typeof blob.type === 'string' && blob.type ? blob.type : 'audio/webm');

  const durationMs = input.durationMs === undefined || input.durationMs === null
    ? 0
    : Number(input.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0) invalid('durationMs deve ser um número não negativo');

  const now = nowIso();
  return {
    id: narrationKey(storyId, pageId),
    storyId,
    pageId,
    blob,
    mimeType,
    durationMs,
    createdAt: normalizeTimestamp(input.createdAt, 'createdAt', now),
    updatedAt: normalizeTimestamp(input.updatedAt, 'updatedAt', now)
  };
}

function publicNarration(record) {
  if (!record) return null;
  return {
    id: record.id,
    storyId: record.storyId,
    pageId: record.pageId,
    blob: record.blob,
    mimeType: record.mimeType || 'audio/webm',
    durationMs: Number(record.durationMs) || 0,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

/** Grava ou substitui a narração de uma página. Nunca converte o áudio em texto. */
export async function saveNarration(input) {
  let record;
  try {
    record = normalizeNarration(input);
  } catch (error) {
    throw invalidData(error.message, error);
  }

  return withStore('readwrite', async (store) => {
    await requestPromise(store.put(record));
    return publicNarration(record);
  }, NARRATION_STORE_NAME);
}

/**
 * Grava a narração e atualiza o `updatedAt` da história na mesma transação.
 * A história e o ID da página precisam existir: assim não há áudio órfão nem
 * uma nova história criada por engano. Os desenhos são preservados.
 */
export async function saveNarrationForStory(input) {
  let record;
  try {
    record = normalizeNarration(input);
  } catch (error) {
    throw invalidData(error.message, error);
  }

  const db = await initDatabase();
  let transaction;
  try {
    transaction = db.transaction([STORE_NAME, NARRATION_STORE_NAME], 'readwrite');
  } catch (error) {
    throw wrapError(error, 'WRITE_FAILED', 'Falha ao gravar no banco de dados.');
  }

  const completion = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Transação falhou'));
    transaction.onabort = () => reject(
      transaction.error || Object.assign(new Error('Transação abortada'), { name: 'AbortError' })
    );
  });
  completion.catch(() => {});

  try {
    const stories = transaction.objectStore(STORE_NAME);
    const existing = await requestPromise(stories.get(record.storyId));
    if (!existing) throw invalidData('história inexistente para esta narração');
    if (!existing.pages.some((page) => page.id === record.pageId)) {
      throw invalidData('página inexistente para esta narração');
    }

    await requestPromise(transaction.objectStore(NARRATION_STORE_NAME).put(record));

    let story;
    try {
      story = normalizeStory({ ...existing, id: record.storyId }, { existing });
    } catch (error) {
      throw invalidData(error.message, error);
    }
    await requestPromise(stories.put(story));

    await completion;
    return { narration: publicNarration(record), story: cloneStory(story) };
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* a transação já estava encerrada */
    }
    throw wrapError(error, 'WRITE_FAILED', 'Falha ao gravar no banco de dados.');
  }
}

/** Retorna a narração de uma página, ou `null` quando ainda não existe. */
export async function getNarration(storyId, pageId) {
  const key = validateNarrationKey(storyId, pageId);

  return withStore('readonly', async (store) => {
    const found = await requestPromise(store.get(key));
    return publicNarration(found);
  }, NARRATION_STORE_NAME);
}

/** Lista somente as narrações da história informada. */
export async function listNarrations(storyId) {
  const key = validateId(storyId);

  return withStore('readonly', async (store) => {
    const all = await requestPromise(store.getAll());
    return (Array.isArray(all) ? all : [])
      .filter((record) => record?.storyId === key)
      .map(publicNarration);
  }, NARRATION_STORE_NAME);
}

/** Exclui somente a narração da página indicada. */
export async function deleteNarration(storyId, pageId) {
  const key = validateNarrationKey(storyId, pageId);

  return withStore('readwrite', async (store) => {
    const existing = await requestPromise(store.get(key));
    if (!existing) return false;
    await requestPromise(store.delete(key));
    return true;
  }, NARRATION_STORE_NAME);
}

/** Exclui a narração da página e atualiza a história na mesma transação. */
export async function deleteNarrationForStory(storyId, pageId) {
  const key = validateNarrationKey(storyId, pageId);
  const db = await initDatabase();

  let transaction;
  try {
    transaction = db.transaction([STORE_NAME, NARRATION_STORE_NAME], 'readwrite');
  } catch (error) {
    throw wrapError(error, 'WRITE_FAILED', 'Falha ao gravar no banco de dados.');
  }

  const completion = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Transação falhou'));
    transaction.onabort = () => reject(
      transaction.error || Object.assign(new Error('Transação abortada'), { name: 'AbortError' })
    );
  });
  completion.catch(() => {});

  try {
    const narrations = transaction.objectStore(NARRATION_STORE_NAME);
    const existing = await requestPromise(narrations.get(key));
    if (!existing) {
      await completion;
      return false;
    }

    await requestPromise(narrations.delete(key));

    const stories = transaction.objectStore(STORE_NAME);
    const story = await requestPromise(stories.get(existing.storyId));
    if (story) {
      let updated;
      try {
        updated = normalizeStory({ ...story, id: existing.storyId }, { existing: story });
      } catch (error) {
        throw invalidData(error.message, error);
      }
      await requestPromise(stories.put(updated));
    }

    await completion;
    return true;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* a transação já estava encerrada */
    }
    throw wrapError(error, 'WRITE_FAILED', 'Falha ao gravar no banco de dados.');
  }
}

/** Atualiza `updatedAt` preservando título, autor, capa, páginas e desenhos. */
export async function touchStory(id) {
  const key = validateId(id);
  return updateStory(key, {});
}
