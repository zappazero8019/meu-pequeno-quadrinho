import { icon } from '../app/utils.js';

export const title = 'Início';

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
        <p class="hero-note">Primeira versão: estrutura e identidade visual. Nada é salvo ainda.</p>
      </div>
      <div class="hero-card__art">
        <img
          class="hero-illustration"
          src="./assets/illustrations/home-hero.svg"
          alt="Ilustração de duas páginas de quadrinhos, estrelas e um lápis sorridente"
        >
      </div>
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
      <p><strong>Fase 1.</strong> As telas e a navegação estão prontas. Desenho, áudio e salvamento de histórias ainda não estão implementados.</p>
    </div>
  </section>`;
}
