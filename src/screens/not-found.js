import { icon } from '../app/utils.js';

export const title = 'Tela não encontrada';

export function render() {
  return `
  <section class="screen screen--not-found" aria-labelledby="not-found-title">
    <div class="empty-state card">
      <div class="prep-illustration">${icon('book')}</div>
      <h1 id="not-found-title">Essa página se perdeu!</h1>
      <p>Não encontramos a tela que você procura. Vamos voltar para um lugar conhecido?</p>
      <a class="button button--primary" href="#/home">${icon('home')} Voltar ao início</a>
    </div>
  </section>`;
}
