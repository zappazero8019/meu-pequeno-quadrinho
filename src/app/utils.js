/** Pequenos utilitários compartilhados pelas telas. */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Escapa texto vindo de campos do formulário antes de inserir no HTML. */
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/**
 * Gera a marcação de um ícone SVG local.
 * Ícones decorativos recebem alt="" e aria-hidden="true".
 */
export function icon(name, { alt = '', className = '' } = {}) {
  if (!/^[a-z0-9-]+$/.test(name)) return '';
  return `<img src="./assets/icons/${name}.svg" alt="${escapeHtml(alt)}" class="icon ${className}" aria-hidden="${alt ? 'false' : 'true'}">`;
}
