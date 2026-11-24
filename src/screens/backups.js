import { icon } from '../app/utils.js';

export const title = 'Backups';

export function render() {
  return `
  <section class="screen screen--backups" aria-labelledby="backups-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Suas criações</p>
        <h1 id="backups-title">Backups</h1>
      </div>
      <button class="icon-button" type="button" data-action="back" aria-label="Voltar à tela anterior">
        ${icon('arrow-left')}
      </button>
    </header>

    <div class="hero-mini">
      ${icon('shield')}
      <div>
        <h2>Um lugar seguro para suas histórias</h2>
        <p>Aqui ficarão as opções de exportar, importar e proteger suas criações.</p>
      </div>
    </div>

    <div class="notice notice--warning">
      ${icon('info')}
      <p><strong>Fase 1.</strong> Nenhum arquivo é lido, criado ou salvo. Os botões abaixo estão desativados até a implementação.</p>
    </div>

    <div class="backup-list">
      <article class="backup-card">
        ${icon('export')}
        <div>
          <h3>Exportar histórias</h3>
          <p>Gerar um arquivo com as histórias criadas no aplicativo.</p>
        </div>
        <button class="mini-button" type="button" disabled>Em breve</button>
      </article>

      <article class="backup-card">
        ${icon('import')}
        <div>
          <h3>Importar backups</h3>
          <p>Trazer histórias de volta a partir de um arquivo de backup.</p>
        </div>
        <button class="mini-button" type="button" disabled>Em breve</button>
      </article>

      <article class="backup-card">
        ${icon('shield')}
        <div>
          <h3>Proteção das criações</h3>
          <p>Orientações para cuidar dos arquivos das suas histórias.</p>
        </div>
      </article>
    </div>

    <details class="info-card">
      <summary>Como a proteção funcionará?</summary>
      <p>A ideia é manter as histórias no dispositivo e permitir que você exporte cópias para guardar quando quiser.</p>
      <p>Nada disso está ativo agora: não há persistência nem manipulação de arquivos nesta fase.</p>
    </details>

    <a class="button button--secondary button--block" href="#/home">${icon('home')} Voltar ao início</a>
  </section>`;
}

export function mount(root, context) {
  root.querySelector('[data-action="back"]').addEventListener('click', context.goBack);
}
