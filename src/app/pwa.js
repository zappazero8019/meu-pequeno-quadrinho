/** Registro do Service Worker, isolado do roteador. */

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.info('Service Worker não suportado neste navegador.');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => console.info('Service Worker registrado.'))
      .catch((error) => {
        // Em file:// ou contextos não seguros isso é esperado; não é erro da aplicação.
        console.info('Service Worker não registrado neste contexto:', error.message);
      });
  });
}
