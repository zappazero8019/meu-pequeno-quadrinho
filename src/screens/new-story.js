import { createDraft } from '../app/state.js';
import { icon } from '../app/utils.js';

const LIMITS = { title: 60, author: 40 };

export const title = 'Nova história';

export function render() {
  return `
  <section class="screen screen--new-story" aria-labelledby="new-story-title">
    <header class="screen-header">
      <div>
        <p class="eyebrow">Novo começo</p>
        <h1 id="new-story-title">Conte sua história</h1>
        <p class="screen-subtitle">Só precisamos de duas informações para começar.</p>
      </div>
      <button class="icon-button" type="button" data-action="back" aria-label="Voltar à tela anterior">
        ${icon('arrow-left')}
      </button>
    </header>

    <form class="card form-card" id="new-story-form" novalidate>
      <div class="form-error-summary" id="form-error-summary" role="alert" hidden>
        Confira os campos destacados antes de continuar.
      </div>

      <div class="form-field">
        <label for="story-title">Título da história</label>
        <input
          class="input"
          id="story-title"
          name="title"
          type="text"
          maxlength="${LIMITS.title}"
          placeholder="Ex.: A aventura do lápis"
          autocomplete="off"
          aria-describedby="title-error title-count"
          required
        >
        <div class="field-meta">
          <span class="field-error" id="title-error" aria-live="polite"></span>
          <span id="title-count">0/${LIMITS.title}</span>
        </div>
      </div>

      <div class="form-field">
        <label for="story-author">Nome do autor</label>
        <input
          class="input"
          id="story-author"
          name="author"
          type="text"
          maxlength="${LIMITS.author}"
          placeholder="Quem está contando?"
          autocomplete="off"
          aria-describedby="author-error author-count"
          required
        >
        <div class="field-meta">
          <span class="field-error" id="author-error" aria-live="polite"></span>
          <span id="author-count">0/${LIMITS.author}</span>
        </div>
      </div>

      <div class="button-row">
        <button class="button button--secondary" type="button" data-action="back">Voltar</button>
        <button class="button button--primary" type="submit">${icon('sparkles')} Começar</button>
      </div>

      <p class="hint">Nesta fase, título e autor ficam apenas na memória da página. Nada é salvo.</p>
    </form>
  </section>`;
}

function validate({ title, author }) {
  const errors = {};

  if (!title) errors.title = 'Dê um título para a sua história.';
  else if (title.length < 3) errors.title = 'Use pelo menos 3 letras no título.';

  if (!author) errors.author = 'Escreva o nome do autor.';
  else if (author.length < 2) errors.author = 'Use pelo menos 2 letras no nome.';

  return errors;
}

export function mount(root, context) {
  const form = root.querySelector('#new-story-form');
  const summary = root.querySelector('#form-error-summary');
  const inputs = {
    title: root.querySelector('#story-title'),
    author: root.querySelector('#story-author')
  };
  const errorNodes = {
    title: root.querySelector('#title-error'),
    author: root.querySelector('#author-error')
  };
  const counters = {
    title: root.querySelector('#title-count'),
    author: root.querySelector('#author-count')
  };

  root.querySelectorAll('[data-action="back"]').forEach((button) => {
    button.addEventListener('click', context.goBack);
  });

  function clearError(field) {
    errorNodes[field].textContent = '';
    inputs[field].removeAttribute('aria-invalid');
  }

  function updateCounter(field) {
    counters[field].textContent = `${inputs[field].value.length}/${LIMITS[field]}`;
  }

  Object.keys(inputs).forEach((field) => {
    inputs[field].addEventListener('input', () => {
      clearError(field);
      updateCounter(field);
      if (errorNodes.title.textContent || errorNodes.author.textContent) return;
      summary.hidden = true;
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const values = {
      title: inputs.title.value.trim(),
      author: inputs.author.value.trim()
    };
    const errors = validate(values);
    let firstInvalid = null;

    Object.keys(errors).forEach((field) => {
      errorNodes[field].textContent = errors[field];
      inputs[field].setAttribute('aria-invalid', 'true');
      if (!firstInvalid) firstInvalid = inputs[field];
    });

    Object.keys(inputs).forEach((field) => {
      if (!errors[field]) clearError(field);
    });

    summary.hidden = Object.keys(errors).length === 0;

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    createDraft(values);
    context.navigate('editor');
  });
}
