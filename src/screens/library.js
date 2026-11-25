import { getState } from '../app/state.js';
import { escapeHtml, icon } from '../app/utils.js';
import {
  beginDelete,
  cancelDelete,
  confirmDelete,
  getPendingDeleteId,
  LIBRARY_STATE,
  loadLibrary,
  openStory
} from '../app/library-data.js';

export const title = 'Biblioteca';

let view = {
  state: LIBRARY_STATE.LOADING,
  stories: [],
  error: null,
  notice: null,
  failedDeleteId: null,
  deletingId: null,
  pendingDeleteId: null
};

let mountEpoch = 0;
let activeRoot = null;
let activeContext = null;
let clickHandler = null;
let pageShowHandler = null;

function storyById(id) {
  return view.stories.find((story) => story.id === id) || null;
}

function renderLoading() {
  return `
    <div class="library-loading card" role="status" aria-live="polite">
      ${icon('library')}
      <p>Carregando suas histórias...</p>
    </div>`;
}

function renderEmpty() {
  return `
    <div class="empty-state card">
      <img
        src="./assets/illustrations/empty-library.svg"
        alt="Estante de quadrinhos vazia com um ponto de interrogação"
      >
      <h2>Nenhuma aventura por aqui ainda</h2>
      <p>Você ainda não criou histórias neste dispositivo. Que tal começar a primeira?</p>
      <a class="button button--primary" href="#/new-story">${icon('plus')} Criar minha história</a>
    </div>`;
}

function renderReadError() {
  return `
    <div class="notice notice--warning" role="alert">
      ${icon('info')}
      <p><strong>Não foi possível carregar a biblioteca.</strong> Suas histórias continuam no dispositivo; tente ler novamente.</p>
      <button class="button button--secondary" type="button" data-action="retry-load">Tentar novamente</button>
    </div>`;
}

function renderNotice() {
  if (!view.notice) return '';

  return `
    <div class="notice notice--warning" role="alert">
      ${icon('info')}
      <p>${escapeHtml(view.notice)}</p>
      ${view.failedDeleteId ? '<button class="button button--secondary" type="button" data-action="retry-delete">Tentar novamente</button>' : ''}
    </div>`;
}

function renderStoryCard(story) {
  const labelId = `story-title-${escapeHtml(story.id)}`;
  const cover = story.cover
    ? `<img src="${escapeHtml(story.cover)}" alt="Capa da história ${escapeHtml(story.title)}">`
    : `<img src="./assets/illustrations/canvas-placeholder.svg" alt="Esta história ainda não tem capa">`;
  const pagesLabel = story.pageCount === 1 ? '1 página' : `${story.pageCount} páginas`;
  const deleting = view.deletingId === story.id;

  return `
    <article class="story-card story-card--saved" aria-labelledby="${labelId}">
      <div class="story-card__cover">${cover}</div>
      <div class="story-card__body">
        <h3 id="${labelId}">${escapeHtml(story.title)}</h3>
        <p class="story-card__meta">por ${escapeHtml(story.author || 'Autor não informado')}</p>
        <p class="story-card__meta">${pagesLabel}</p>
        <p class="story-card__meta">Atualizado em ${escapeHtml(story.updatedLabel)}</p>
        <div class="story-card__actions">
          <button
            class="button button--primary"
            type="button"
            data-action="open-story"
            data-story-id="${escapeHtml(story.id)}"
            ${deleting ? 'disabled' : ''}
          >Continuar</button>
          <button
            class="button button--danger"
            type="button"
            data-action="ask-delete"
            data-story-id="${escapeHtml(story.id)}"
            aria-label="Excluir a história ${escapeHtml(story.title)}"
            ${deleting ? 'disabled' : ''}
          >${icon('trash')} Excluir</button>
        </div>
      </div>
    </article>`;
}

function renderStoryList() {
  return `
    <div class="story-list">
      ${view.stories.map(renderStoryCard).join('')}
    </div>`;
}

function renderContent() {
  if (view.state === LIBRARY_STATE.LOADING) return renderLoading();
  if (view.state === LIBRARY_STATE.ERROR) return renderReadError();
  if (view.state === LIBRARY_STATE.EMPTY) return renderEmpty();
  return renderStoryList();
}

function renderDialog() {
  const pending = storyById(view.pendingDeleteId);
  const name = pending?.title || 'esta história';
  const deleting = Boolean(view.deletingId);

  return `
    <dialog class="confirm-dialog" id="delete-dialog" aria-labelledby="delete-dialog-title">
      <div class="confirm-dialog__card">
        <div class="confirm-dialog__icon">${icon('trash')}</div>
        <h2 id="delete-dialog-title">Excluir esta história?</h2>
        <p class="hint">A história <strong id="delete-story-name">${escapeHtml(name)}</strong> será removida deste dispositivo. Isso não pode ser desfeito.</p>
        <div class="confirm-dialog__actions">
          <button class="button button--secondary" type="button" data-action="cancel-delete" ${deleting ? 'disabled' : ''}>Cancelar</button>
          <button class="button button--danger" type="button" data-action="confirm-delete" ${deleting ? 'disabled' : ''}>${deleting ? 'Excluindo...' : 'Excluir história'}</button>
        </div>
      </div>
    </dialog>`;
}

export function render() {
  return `
  <section class="screen screen--library" aria-labelledby="library-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Sua coleção</p>
        <h1 id="library-title">Biblioteca</h1>
        <p class="screen-subtitle">Continue de onde você parou ou comece uma nova aventura.</p>
      </div>
      <button class="icon-button" type="button" data-action="back" aria-label="Voltar à tela anterior">
        ${icon('arrow-left')}
      </button>
    </header>

    ${renderNotice()}
    ${renderContent()}
    ${renderDialog()}
  </section>`;
}

function isActive() {
  return Boolean(activeRoot) && getState().currentRoute === 'library';
}

/** Atualiza o conteúdo sem pedir um novo ciclo de montagem ao roteador. */
function paint() {
  if (!isActive()) return;
  activeRoot.innerHTML = render();
}

async function refresh() {
  view = {
    ...view,
    state: LIBRARY_STATE.LOADING,
    stories: [],
    error: null,
    deletingId: null,
    pendingDeleteId: null
  };
  paint();

  const result = await loadLibrary();
  if (!isActive()) return;

  view = {
    ...view,
    state: result.state,
    stories: result.stories,
    error: result.error,
    deletingId: null,
    pendingDeleteId: null
  };
  paint();
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog() {
  const dialog = activeRoot?.querySelector('#delete-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function askDelete(id) {
  const story = storyById(id);
  if (!story || view.deletingId) return;

  beginDelete(id);
  view = { ...view, pendingDeleteId: id };
  paint();

  const dialog = activeRoot?.querySelector('#delete-dialog');
  const name = dialog?.querySelector('#delete-story-name');
  if (name) name.textContent = story.title;
  openDialog(dialog);
  dialog?.querySelector('[data-action="cancel-delete"]')?.focus();
}

function cancelDeleteDialog() {
  const id = getPendingDeleteId();
  cancelDelete(id);
  closeDialog();
  view = { ...view, pendingDeleteId: null, deletingId: null };
  paint();

  const buttons = activeRoot?.querySelectorAll('[data-action="ask-delete"]') || [];
  Array.from(buttons).find((button) => button.dataset.storyId === id)?.focus();
}

async function handleOpen(id) {
  const result = await openStory(id, activeContext);
  if (result.ok || result.reason === 'navigation') return;
  if (!isActive()) return;

  const name = storyById(id)?.title || 'esta história';
  view = {
    ...view,
    notice: result.reason === 'missing'
      ? `A história "${name}" não existe mais neste dispositivo.`
      : `Não foi possível abrir "${name}". Tente novamente.`,
    failedDeleteId: null
  };
  paint();
}

async function handleDelete() {
  if (view.deletingId) return;

  const id = getPendingDeleteId();
  if (!id) return;

  const story = storyById(id);
  view = { ...view, deletingId: id };
  paint();

  const result = await confirmDelete(id);
  if (!isActive()) return;

  view = { ...view, deletingId: null };
  closeDialog();

  if (result.ok && result.deleted) {
    view = { ...view, notice: null, failedDeleteId: null, pendingDeleteId: null };
    await refresh();
    return;
  }

  if (result.ok && !result.deleted) {
    view = { ...view, notice: 'Essa história já não estava mais na biblioteca.', failedDeleteId: null };
    await refresh();
    return;
  }

  const detail = result.error?.message || 'Tente novamente.';
  view = {
    ...view,
    notice: `Não foi possível excluir "${story?.title || 'esta história'}". ${detail}`,
    failedDeleteId: id,
    pendingDeleteId: id
  };
  paint();
}

async function handleClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('button[data-action]');
  if (!button || button.disabled || !activeRoot?.contains(button)) return;

  const action = button.dataset.action;
  if (action === 'back') {
    activeContext?.goBack?.();
    return;
  }

  if (action === 'retry-load') {
    await refresh();
    return;
  }

  if (action === 'retry-delete') {
    if (view.failedDeleteId) askDelete(view.failedDeleteId);
    return;
  }

  if (action === 'open-story') {
    await handleOpen(button.dataset.storyId);
    return;
  }

  if (action === 'ask-delete') {
    askDelete(button.dataset.storyId);
    return;
  }

  if (action === 'cancel-delete') {
    cancelDeleteDialog();
    return;
  }

  if (action === 'confirm-delete') {
    await handleDelete();
  }
}

export function mount(root, context) {
  ++mountEpoch;
  activeRoot = root;
  activeContext = context;

  cancelDelete(getPendingDeleteId());
  view = {
    ...view,
    state: LIBRARY_STATE.LOADING,
    stories: [],
    error: null,
    notice: null,
    failedDeleteId: null,
    deletingId: null,
    pendingDeleteId: null
  };
  paint();

  clickHandler = (event) => void handleClick(event);
  root.addEventListener('click', clickHandler);

  pageShowHandler = (event) => {
    if (event.persisted) void refresh();
  };
  window.addEventListener('pageshow', pageShowHandler);

  void refresh();
}

export function unmount() {
  mountEpoch += 1;

  if (activeRoot && clickHandler) activeRoot.removeEventListener('click', clickHandler);
  if (pageShowHandler) window.removeEventListener('pageshow', pageShowHandler);

  clickHandler = null;
  pageShowHandler = null;
  activeRoot = null;
  activeContext = null;

  cancelDelete(getPendingDeleteId());
  view = { ...view, deletingId: null, pendingDeleteId: null };
}
