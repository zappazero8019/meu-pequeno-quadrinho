import { getState } from '../app/state.js';
import { icon } from '../app/utils.js';
import { getLatestStory, LIBRARY_STATE, loadLibrary, openStory } from '../app/library-data.js';

export const title = 'Início';

let latestStory = null;
let homeEpoch = 0;
let activeRoot = null;
let clickHandler = null;

export function render() {
  return `
  <section class="screen screen--home" aria-labelledby="home-title">
    <div class="hero-card">
      <div class="hero-card__copy">
        <p class="eyebrow">${icon('sparkles')} Bem-vindo!</p>
        <h1 id="home-title" class="screen-title">Meu Pequeno Quadrinho</h1>
        <p class="lead">Crie aventuras com desenhos, cores e narrações. Uma página de cada vez.</p>
        <a class="button button--primary button--block button--hero" href="#/new-story">
          ${icon('plus')} Criar minha história
        </a>
        <p class="hero-note">Seus desenhos são salvos automaticamente neste dispositivo.</p>
      </div>
      <div class="hero-card__art">
        <img
          class="hero-illustration"
          src="./assets/illustrations/home-hero.svg"
          alt="Ilustração de duas páginas de quadrinhos, estrelas e um lápis sorridente"
        >
      </div>
    </div>

    <div class="card continue-card" id="continue-card" hidden>
      <span class="continue-card__icon">${icon('book')}</span>
      <span class="continue-card__text">
        <strong>Continuar última história</strong>
        <small id="continue-story-label"></small>
      </span>
      <button class="button button--primary" type="button" data-action="continue-latest">Continuar</button>
    </div>

    <h2 class="section-title">O que você quer fazer?</h2>
    <p class="section-hint">Escolha uma das opções abaixo.</p>

    <div class="menu-grid">
      <a class="menu-tile menu-tile--library" href="#/library">
        <span class="menu-tile__icon">${icon('library')}</span>
        <span class="menu-tile__text">
          <strong>Biblioteca</strong>
          <small>Ver suas criações</small>
        </span>
        ${icon('chevron-right', { className: 'icon--chevron' })}
      </a>

      <a class="menu-tile menu-tile--stories" href="#/reader">
        <span class="menu-tile__icon">${icon('headphones')}</span>
        <span class="menu-tile__text">
          <strong>Histórias para ouvir</strong>
          <small>Prévia do livro</small>
        </span>
        ${icon('chevron-right', { className: 'icon--chevron' })}
      </a>

      <a class="menu-tile menu-tile--backups" href="#/backups">
        <span class="menu-tile__icon">${icon('shield')}</span>
        <span class="menu-tile__text">
          <strong>Backups</strong>
          <small>Exportar e importar</small>
        </span>
        ${icon('chevron-right', { className: 'icon--chevron' })}
      </a>

      <a class="menu-tile menu-tile--new" href="#/new-story">
        <span class="menu-tile__icon">${icon('plus')}</span>
        <span class="menu-tile__text">
          <strong>Nova história</strong>
          <small>Começar do zero</small>
        </span>
        ${icon('chevron-right', { className: 'icon--chevron' })}
      </a>
    </div>

    <div class="notice notice--info">
      ${icon('info')}
      <p><strong>Já disponível.</strong> Telas, navegação, desenho, salvamento automático, biblioteca e narração por página: grave a voz original da criança, guarde o áudio neste dispositivo e reproduza depois. Quadrinhos e backups ainda ficam para as próximas etapas.</p>
    </div>
  </section>`;
}

export function mount(root, context) {
  const epoch = ++homeEpoch;
  activeRoot = root;
  latestStory = null;

  const card = root.querySelector('#continue-card');
  if (card) card.hidden = true;

  clickHandler = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-action="continue-latest"]');
    if (!button || !activeRoot?.contains(button) || !latestStory) return;

    const chosen = latestStory;
    const result = await openStory(chosen.id, context);
    if (!result.ok && activeRoot && getState().currentRoute === 'home') {
      latestStory = null;
      const current = activeRoot.querySelector('#continue-card');
      if (current) current.hidden = true;
    }
  };
  root.addEventListener('click', clickHandler);

  void loadLibrary().then((result) => {
    if (epoch !== homeEpoch || getState().currentRoute !== 'home') return;
    if (result.state !== LIBRARY_STATE.READY) return;

    latestStory = getLatestStory(result);
    const current = activeRoot?.querySelector('#continue-card');
    if (!current || !latestStory) return;

    const label = current.querySelector('#continue-story-label');
    if (label) label.textContent = `${latestStory.title} · ${latestStory.updatedLabel}`;
    current.hidden = false;
  });
}

export function unmount() {
  homeEpoch += 1;
  if (activeRoot && clickHandler) activeRoot.removeEventListener('click', clickHandler);
  activeRoot = null;
  clickHandler = null;
  latestStory = null;
}
