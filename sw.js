/**
 * Service Worker inicial do Meu Pequeno Quadrinho.
 *
 * Estratégia: cache-first para o app shell, com atualização silenciosa do cache
 * quando há rede. Navegações sem rede caem para o index.html em cache.
 * Nenhuma história é armazenada aqui: o cache contém apenas arquivos estáticos.
 */
const CACHE_NAME = 'meu-pequeno-quadrinho-v14';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',

  './src/app/router.js',
  './src/app/drawing.js',
  './src/app/drawing-data.js',
  './src/app/database.js',
  './src/app/story-storage.js',
  './src/app/library-data.js',
  './src/app/narration-controller.js',
  './src/app/state.js',
  './src/app/utils.js',
  './src/app/pwa.js',

  './src/screens/home.js',
  './src/screens/library.js',
  './src/screens/new-story.js',
  './src/screens/editor.js',
  './src/screens/reader.js',
  './src/screens/backups.js',
  './src/screens/not-found.js',

  './src/styles/main.css',
  './src/styles/components.css',
  './src/styles/responsive.css',

  './assets/icons/home.svg',
  './assets/icons/library.svg',
  './assets/icons/headphones.svg',
  './assets/icons/shield.svg',
  './assets/icons/backups.svg',
  './assets/icons/arrow-left.svg',
  './assets/icons/plus.svg',
  './assets/icons/book.svg',
  './assets/icons/pencil.svg',
  './assets/icons/brush.svg',
  './assets/icons/eraser.svg',
  './assets/icons/trash.svg',
  './assets/icons/expand.svg',
  './assets/icons/minimize.svg',
  './assets/icons/undo.svg',
  './assets/icons/redo.svg',
  './assets/icons/palette.svg',
  './assets/icons/mic.svg',
  './assets/icons/export.svg',
  './assets/icons/import.svg',
  './assets/icons/chevron-left.svg',
  './assets/icons/chevron-right.svg',
  './assets/icons/info.svg',
  './assets/icons/sparkles.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',

  './assets/illustrations/home-hero.svg',
  './assets/illustrations/empty-library.svg',
  './assets/illustrations/preview-cover.svg',
  './assets/illustrations/reader-placeholder.svg',
  './assets/illustrations/canvas-placeholder.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });

      return cached || network;
    })
  );
});
