import { getState, setReaderPage } from '../app/state.js';
import { icon } from '../app/utils.js';

const PREVIEW_PAGES = 3;

export const title = 'Leitura';

export function render() {
  const page = getState().readerPage;

  return `
  <section class="screen screen--reader" aria-labelledby="reader-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Hora da história</p>
        <h1 id="reader-title">Leitura</h1>
        <p class="screen-subtitle">Prévia da interface do livro.</p>
      </div>
      <button class="icon-button" type="button" data-action="back" aria-label="Voltar à tela anterior">
        ${icon('arrow-left')}
      </button>
    </header>

    <div class="reader-status">
      <span class="badge badge--soon">Prévia da interface</span>
      <span class="page-pill" aria-live="polite">Página ${page} de ${PREVIEW_PAGES}</span>
    </div>

    <div class="book-frame">
      <div class="book-page" role="img" aria-label="Ilustração genérica da página ${page}; nenhuma história salva">
        <img class="book-art" src="./assets/illustrations/reader-placeholder.svg" alt="">
        <span class="book-page__caption">A ilustração aparecerá aqui</span>
      </div>
    </div>

    <div class="audio-control">
      ${icon('mic')}
      <div>
        <h2>Áudio da narração</h2>
        <p>Controle visual — ainda sem gravação ou reprodução.</p>
      </div>
      <button class="mini-button" type="button" disabled>Ouvir · em breve</button>
    </div>

    <div class="page-controls" aria-label="Navegação entre páginas">
      <button class="button button--secondary" type="button" data-action="prev-page" ${page === 1 ? 'disabled' : ''}>
        ${icon('chevron-left')} Página anterior
      </button>
      <button class="button button--secondary" type="button" data-action="next-page" ${page === PREVIEW_PAGES ? 'disabled' : ''}>
        Próxima página ${icon('chevron-right')}
      </button>
    </div>

    <div class="notice notice--info">
      ${icon('info')}
      <p>Não há histórias salvas para ler. Esta é apenas a prévia da tela de leitura.</p>
    </div>

    <a class="button button--secondary button--block" href="#/library">${icon('library')} Voltar à biblioteca</a>
  </section>`;
}

export function mount(root, context) {
  root.querySelector('[data-action="back"]').addEventListener('click', context.goBack);

  function changePage(delta, sourceButton) {
    setReaderPage(getState().readerPage + delta);
    context.rerender();

    const selector = delta > 0 ? '[data-action="next-page"]' : '[data-action="prev-page"]';
    const replacement = root.querySelector(selector);
    if (replacement && !replacement.disabled) replacement.focus();
    else sourceButton?.focus();
  }

  root.querySelector('[data-action="prev-page"]').addEventListener('click', (event) => {
    changePage(-1, event.currentTarget);
  });

  root.querySelector('[data-action="next-page"]').addEventListener('click', (event) => {
    changePage(1, event.currentTarget);
  });
}
