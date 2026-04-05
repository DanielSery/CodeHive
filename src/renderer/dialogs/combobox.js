import { fuzzyMatch, fuzzyScore } from './utils.js';

/**
 * Creates a reusable combobox controller for filtered dropdown lists.
 *
 * @param {Object} config
 * @param {HTMLInputElement} config.inputEl - The search input element
 * @param {HTMLElement}      config.listEl  - The dropdown list container
 * @param {string}          [config.arrowSelector] - CSS selector for the arrow toggle button
 * @param {Function}        [config.onHide]   - Called when Escape is pressed
 * @param {Function}        [config.onSelect] - Called with (item) when an item is selected
 * @param {Function}        [config.onInput]  - Called after each input event (after render)
 * @param {Function}        [config.onBlur]   - Called inside the blur timeout, after list closes
 * @param {Function}        [config.getLabel]    - Returns the searchable text for an item (default: identity)
 * @param {Function}        [config.isSelected]  - Returns true if the item is currently selected
 * @param {Function}        [config.renderItemContent] - Custom item renderer: (el, item) => void
 * @param {boolean}         [config.dashForSpace]  - Convert space key to dash in input
 * @param {Function}        [config.onEnterNoMatch] - Called on Enter when no highlight matches
 * @param {Function}        [config.onEnterMatch]   - Called with (item) on Enter when highlighted; defaults to onSelect + focus next
 * @param {boolean}         [config.openOnFocus]     - Whether to open the list on focus (default: true)
 */
export function createCombobox(config) {
  const {
    inputEl, listEl, arrowSelector,
    onHide, onSelect, onInput, onBlur,
    getLabel = (item) => item,
    isSelected = () => false,
    renderItemContent,
    dashForSpace = false,
    onEnterNoMatch,
    onEnterMatch,
    openOnFocus = true,
    prioritizeFn,
  } = config;

  let items = [];
  let highlightIndex = -1;

  function sortItems(arr, q) {
    return arr.sort((a, b) => {
      if (prioritizeFn) {
        const pA = prioritizeFn(a) ? 1 : 0;
        const pB = prioritizeFn(b) ? 1 : 0;
        if (pA !== pB) return pB - pA;
      }
      return fuzzyScore(getLabel(b), q) - fuzzyScore(getLabel(a), q);
    });
  }

  function getFiltered(filter) {
    const q = (typeof filter === 'string' ? filter : inputEl.value || '').toLowerCase();
    return sortItems(items.filter(item => fuzzyMatch(getLabel(item), q)), q);
  }

  function render(filter) {
    listEl.innerHTML = '';
    const q = (typeof filter === 'string' ? filter : inputEl.value || '').toLowerCase();
    const filtered = sortItems(items.filter(item => fuzzyMatch(getLabel(item), q)), q);

    if (filtered.length === 0) {
      listEl.classList.remove('open');
      highlightIndex = -1;
      return filtered;
    }

    filtered.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'combobox-item';
      if (isSelected(item)) el.classList.add('selected');
      if (i === highlightIndex) el.classList.add('highlighted');

      if (renderItemContent) {
        renderItemContent(el, item);
      } else {
        el.textContent = getLabel(item);
      }

      el.addEventListener('mousedown', (e) => { e.preventDefault(); select(item); });
      listEl.appendChild(el);
    });

    listEl.classList.add('open');
    return filtered;
  }

  function select(item) {
    highlightIndex = -1;
    listEl.classList.remove('open');
    if (onSelect) onSelect(item);
  }

  function scrollHighlighted() {
    const el = listEl.querySelector('.highlighted');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    listEl.classList.remove('open');
    highlightIndex = -1;
  }

  // --- Event listeners ---

  inputEl.addEventListener('input', () => {
    highlightIndex = inputEl.value.trim() ? 0 : -1;
    render(inputEl.value);
    if (onInput) onInput();
  });

  inputEl.addEventListener('focus', () => {
    inputEl.select();
    if (openOnFocus) {
      highlightIndex = -1;
      render(inputEl.value);
    }
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      listEl.classList.remove('open');
      if (onBlur) onBlur();
    }, 200);
  });

  if (arrowSelector) {
    const arrowEl = document.querySelector(arrowSelector);
    if (arrowEl) {
      arrowEl.addEventListener('mousedown', (e) => e.preventDefault());
      arrowEl.addEventListener('click', () => {
        if (listEl.classList.contains('open')) {
          listEl.classList.remove('open');
        } else {
          inputEl.value = '';
          highlightIndex = -1;
          render('');
          inputEl.focus();
        }
      });
    }
  }

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (onHide) onHide(); return; }

    if (dashForSpace && e.key === ' ') {
      e.preventDefault();
      const s = inputEl.selectionStart, end = inputEl.selectionEnd;
      inputEl.value = inputEl.value.substring(0, s) + '-' + inputEl.value.substring(end);
      inputEl.selectionStart = inputEl.selectionEnd = s + 1;
      inputEl.dispatchEvent(new Event('input'));
      return;
    }

    const filtered = getFiltered();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
      render(inputEl.value);
      scrollHighlighted();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      render(inputEl.value);
      scrollHighlighted();
    } else if (e.key === 'Enter') {
      if (highlightIndex >= 0 && highlightIndex < filtered.length) {
        e.preventDefault();
        if (onEnterMatch) onEnterMatch(filtered[highlightIndex]);
        else select(filtered[highlightIndex]);
      } else if (onEnterNoMatch) {
        e.preventDefault();
        onEnterNoMatch();
      }
    }
  });

  return {
    /** Replace the full item list */
    setItems(newItems) { items = newItems; },
    /** Get the current item list */
    getItems() { return items; },
    /** Re-render the dropdown with optional filter string */
    render,
    /** Get filtered items without rendering */
    getFiltered,
    /** Close the dropdown */
    close,
    /** Programmatically select an item */
    select,
    /** Get current highlight index */
    get highlightIndex() { return highlightIndex; },
    /** Set current highlight index */
    set highlightIndex(i) { highlightIndex = i; },
  };
}
