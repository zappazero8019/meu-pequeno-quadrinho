import {
  getState,
  prepareDraftForStory,
  setEditorReady,
  setPage
} from '../app/state.js';
import { escapeHtml, icon } from '../app/utils.js';
import {
  createDrawingEngine,
  getDrawingPreferences,
  serializePageDrawing,
  DRAWING_TOOLS,
  DRAWING_COLORS,
  DRAWING_SIZES
} from '../app/drawing.js';
import {
  ensureStoryLoaded,
  flushPendingSaves,
  getSaveStatus,
  markPageChanged,
  requestSave,
  retrySave,
  subscribeSaveStatus
} from '../app/story-storage.js';
import {
  cancelRecording,
  deletePageNarration,
  formatDuration,
  getNarrationStatus,
  isNarrationBusy,
  isNarrationRecording,
  loadPageNarration,
  NARRATION_REASON,
  NARRATION_STATE,
  pauseNarration,
  playNarration,
  replayNarration,
  retrySaveNarration,
  startRecording,
  stopPlayback,
  stopRecording,
  subscribeNarrationStatus
} from '../app/narration-controller.js';

export const title = 'Editor';

let activeEngine = null;
let expanded = false;
let keepExpandedOnUnmount = false;
let unsubscribeSaveStatus = null;
let unsubscribeNarrationStatus = null;
let narrationClickHandler = null;
let activeRootForNarration = null;
let pageHideHandler = null;
let lastDrawingSignature = '';
let changingPage = false;
let deletingNarration = false;
let narration = getNarrationStatus();
let mountEpoch = 0;

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

      <div class="notice notice--info">
        ${icon('info')}
        <p>Depois de abrir o editor, cada traço concluído é salvo automaticamente neste dispositivo. Você poderá continuar depois.</p>
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

function pageKey(draft) {
  const pageId = draft.pages?.[draft.page - 1]?.id;
  if (!draft.storyId || !pageId) return null;
  return { storyId: draft.storyId, pageId };
}

function isSamePageStatus(draft, value) {
  const key = pageKey(draft);
  return Boolean(
    key && value?.storyId === key.storyId && value?.pageId === key.pageId
  );
}

function narrationStatusMessage(draft, value) {
  if (!value.supported) return 'Este navegador não suporta gravação de voz.';
  if (!isSamePageStatus(draft, value)) return 'Nenhuma narração nesta página.';

  if (value.state === NARRATION_STATE.REQUESTING) return value.message;
  if (value.state === NARRATION_STATE.RECORDING) {
    return `Gravando... ${formatDuration(value.elapsedMs)}`;
  }
  if (value.state === NARRATION_STATE.PROCESSING || value.state === NARRATION_STATE.SAVING) {
    return value.message;
  }
  if (value.state === NARRATION_STATE.ERROR) return value.message;
  if (value.hasRecording) return value.message || 'Esta página já tem narração.';
  return 'Nenhuma narração nesta página.';
}

function renderNarrationContent(draft, value) {
  const samePage = isSamePageStatus(draft, value);
  const hasRecording = samePage && value.hasRecording;
  const recording = samePage && isNarrationRecording();
  const busy = isNarrationBusy();
  const playing = samePage && value.state === NARRATION_STATE.PLAYING;
  const failedSave = samePage && value.state === NARRATION_STATE.ERROR && (
    value.reason === NARRATION_REASON.STORAGE_ERROR || value.reason === NARRATION_REASON.QUOTA
  );

  const message = narrationStatusMessage(draft, value);
  const statusClass = recording ? 'narration-status is-recording' : 'narration-status';
  const live = recording ? 'assertive' : 'polite';

  const buttons = [];

  buttons.push(`
    <button
      class="button button--accent"
      type="button"
      data-narration-action="start"
      ${!value.supported || busy ? 'disabled' : ''}
      aria-label="${recording ? 'Gravando narração' : 'Gravar narração nesta página'}"
      aria-describedby="narration-message"
    >
      ${icon('mic')} <span>${recording ? 'Gravando...' : 'Gravar narração'}</span>
    </button>`);

  if (recording) {
    buttons.push(`
      <button class="button button--danger" type="button" data-narration-action="stop">
        Parar gravação
      </button>`);
  }

  if (playing) {
    buttons.push(`
      <button class="button button--secondary" type="button" data-narration-action="pause">
        Pausar
      </button>`);
  }

  if (hasRecording && !busy) {
    buttons.push(`
      <button class="button button--secondary" type="button" data-narration-action="play" aria-label="Ouvir a narração desta página">
        ${icon('headphones')} <span>Ouvir narração</span>
      </button>`);

    if (!playing) {
      buttons.push(`
        <button class="button button--secondary" type="button" data-narration-action="replay">
          Ouvir de novo
        </button>`);
    }

    buttons.push(`
      <button class="button button--clear" type="button" data-narration-action="ask-delete" aria-label="Excluir a narração desta página">
        ${icon('trash')} <span>Excluir narração</span>
      </button>`);
  }

  if (failedSave) {
    buttons.push(`
      <button class="button button--secondary" type="button" data-narration-action="retry-save">
        Tentar salvar novamente
      </button>`);
  }

  return `
    <div class="${statusClass}" id="narration-message" role="status" aria-live="${live}">
      <span class="narration-status__dot" aria-hidden="true"></span>
      <span>${escapeHtml(message)}</span>
    </div>
    <div class="narration-actions" role="group" aria-label="Controles da narração desta página">
      ${buttons.join('')}
    </div>`;
}

function renderPageControls(draft) {
  const busy = isNarrationBusy();
  const atStart = draft.page === 1;
  const atEnd = draft.page >= draft.pageCount;

  return `
    <div class="page-controls" aria-label="Navegação entre páginas">
      <button
        class="button button--secondary"
        type="button"
        data-action="prev-page"
        aria-label="Ir para a página anterior"
        ${atStart || busy ? 'disabled' : ''}
      >
        ${icon('chevron-left')} <span class="page-controls__label">Página anterior</span>
      </button>
      <button
        class="button button--secondary"
        type="button"
        data-action="next-page"
        aria-label="Ir para a próxima página"
        ${atEnd || busy ? 'disabled' : ''}
      >
        <span class="page-controls__label">Próxima página</span> ${icon('chevron-right')}
      </button>
    </div>`;
}

function renderEditor(draft) {
  const page = draft.page;
  const total = draft.pageCount;
  const preferences = getDrawingPreferences();
  const activeTool = DRAWING_TOOLS.find((tool) => tool.id === preferences.tool) || DRAWING_TOOLS[0];
  const expandLabel = expanded ? 'Minimizar' : 'Expandir';
  const expandIconName = expanded ? 'minimize' : 'expand';
  const save = getSaveStatus();

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
      <span class="save-status" id="save-status" data-state="${save.state}" role="status" aria-live="polite" title="${escapeHtml(save.message)}">
        <span class="save-status__dot" aria-hidden="true"></span>
        <span class="save-status__label">${escapeHtml(save.message)}</span>
        <button class="save-status__retry" type="button" data-action="retry-save" ${save.state === 'error' ? '' : 'hidden'}>Tentar novamente</button>
      </span>
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

    <div class="editor-extra-controls">
      <section class="narration-box" aria-labelledby="narration-title">
        <div class="narration-heading">
          ${icon('mic')}
          <div>
            <h3 id="narration-title">Narração</h3>
            <p>Sua voz, gravada nesta página.</p>
          </div>
        </div>
        <div id="narration-content">${renderNarrationContent(draft, narration)}</div>
        <p class="hint" id="narration-note">O microfone só é pedido quando você toca em Gravar. Nada é enviado para a internet.</p>
      </section>

      ${renderPageControls(draft)}
    </div>

    <div class="notice notice--info">
      ${icon('info')}
      <p>Cada traço, limpeza, Desfazer e Refazer concluídos são salvos neste dispositivo. Se a gravação falhar, seu desenho continua aqui e você pode tentar novamente.</p>
    </div>

    <dialog class="confirm-dialog" id="clear-dialog" aria-labelledby="clear-dialog-title">
      <div class="confirm-dialog__card">
        <div class="confirm-dialog__icon">${icon('trash')}</div>
        <h2 id="clear-dialog-title">Apagar todo o desenho desta página?</h2>
        <p class="hint">Os desenhos das outras páginas e as narrações ficam como estão.</p>
        <div class="confirm-dialog__actions">
          <button class="button button--secondary" type="button" data-action="cancel-clear">Cancelar</button>
          <button class="button button--danger" type="button" data-action="confirm-clear">Apagar tudo</button>
        </div>
      </div>
    </dialog>

    <dialog class="confirm-dialog" id="narration-delete-dialog" aria-labelledby="narration-delete-title">
      <div class="confirm-dialog__card">
        <div class="confirm-dialog__icon">${icon('mic')}</div>
        <h2 id="narration-delete-title">Excluir esta narração?</h2>
        <p class="hint" id="narration-delete-detail">A narração desta página será removida deste dispositivo.</p>
        <div class="confirm-dialog__actions">
          <button class="button button--secondary" type="button" data-narration-action="cancel-delete">Cancelar</button>
          <button class="button button--danger" type="button" data-narration-action="confirm-delete">Excluir narração</button>
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

function syncSaveStatus(root, next = getSaveStatus()) {
  const indicator = root.querySelector('#save-status');
  if (!indicator) return;

  indicator.dataset.state = next.state;
  indicator.title = next.message;

  const label = indicator.querySelector('.save-status__label');
  if (label) label.textContent = next.message;

  const retry = indicator.querySelector('.save-status__retry');
  if (retry) retry.hidden = next.state !== 'error';
}

function syncNarration(root) {
  const content = root.querySelector('#narration-content');
  if (!content) return;
  content.innerHTML = renderNarrationContent(getState().draft, narration);
}

function syncPageControls(root) {
  const busy = isNarrationBusy();
  const draft = getState().draft;

  const previous = root.querySelector('[data-action="prev-page"]');
  if (previous) previous.disabled = draft.page === 1 || busy;

  const next = root.querySelector('[data-action="next-page"]');
  if (next) next.disabled = draft.page >= draft.pageCount || busy;
}

function openDialogElement(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialogElement(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function canvasView(canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width || canvas.clientWidth || 360),
    height: Math.max(1, rect.height || canvas.clientHeight || 640)
  };
}

function drawingSignature(draft, page) {
  return JSON.stringify(serializePageDrawing(draft, page));
}

/** Chamado só após uma ação concluída — nunca durante PointerMove. */
function handleHistoryCompleted(draft) {
  const signature = drawingSignature(draft, draft.page);
  if (signature === lastDrawingSignature) return;

  lastDrawingSignature = signature;
  markPageChanged(draft, draft.page);
  void requestSave(draft);
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

async function handleNarrationClick(event, root) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('button[data-narration-action]');
  if (!button || button.disabled || !root.contains(button)) return;

  const action = button.dataset.narrationAction;
  const key = pageKey(getState().draft);
  if (!key && action !== 'cancel-delete' && action !== 'confirm-delete') return;

  const dialog = root.querySelector('#narration-delete-dialog');

  if (action === 'start') {
    void startRecording(key);
    return;
  }

  if (action === 'stop') {
    void stopRecording();
    return;
  }

  if (action === 'play') {
    void playNarration(key);
    return;
  }

  if (action === 'pause') {
    pauseNarration();
    return;
  }

  if (action === 'replay') {
    void replayNarration(key);
    return;
  }

  if (action === 'retry-save') {
    void retrySaveNarration();
    return;
  }

  if (action === 'ask-delete') {
    if (!isSamePageStatus(getState().draft, narration) || !narration.hasRecording) return;
    const draft = getState().draft;
    const detail = dialog?.querySelector('#narration-delete-detail');
    if (detail) {
      detail.textContent = `A narração da página ${draft.page} de "${draft.title}" será removida deste dispositivo. Os desenhos não são afetados.`;
    }
    openDialogElement(dialog);
    dialog?.querySelector('[data-narration-action="cancel-delete"]')?.focus();
    return;
  }

  if (action === 'cancel-delete') {
    closeDialogElement(dialog);
    root.querySelector('[data-narration-action="ask-delete"]')?.focus();
    return;
  }

  if (action === 'confirm-delete') {
    if (deletingNarration) return;
    deletingNarration = true;
    dialog?.querySelectorAll('button').forEach((item) => { item.disabled = true; });

    const result = await deletePageNarration(key || pageKey(getState().draft));

    deletingNarration = false;
    dialog?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
    closeDialogElement(dialog);
    root.querySelector('[data-narration-action="start"]')?.focus();
    void result;
  }
}

export async function mount(root, context) {
  const epoch = ++mountEpoch;
  stopEngine();

  unsubscribeSaveStatus?.();
  unsubscribeSaveStatus = subscribeSaveStatus((next) => syncSaveStatus(root, next));

  unsubscribeNarrationStatus?.();
  unsubscribeNarrationStatus = subscribeNarrationStatus((next) => {
    narration = next;
    if (epoch !== mountEpoch) return;
    syncNarration(root);
    syncPageControls(root);
  });

  if (narrationClickHandler && activeRootForNarration) {
    activeRootForNarration.removeEventListener('click', narrationClickHandler);
  }
  narrationClickHandler = (event) => void handleNarrationClick(event, root);
  activeRootForNarration = root;
  root.addEventListener('click', narrationClickHandler);

  const requestedStory = context.getQueryParam?.('story');
  if (requestedStory) prepareDraftForStory(requestedStory);

  root.querySelectorAll('[data-action="back"]').forEach((button) => {
    button.addEventListener('click', context.goBack);
  });

  root.querySelector('[data-action="open-editor"]')?.addEventListener('click', () => {
    setEditorReady(true);
    context.rerender();
  });

  root.querySelector('[data-action="retry-save"]')?.addEventListener('click', () => {
    void retrySave(getState().draft);
  });

  const canvas = root.querySelector('#drawing-canvas');
  if (!canvas) {
    // Na tela de preparação já podemos carregar o ID recebido pela URL. Assim,
    // ao abrir o editor os buffers vêm do banco antes do motor ser criado.
    if (requestedStory) void ensureStoryLoaded(getState().draft);
    return;
  }

  const draft = getState().draft;
  await ensureStoryLoaded(draft, canvasView(canvas));
  // O roteador troca apenas o conteúdo de #app, que continua "connected".
  // O epoch evita que uma montagem antiga crie escutas em um canvas já solto.
  if (epoch !== mountEpoch) return;

  syncSaveStatus(root);
  lastDrawingSignature = drawingSignature(draft, draft.page);

  activeEngine = createDrawingEngine(canvas, draft, draft.page, (historyState) => {
    syncHistoryButtons(root, historyState);
    handleHistoryCompleted(draft);
  });
  syncControls(root);
  syncExpandedState(root);
  syncNarration(root);
  syncPageControls(root);

  const initialNarrationKey = pageKey(draft);
  if (initialNarrationKey) void loadPageNarration(initialNarrationKey);

  pageHideHandler = () => {
    if (isNarrationBusy()) cancelRecording();
    stopPlayback();
    void flushPendingSaves();
  };
  window.addEventListener('pagehide', pageHideHandler);

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

  async function changePage(delta, sourceButton) {
    if (changingPage) return;
    if (isNarrationBusy()) {
      root.querySelector('[data-narration-action="stop"]')?.focus();
      return;
    }

    changingPage = true;
    keepExpandedOnUnmount = true;

    try {
      await flushPendingSaves();
      stopPlayback();
      stopEngine();
      await flushPendingSaves();
      setPage(getState().draft.page + delta);
      lastDrawingSignature = drawingSignature(getState().draft, getState().draft.page);
      context.rerender();
    } finally {
      changingPage = false;
      keepExpandedOnUnmount = false;
    }

    const selector = delta > 0 ? '[data-action="next-page"]' : '[data-action="prev-page"]';
    const replacement = root.querySelector(selector);
    if (replacement && !replacement.disabled) replacement.focus();
    else sourceButton?.focus();
  }

  root.querySelector('[data-action="prev-page"]')?.addEventListener('click', (event) => {
    void changePage(-1, event.currentTarget);
  });

  root.querySelector('[data-action="next-page"]')?.addEventListener('click', (event) => {
    void changePage(1, event.currentTarget);
  });
}

export function unmount() {
  mountEpoch += 1;
  stopEngine();
  void flushPendingSaves();

  unsubscribeSaveStatus?.();
  unsubscribeSaveStatus = null;

  unsubscribeNarrationStatus?.();
  unsubscribeNarrationStatus = null;

  if (narrationClickHandler && activeRootForNarration) {
    activeRootForNarration.removeEventListener('click', narrationClickHandler);
  }
  narrationClickHandler = null;
  activeRootForNarration = null;

  if (isNarrationBusy()) cancelRecording();
  stopPlayback();

  if (pageHideHandler) {
    window.removeEventListener('pagehide', pageHideHandler);
    pageHideHandler = null;
  }

  if (!keepExpandedOnUnmount) expanded = false;
  document.body.classList.remove('is-drawing-expanded');
}
