import { getState, setEditorReady, setPage } from '../app/state.js';
import { escapeHtml, icon } from '../app/utils.js';
import {
  createDrawingEngine,
  getDrawingPreferences,
  DRAWING_TOOLS,
  DRAWING_COLORS,
  DRAWING_SIZES
} from '../app/drawing.js';

export const title = 'Editor';

let activeEngine = null;
let expanded = false;
let keepExpandedOnUnmount = false;

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
      <p class="lead">Agora você já pode desenhar na página 1.</p>

      <dl class="summary-list">
        <div><dt>Título</dt><dd>${escapeHtml(draft.title)}</dd></div>
        <div><dt>Autor</dt><dd>${escapeHtml(draft.author)}</dd></div>
      </dl>

      <div class="notice notice--warning">
        ${icon('info')}
        <p>Por enquanto, os desenhos ficam apenas na memória desta aba. Nada é salvo ao fechar ou recarregar a página.</p>
      </div>

      <div class="button-row">
        <button class="button button--secondary" type="button" data-action="back">Voltar</button>
        <button class="button button--primary" type="button" data-action="open-editor">Abrir editor de desenho</button>
      </div>
    </div>
  </section>`;
}

function renderToolButtons(preferences) {
  return DRAWING_TOOLS.map((tool) => `
        <button
          class="tool-button"
          type="button"
          data-tool="${tool.id}"
          aria-pressed="${preferences.tool === tool.id}"
        >
          ${icon(tool.icon)}
          <span>${tool.label}</span>
        </button>`).join('');
}

function renderColorButtons(preferences) {
  return DRAWING_COLORS.map((color) => `
        <button
          class="color-button"
          type="button"
          style="--swatch: ${color.value}"
          data-color="${color.value}"
          aria-label="Cor ${escapeHtml(color.name)}"
          aria-pressed="${preferences.color === color.value}"
        ></button>`).join('');
}

function renderSizeButtons(preferences) {
  return DRAWING_SIZES.map((size) => `
        <button
          class="size-button"
          type="button"
          data-size="${size.value}"
          aria-pressed="${preferences.size === size.value}"
        >
          <span class="size-dot" aria-hidden="true"></span>
          <span>${size.label}</span>
        </button>`).join('');
}

function renderEditor(draft) {
  const page = draft.page;
  const total = draft.pageCount;
  const preferences = getDrawingPreferences();
  const activeTool = DRAWING_TOOLS.find((tool) => tool.id === preferences.tool) || DRAWING_TOOLS[0];
  const expandLabel = expanded ? 'Minimizar' : 'Expandir';
  const expandIconName = expanded ? 'minimize' : 'expand';

  return `
  <section class="screen screen--editor${expanded ? ' is-drawing-expanded' : ''}" aria-labelledby="editor-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Editor · desenho livre</p>
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
      <button
        class="drawing-mode-toggle"
        type="button"
        data-action="toggle-expand"
        aria-pressed="${expanded}"
        aria-label="${expandLabel} área de desenho"
      >
        ${icon(expandIconName)} <span>${expandLabel}</span>
      </button>
    </div>

    <div class="drawing-frame">
      <canvas
        class="drawing-canvas"
        id="drawing-canvas"
        width="720"
        height="600"
        role="img"
        aria-label="Área de desenho da página ${page}"
        aria-describedby="drawing-hint"
      >Seu navegador não suporta canvas; peça ajuda a um adulto.</canvas>
    </div>
    <p class="hint drawing-hint" id="drawing-hint">Toque e arraste para desenhar. Também funciona com mouse ou caneta.</p>

    <div class="editor-grid drawing-controls">
      <section class="control-card" aria-labelledby="drawing-tools-title">
        <div class="control-card__head">
          <h2 class="section-title section-title--small" id="drawing-tools-title">Ferramentas</h2>
          <span class="tool-status" id="tool-status" aria-live="polite">${activeTool.label}</span>
        </div>

        <div class="tool-list" role="group" aria-label="Escolher ferramenta de desenho">
          ${renderToolButtons(preferences)}
        </div>

        <h3 class="control-card__subtitle">Espessura</h3>
        <div class="size-list" role="group" aria-label="Escolher espessura do traço">
          ${renderSizeButtons(preferences)}
        </div>
      </section>

      <section class="control-card" aria-labelledby="drawing-colors-title">
        <div class="control-card__head">
          <h2 class="section-title section-title--small" id="drawing-colors-title">Cores</h2>
          ${icon('palette')}
        </div>
        <div class="color-list" role="group" aria-label="Escolher cor do traço">
          ${renderColorButtons(preferences)}
        </div>
        <p class="hint">Escolha uma cor para voltar a desenhar com o lápis.</p>
      </section>
    </div>

    <div class="drawing-actions">
      <button class="button button--icon button--history" type="button" data-action="undo" aria-label="Desfazer último traço" title="Desfazer" disabled>
        ${icon('undo')} <span>Desfazer</span>
      </button>
      <button class="button button--icon button--history" type="button" data-action="redo" aria-label="Refazer último traço" title="Refazer" disabled>
        ${icon('redo')} <span>Refazer</span>
      </button>
      <button class="button button--clear" type="button" data-action="clear-all">
        ${icon('trash')} <span>Apagar tudo</span>
      </button>
    </div>

    <div class="mode-section">
      <h2 class="section-title section-title--small">Modos de criação</h2>
      <ul class="mode-list">
        <li class="mode-card">
          ${icon('pencil')}
          <div><strong>Desenho livre</strong><small>Pronto para usar</small></div>
        </li>
        <li class="mode-card">
          ${icon('book')}
          <div><strong>Quadrinhos</strong><small>Em breve</small></div>
        </li>
      </ul>
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
      <p class="hint" id="narration-note">Não simulamos gravação nem reprodução nesta etapa.</p>
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
      <p>Os desenhos permanecem na memória enquanto esta aba estiver aberta. Ao trocar de página eles voltam; ao recarregar, desaparecem.</p>
    </div>

    <dialog class="confirm-dialog" id="clear-dialog" aria-labelledby="clear-dialog-title">
      <div class="confirm-dialog__card">
        <div class="confirm-dialog__icon">${icon('trash')}</div>
        <h2 id="clear-dialog-title">Apagar todo o desenho desta página?</h2>
        <p class="hint">Os desenhos das outras páginas ficam como estão.</p>
        <div class="confirm-dialog__actions">
          <button class="button button--secondary" type="button" data-action="cancel-clear">Cancelar</button>
          <button class="button button--danger" type="button" data-action="confirm-clear">Apagar tudo</button>
        </div>
      </div>
    </dialog>
  </section>`;
}

export function render() {
  const draft = getState().draft;
  return draft.editorReady ? renderEditor(draft) : renderPreparation(draft);
}

function stopEngine() {
  if (!activeEngine) return;
  activeEngine.destroy();
  activeEngine = null;
}

function syncControls(root) {
  const preferences = getDrawingPreferences();

  root.querySelectorAll('[data-tool]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === preferences.tool));
  });

  root.querySelectorAll('[data-color]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.color === preferences.color));
  });

  root.querySelectorAll('[data-size]').forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.size) === preferences.size));
  });

  const status = root.querySelector('#tool-status');
  const activeTool = DRAWING_TOOLS.find((tool) => tool.id === preferences.tool);
  if (status && activeTool) status.textContent = activeTool.label;
}

function syncHistoryButtons(root, state) {
  const undoButton = root.querySelector('[data-action="undo"]');
  const redoButton = root.querySelector('[data-action="redo"]');
  if (!undoButton || !redoButton) return;

  undoButton.disabled = !state.canUndo;
  redoButton.disabled = !state.canRedo;
}

function syncExpandedState(root) {
  const screen = root.querySelector('.screen--editor');
  if (!screen) return;

  screen.classList.toggle('is-drawing-expanded', expanded);
  document.body.classList.toggle('is-drawing-expanded', expanded);

  const button = root.querySelector('[data-action="toggle-expand"]');
  if (!button) return;

  const label = expanded ? 'Minimizar' : 'Expandir';
  button.setAttribute('aria-pressed', String(expanded));
  button.setAttribute('aria-label', `${label} área de desenho`);
  button.innerHTML = `${icon(expanded ? 'minimize' : 'expand')} <span>${label}</span>`;
}

function openClearDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeClearDialog(dialog) {
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

export function mount(root, context) {
  stopEngine();

  root.querySelectorAll('[data-action="back"]').forEach((button) => {
    button.addEventListener('click', context.goBack);
  });

  root.querySelector('[data-action="open-editor"]')?.addEventListener('click', () => {
    setEditorReady(true);
    context.rerender();
  });

  const canvas = root.querySelector('#drawing-canvas');
  if (canvas) {
    const draft = getState().draft;
    activeEngine = createDrawingEngine(canvas, draft, draft.page, (historyState) => {
      syncHistoryButtons(root, historyState);
    });
    syncControls(root);
    syncExpandedState(root);

    root.querySelector('[data-action="toggle-expand"]')?.addEventListener('click', () => {
      expanded = !expanded;
      syncExpandedState(root);
      requestAnimationFrame(() => activeEngine?.redraw());
      root.querySelector('[data-action="toggle-expand"]')?.focus();
    });

    const clearButton = root.querySelector('[data-action="clear-all"]');
    const dialog = root.querySelector('#clear-dialog');
    if (clearButton && dialog) {
      clearButton.addEventListener('click', () => {
        openClearDialog(dialog);
        dialog.querySelector('[data-action="cancel-clear"]')?.focus();
      });

      dialog.querySelector('[data-action="cancel-clear"]')?.addEventListener('click', () => {
        closeClearDialog(dialog);
        clearButton.focus();
      });

      dialog.querySelector('[data-action="confirm-clear"]')?.addEventListener('click', () => {
        activeEngine?.clear();
        closeClearDialog(dialog);
        clearButton.focus();
      });

      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeClearDialog(dialog);
      });

      dialog.addEventListener('close', () => clearButton.focus());
    }

    root.querySelector('[data-action="undo"]')?.addEventListener('click', () => {
      activeEngine?.undo();
    });

    root.querySelector('[data-action="redo"]')?.addEventListener('click', () => {
      activeEngine?.redo();
    });

    root.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        activeEngine?.setTool(button.dataset.tool);
        syncControls(root);
      });
    });

    root.querySelectorAll('[data-color]').forEach((button) => {
      button.addEventListener('click', () => {
        if (getDrawingPreferences().tool === 'eraser') activeEngine?.setTool('pencil');
        activeEngine?.setColor(button.dataset.color);
        syncControls(root);
      });
    });

    root.querySelectorAll('[data-size]').forEach((button) => {
      button.addEventListener('click', () => {
        activeEngine?.setSize(Number(button.dataset.size));
        syncControls(root);
      });
    });
  }

  function changePage(delta, sourceButton) {
    const current = getState().draft.page;
    keepExpandedOnUnmount = true;
    try {
      stopEngine();
      setPage(current + delta);
      context.rerender();
    } finally {
      keepExpandedOnUnmount = false;
    }

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

export function unmount() {
  stopEngine();

  if (!keepExpandedOnUnmount) expanded = false;
  document.body.classList.remove('is-drawing-expanded');
}
