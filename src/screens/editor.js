import { getState, setEditorReady, setPage } from '../app/state.js';
import { escapeHtml, icon } from '../app/utils.js';

export const title = 'Editor';

function renderPreparation(draft) {
  return `
  <section class="screen screen--editor-prep" aria-labelledby="editor-prep-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Quase lá!</p>
        <h1 id="editor-prep-title">Tudo pronto para começar?</h1>
        <p class="screen-subtitle">Confira os dados antes de abrir o editor.</p>
      </div>
      <button class="icon-button" type="button" data-action="back" aria-label="Voltar à tela anterior">
        ${icon('arrow-left')}
      </button>
    </header>

    <div class="card prep-card">
      <div class="prep-illustration">${icon('pencil')}</div>
      <h2>Sua nova aventura</h2>
      <p class="lead">Agora você verá a estrutura visual da página 1.</p>

      <dl class="summary-list">
        <div><dt>Título</dt><dd>${escapeHtml(draft.title)}</dd></div>
        <div><dt>Autor</dt><dd>${escapeHtml(draft.author)}</dd></div>
      </dl>

      <div class="notice notice--warning">
        ${icon('info')}
        <p>Nesta fase, ainda não salvamos desenhos, páginas nem áudio. Esta é apenas a estrutura do editor.</p>
      </div>

      <div class="button-row">
        <button class="button button--secondary" type="button" data-action="back">Voltar</button>
        <button class="button button--primary" type="button" data-action="open-editor">Ver estrutura do editor</button>
      </div>
    </div>
  </section>`;
}

function renderEditor(draft) {
  const page = draft.page;
  const total = draft.pageCount;

  return `
  <section class="screen screen--editor" aria-labelledby="editor-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Editor · estrutura visual</p>
        <h1 id="editor-title">${escapeHtml(draft.title)}</h1>
        <p class="screen-subtitle">por ${escapeHtml(draft.author)}</p>
      </div>
      <button class="icon-button" type="button" data-action="back" aria-label="Voltar à tela anterior">
        ${icon('arrow-left')}
      </button>
    </header>

    <div class="editor-status">
      <span class="badge badge--soon">Recursos em breve</span>
      <span class="page-pill" aria-live="polite">Página ${page} de ${total}</span>
    </div>

    <div class="canvas-placeholder" role="img" aria-label="Área ilustrativa de desenho, sem ferramentas ativas nesta fase">
      <img class="canvas-art" src="./assets/illustrations/canvas-placeholder.svg" alt="">
      <div class="canvas-overlay">
        <strong class="canvas-label">Área de desenho</strong>
        <span class="canvas-note">Prévia — nada é desenhado ou salvo</span>
      </div>
    </div>

    <div class="mode-section">
      <h2 class="section-title section-title--small">Modos de criação</h2>
      <ul class="mode-list">
        <li class="mode-card">
          ${icon('pencil')}
          <div><strong>Desenho livre</strong><small>Em breve</small></div>
        </li>
        <li class="mode-card">
          ${icon('book')}
          <div><strong>Quadrinhos</strong><small>Em breve</small></div>
        </li>
      </ul>
    </div>

    <div class="editor-grid">
      <section class="placeholder-box" aria-label="Espaço reservado para ferramentas">
        ${icon('pencil')}
        <h3>Ferramentas</h3>
        <p>Lápis, borracha e formas chegam em breve.</p>
        <button class="mini-button" type="button" disabled>Em breve</button>
      </section>

      <section class="placeholder-box" aria-label="Espaço reservado para paleta de cores">
        ${icon('palette')}
        <h3>Paleta de cores</h3>
        <p>Espaço reservado para escolher cores.</p>
        <button class="mini-button" type="button" disabled>Em breve</button>
      </section>
    </div>

    <section class="narration-box" aria-labelledby="narration-title">
      <div class="narration-heading">
        ${icon('mic')}
        <div>
          <h3 id="narration-title">Narração</h3>
          <p>Gravação de voz ainda não implementada.</p>
        </div>
      </div>
      <button class="button button--accent" type="button" disabled aria-describedby="narration-note">
        ${icon('mic')} Gravar narração · em breve
      </button>
      <p class="hint" id="narration-note">Não simulamos gravação nem reprodução nesta fase.</p>
    </section>

    <div class="page-controls" aria-label="Navegação entre páginas">
      <button class="button button--secondary" type="button" data-action="prev-page" ${page === 1 ? 'disabled' : ''}>
        ${icon('chevron-left')} Página anterior
      </button>
      <button class="button button--secondary" type="button" data-action="next-page" ${page === total ? 'disabled' : ''}>
        Próxima página ${icon('chevron-right')}
      </button>
    </div>

    <div class="notice notice--info">
      ${icon('info')}
      <p>Os botões de página funcionam, mas nenhum conteúdo desta tela é salvo.</p>
    </div>
  </section>`;
}

export function render() {
  const draft = getState().draft;
  return draft.editorReady ? renderEditor(draft) : renderPreparation(draft);
}

export function mount(root, context) {
  root.querySelectorAll('[data-action="back"]').forEach((button) => {
    button.addEventListener('click', context.goBack);
  });

  root.querySelector('[data-action="open-editor"]')?.addEventListener('click', () => {
    setEditorReady(true);
    context.rerender();
  });

  function changePage(delta, sourceButton) {
    const current = getState().draft.page;
    setPage(current + delta);
    context.rerender();

    const selector = delta > 0 ? '[data-action="next-page"]' : '[data-action="prev-page"]';
    const replacement = root.querySelector(selector);
    if (replacement && !replacement.disabled) replacement.focus();
    else sourceButton?.focus();
  }

  root.querySelector('[data-action="prev-page"]')?.addEventListener('click', (event) => {
    changePage(-1, event.currentTarget);
  });

  root.querySelector('[data-action="next-page"]')?.addEventListener('click', (event) => {
    changePage(1, event.currentTarget);
  });
}
