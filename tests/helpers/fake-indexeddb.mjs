/**
 * IndexedDB mínimo para testes, sem dependências externas.
 *
 * Não substitui um navegador: implementa apenas o subconjunto usado por
 * `src/app/database.js` (open, upgrade, transação e CRUD por keyPath). Os dados
 * ficam em um mapa por nome de banco, então fechar e reabrir a conexão preserva
 * o conteúdo, como acontece no navegador.
 */

const databases = new Map();
const failures = new Map();

function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function clone(value) {
  return structuredClone(value);
}

function makeRequest() {
  return {
    result: undefined,
    error: null,
    readyState: 'pending',
    transaction: null,
    onsuccess: null,
    onerror: null
  };
}

export function resetFakeIndexedDB() {
  databases.clear();
  failures.clear();
}

/** Injeta uma falha por operação: open, add, put, get, getAll ou delete. */
export function setFakeFailure(kind, error) {
  if (error) failures.set(kind, error);
  else failures.delete(kind);
}

class FakeStore {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.data = new Map();
  }

  keyFor(value) {
    if (!value || typeof value !== 'object') {
      throw namedError('DataError', 'Registro não é um objeto');
    }
    const key = value[this.keyPath];
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw namedError('DataError', `Chave ${this.keyPath} inválida`);
    }
    return key;
  }
}

class FakeObjectStore {
  constructor(store, transaction) {
    this.store = store;
    this.transaction = transaction;
  }

  createIndex() {
    // O módulo de banco não usa índices nesta fase; manter o método evita
    // falsas incompatibilidades caso o esquema evolua.
    return { name: '', keyPath: '' };
  }

  issue(kind, action) {
    const request = makeRequest();
    request.transaction = this.transaction;
    this.transaction.pending += 1;

    const failure = failures.get(kind);
    if (failure) {
      this.transaction.pending -= 1;
      queueMicrotask(() => {
        request.error = failure;
        request.readyState = 'done';
        request.onerror?.({ target: request });
        this.transaction.fail(failure);
      });
      return request;
    }

    queueMicrotask(() => {
      try {
        const value = action();
        this.transaction.pending -= 1;
        request.result = clone(value);
        request.readyState = 'done';
        queueMicrotask(() => {
          request.onsuccess?.({ target: request });
          this.transaction.settle();
        });
      } catch (error) {
        this.transaction.pending -= 1;
        request.error = error;
        request.readyState = 'done';
        queueMicrotask(() => {
          request.onerror?.({ target: request });
          this.transaction.fail(error);
        });
      }
    });

    return request;
  }

  add(value) {
    return this.issue('add', () => {
      const copy = clone(value);
      const key = this.store.keyFor(copy);
      if (this.store.data.has(key)) {
        throw namedError('ConstraintError', 'Chave duplicada');
      }
      this.store.data.set(key, copy);
      return key;
    });
  }

  put(value) {
    return this.issue('put', () => {
      const copy = clone(value);
      const key = this.store.keyFor(copy);
      this.store.data.set(key, copy);
      return key;
    });
  }

  get(key) {
    return this.issue('get', () => this.store.data.get(key));
  }

  getAll() {
    return this.issue('getAll', () => Array.from(this.store.data.values()));
  }

  delete(key) {
    return this.issue('delete', () => {
      this.store.data.delete(key);
      return undefined;
    });
  }
}

class FakeTransaction {
  constructor(stores, mode) {
    this.stores = stores;
    this.mode = mode;
    this.pending = 0;
    this.error = null;
    this.active = true;
    this.aborted = false;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
  }

  objectStore(name) {
    const store = this.stores.get(name);
    if (!store) {
      throw namedError('NotFoundError', `Object store ${name} não existe`);
    }
    return new FakeObjectStore(store, this);
  }

  settle() {
    queueMicrotask(() => {
      if (!this.active || this.aborted || this.pending > 0) return;
      this.active = false;
      this.oncomplete?.({ target: this });
    });
  }

  fail(error) {
    if (!this.active || this.aborted) return;
    this.error = error;
    this.active = false;
    queueMicrotask(() => this.onerror?.({ target: this }));
  }

  abort() {
    if (!this.active || this.aborted) return;
    this.aborted = true;
    this.active = false;
    this.error = this.error || namedError('AbortError', 'Transação abortada');
    queueMicrotask(() => this.onabort?.({ target: this }));
  }
}

class FakeDatabase {
  constructor(record) {
    this.record = record;
    this.name = record.name;
    this.version = record.version;
    this.objectStoreNames = {
      contains: (name) => record.stores.has(name)
    };
    this.onversionchange = null;
    this.closed = false;
  }

  createObjectStore(name, options = {}) {
    const store = new FakeStore(name, options.keyPath || 'id');
    this.record.stores.set(name, store);
    return { name, keyPath: store.keyPath, createIndex: () => ({}) };
  }

  transaction(names, mode = 'readonly') {
    const list = Array.isArray(names) ? names : [names];
    const stores = new Map();
    list.forEach((name) => {
      const store = this.record.stores.get(name);
      if (!store) throw namedError('NotFoundError', `Object store ${name} não existe`);
      stores.set(name, store);
    });
    return new FakeTransaction(stores, mode);
  }

  close() {
    this.closed = true;
  }

  addEventListener(type, handler) {
    if (type === 'versionchange') this.onversionchange = handler;
  }

  removeEventListener(type, handler) {
    if (type === 'versionchange' && this.onversionchange === handler) {
      this.onversionchange = null;
    }
  }
}

const fakeIndexedDB = {
  open(name, version = 1) {
    const request = makeRequest();

    const failure = failures.get('open');
    if (failure) {
      queueMicrotask(() => {
        request.error = failure;
        request.readyState = 'done';
        request.onerror?.({ target: request });
      });
      return request;
    }

    queueMicrotask(() => {
      let record = databases.get(name);
      if (!record) {
        // Banco novo começa na versão 0 para que open(v1) dispare upgrade,
        // exatamente como acontece no IndexedDB real.
        record = { name, version: 0, stores: new Map() };
        databases.set(name, record);
      }

      const db = new FakeDatabase(record);
      request.result = db;

      if (version > record.version) {
        const oldVersion = record.version;
        record.version = version;
        queueMicrotask(() => {
          try {
            request.onupgradeneeded?.({
              target: request,
              oldVersion,
              newVersion: version
            });
            db.version = version;
            request.readyState = 'done';
            queueMicrotask(() => request.onsuccess?.({ target: request }));
          } catch (error) {
            request.error = error;
            request.readyState = 'done';
            queueMicrotask(() => request.onerror?.({ target: request }));
          }
        });
        return;
      }

      request.readyState = 'done';
      queueMicrotask(() => request.onsuccess?.({ target: request }));
    });

    return request;
  },

  // Somente para isolar testes; a aplicação nunca chama este método.
  deleteDatabase(name) {
    const request = makeRequest();
    queueMicrotask(() => {
      databases.delete(name);
      request.readyState = 'done';
      request.onsuccess?.({ target: request });
    });
    return request;
  }
};

export function installFakeIndexedDB() {
  globalThis.indexedDB = fakeIndexedDB;
  return fakeIndexedDB;
}

export function getFakeDatabase(name) {
  return databases.get(name);
}
