import { icon } from '../app/utils.js';

export const title = 'Biblioteca';

export function render() {
  return `
  <section class="screen screen--library" aria-labelledby="library-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Sua coleção</p>
        <h1 id="library-title">Biblioteca</h1>
        <p class="screen-subtitle">Aqui ficarão as histórias que você criar.</p>
      </div>
      <button class="icon-button" type="button" data-action="back" aria-label="Voltar à tela anterior">
        ${icon('arrow-left')}
      </button>
    </header>

    <div class="empty-state card">
      <img
        src="./assets/illustrations/empty-library.svg"
        alt="Estante de quadrinhos vazia com um ponto de interrogação"
      >
      <h2>Nenhuma aventura por aqui ainda</h2>
      <p>Ainda não existem histórias. Que tal criar sua primeira aventura?</p>
      <a class="button button--primary" href="#/new-story">${icon('plus')} Criar minha história</a>
    </div>

    <h2 class="section-title">Como ficará sua estante</h2>
    <p class="section-hint">Modelo visual apenas — não representa uma história salva.</p>

    <article class="story-card story-card--preview" aria-label="Modelo de cartão de história, ainda sem dados reais">
      <div class="story-card__cover">
        <img src="./assets/illustrations/preview-cover.svg" alt="Capa ilustrativa genérica">
        <span class="badge badge--preview">Prévia</span>
      </div>
      <div class="story-card__body">
        <span class="badge badge--soon">Em breve</span>
        <h3>Título da história</h3>
        <p>Nome do autor</p>
        <p>Atualizado em —</p>
      </div>
    </article>

    <div class="notice notice--info">
      ${icon('info')}
      <p>Quando a persistência for implementada, cada cartão mostrará capa, título, autor e data de atualização.</p>
    </div>
  </section>`;
}

export function mount(root, context) {
  root.querySelector('[data-action="back"]').addEventListener('click', context.goBack);
}
