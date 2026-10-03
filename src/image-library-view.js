/**
 * Searchable, paginated view for the document's original-image library.
 * The module owns only this view; persistence, file selection and editor actions
 * stay with the caller through callbacks.
 */

export const IMAGE_LIBRARY_PAGE_SIZE = 100;

const MAX_PAGE_SIZE = 100;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function normalizedSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase();
}

function entriesFor(documentData) {
  return Array.isArray(documentData?.imageLibrary) ? documentData.imageLibrary : [];
}

function normalizePageSize(value) {
  const requested = Number.isFinite(value) ? Math.floor(value) : IMAGE_LIBRARY_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, requested));
}

/**
 * Return a bounded page from the manifest, with an accent-insensitive search
 * across file name, MIME type and dimensions. The page never contains more
 * than 100 entries, even if the caller requests a larger size.
 */
export function getImageLibraryPage(documentData, { query = '', page = 0, pageSize = IMAGE_LIBRARY_PAGE_SIZE } = {}) {
  const source = entriesFor(documentData);
  const search = normalizedSearchText(String(query ?? '').trim());
  const matching = search
    ? source.filter(entry => {
      if (!entry || typeof entry !== 'object') return false;
      const searchable = `${entry.name || ''} ${entry.type || ''} ${entry.width || ''} ${entry.height || ''}`;
      return normalizedSearchText(searchable).includes(search);
    })
    : source.filter(entry => entry && typeof entry === 'object');
  const size = normalizePageSize(pageSize);
  const totalEntries = matching.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / size));
  const currentPage = Math.max(0, Math.min(totalPages - 1, Number.isFinite(page) ? Math.floor(page) : 0));
  const start = totalEntries ? currentPage * size : 0;
  const entries = matching.slice(start, start + size).map(entry => ({
    assetId: String(entry.assetId ?? ''),
    name: String(entry.name ?? 'Untitled image'),
    type: String(entry.type ?? ''),
    width: Number(entry.width) || 0,
    height: Number(entry.height) || 0
  }));
  return {
    entries,
    totalEntries,
    totalPages,
    page: currentPage,
    pageSize: size,
    start: totalEntries ? start + 1 : 0,
    end: Math.min(totalEntries, start + entries.length)
  };
}

function entryMarkup(entry, pending) {
  const assetId = escapeHtml(entry.assetId);
  const name = escapeHtml(entry.name);
  const type = escapeHtml(entry.type || 'Image');
  const dimensions = entry.width > 0 && entry.height > 0
    ? `${entry.width} × ${entry.height}`
    : 'Original image';
  return `<li class="image-library-item" data-image-library-item="${assetId}">
    <article class="image-library-card">
      <div class="image-library-thumb" data-image-library-thumb="${assetId}" aria-hidden="true">
        <span class="image-library-thumb-fallback">▧</span>
        <img data-image-library-thumbnail="${assetId}" alt="" loading="lazy" decoding="async" />
      </div>
      <div class="image-library-copy">
        <strong class="image-library-name" title="${name}">${name}</strong>
        <small>${type} · ${escapeHtml(dimensions)}</small>
      </div>
      <div class="image-library-actions">
        <button type="button" class="image-library-place" data-image-library-action="place" data-asset-id="${assetId}" aria-label="Place ${name}" title="Place ${name}"${pending ? ' disabled' : ''}><span aria-hidden="true">＋</span><span class="sr-only">Place</span></button>
        <button type="button" class="image-library-remove" data-image-library-action="remove" data-asset-id="${assetId}" aria-label="Remove ${name} from image library" title="Remove ${name} from image library"${pending ? ' disabled' : ''}><span aria-hidden="true">×</span><span class="sr-only">Remove</span></button>
      </div>
    </article>
  </li>`;
}

/** Render an accessible, bounded markup snapshot; useful to host in a panel. */
export function renderImageLibraryMarkup(documentData, options = {}) {
  const query = String(options.query ?? '');
  const page = getImageLibraryPage(documentData, {
    query,
    page: options.page,
    pageSize: options.pageSize
  });
  const pageLabel = `Page ${page.page + 1} of ${page.totalPages}`;
  const statusLabel = options.message || (page.totalEntries
    ? `Showing ${page.start}–${page.end} of ${page.totalEntries} images`
    : (query.trim() ? 'No search results' : 'No saved images'));
  const showStatus = Boolean(options.message) || page.totalEntries > 0;
  const showSearch = page.totalEntries > 0 || Boolean(query.trim());
  const emptyTitle = query.trim() ? 'No matching images' : 'No images saved yet';
  const emptyDetail = query.trim()
    ? 'Try another name, file type or image size.'
    : 'Add originals here to reuse them on any page in this design.';
  return `<section class="image-library-view" data-image-library-view aria-label="Original image library">
    <header class="image-library-heading">
      <div class="image-library-heading-copy"><strong>Reusable images</strong><small>Original files for this design</small></div>
      <button type="button" class="image-library-add" data-image-library-action="add"${options.pending ? ' disabled' : ''}>＋ Add sources</button>
    </header>
    ${showSearch ? `<label class="image-library-search-label sr-only" for="image-library-search">Search reusable images</label>
    <input id="image-library-search" class="image-library-search" type="search" data-image-library-search value="${escapeHtml(query)}" placeholder="Search reusable images" autocomplete="off" />` : ''}
    <p class="image-library-status${showStatus ? '' : ' sr-only'}" data-image-library-status aria-live="polite" aria-atomic="true">${escapeHtml(statusLabel)}</p>
    ${page.entries.length
      ? `<ul class="image-library-list" aria-label="Images in this design">${page.entries.map(entry => entryMarkup(entry, Boolean(options.pending))).join('')}</ul>`
      : `<div class="image-library-empty" data-image-library-empty><span class="image-library-empty-icon" aria-hidden="true">▧</span><span class="image-library-empty-copy"><strong>${escapeHtml(emptyTitle)}</strong><small>${escapeHtml(emptyDetail)}</small></span></div>`}
    ${page.totalPages > 1 ? `<nav class="image-library-pagination" aria-label="Image library pages">
      <button type="button" data-image-library-page="previous" aria-label="Previous image library page"${page.page <= 0 ? ' disabled' : ''}>Previous</button>
      <span data-image-library-page-label>${pageLabel}</span>
      <button type="button" data-image-library-page="next" aria-label="Next image library page"${page.page + 1 >= page.totalPages ? ' disabled' : ''}>Next</button>
    </nav>` : ''}
  </section>`;
}

function safeThumbnailUrl(value) {
  if (typeof value !== 'string' || value.length > 32_768) return '';
  if (/^blob:/iu.test(value)) return value;
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/iu.test(value)) return value;
  return '';
}

/**
 * Mount the view and delegate actions to the host editor.
 *
 * `onAdd()` opens the host's local image picker/import flow. `onPlace(assetId,
 * entry)` places a fresh node from that original source. `onRemove(assetId,
 * entry)` removes only the manifest item; the host decides how to persist it.
 * Each callback may return a promise and may throw to show an accessible error.
 */
export function mountImageLibraryView(container, {
  documentData,
  onAdd = () => {},
  onPlace = () => {},
  onRemove = () => {},
  getThumbnail = () => '',
  pageSize = IMAGE_LIBRARY_PAGE_SIZE
} = {}) {
  if (!container || typeof container.addEventListener !== 'function') {
    throw new TypeError('An image-library host element is required.');
  }
  if (typeof onAdd !== 'function' || typeof onPlace !== 'function' || typeof onRemove !== 'function') {
    throw new TypeError('Image-library callbacks must be functions.');
  }
  if (typeof getThumbnail !== 'function') throw new TypeError('The thumbnail resolver must be a function.');

  const state = { documentData, query: '', page: 0, message: '', pending: false, destroyed: false, renderRevision: 0 };
  const boundedPageSize = normalizePageSize(pageSize);

  function render({ restoreSearchFocus = false, searchSelection = null } = {}) {
    if (state.destroyed) return;
    const page = getImageLibraryPage(state.documentData, { query: state.query, page: state.page, pageSize: boundedPageSize });
    state.page = page.page;
    const renderRevision = ++state.renderRevision;
    container.innerHTML = renderImageLibraryMarkup(state.documentData, {
      query: state.query,
      page: state.page,
      pageSize: boundedPageSize,
      message: state.message,
      pending: state.pending
    });
    for (const image of container.querySelectorAll?.('[data-image-library-thumbnail]') || []) {
      const assetId = image.getAttribute('data-image-library-thumbnail');
      const entry = page.entries.find(candidate => candidate.assetId === assetId);
      if (!entry) continue;
      const publish = value => {
        if (state.destroyed || state.renderRevision !== renderRevision || image.isConnected === false) return;
        const source = safeThumbnailUrl(value);
        if (!source) return;
        image.addEventListener('error', () => {
          image.hidden = true;
          image.closest('.image-library-thumb')?.classList.remove('has-image');
        }, { once: true });
        image.closest('.image-library-thumb')?.classList.add('has-image');
        image.src = source;
      };
      try {
        const source = getThumbnail(entry);
        if (source && typeof source.then === 'function') void source.then(publish).catch(() => {});
        else publish(source);
      } catch { /* A missing thumbnail leaves the accessible fallback visible. */ }
    }
    if (restoreSearchFocus) {
      const search = container.querySelector?.('[data-image-library-search]');
      search?.focus();
      if (searchSelection && typeof search?.setSelectionRange === 'function') {
        search.setSelectionRange(searchSelection.start, searchSelection.end);
      }
    }
  }

  async function invoke(action, assetId = '') {
    if (state.pending || state.destroyed) return;
    const entry = entriesFor(state.documentData).find(candidate => candidate?.assetId === assetId);
    if (action !== 'add' && !entry) {
      state.message = 'That image is no longer in this library. Refresh the panel and try again.';
      render();
      return;
    }
    state.message = '';
    const callback = action === 'add' ? onAdd : action === 'place' ? onPlace : onRemove;
    try {
      const result = action === 'add' ? callback() : callback(assetId, { ...entry });
      if (result && typeof result.then === 'function') {
        state.pending = true;
        render();
        await result;
      }
      if (action === 'remove') state.page = Math.max(0, state.page);
    } catch (error) {
      state.message = error?.message || 'Could not update the image library.';
    } finally {
      state.pending = false;
      render();
    }
  }

  function handleClick(event) {
    const target = event.target?.closest?.('[data-image-library-action], [data-image-library-page]');
    if (!target || (typeof container.contains === 'function' && !container.contains(target)) || target.disabled) return;
    if (target.hasAttribute?.('data-image-library-action')) {
      const action = target.getAttribute('data-image-library-action');
      if (action === 'add') void invoke('add');
      else if (action === 'place' || action === 'remove') void invoke(action, target.getAttribute('data-asset-id') || '');
      return;
    }
    const direction = target.getAttribute('data-image-library-page');
    state.page += direction === 'next' ? 1 : direction === 'previous' ? -1 : 0;
    state.message = '';
    render();
  }

  function handleInput(event) {
    const input = event.target;
    if (!input?.matches?.('[data-image-library-search]')) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    state.query = input.value;
    state.page = 0;
    state.message = '';
    render({ restoreSearchFocus: true, searchSelection: { start, end } });
  }

  container.addEventListener('click', handleClick);
  container.addEventListener('input', handleInput);
  render();

  return {
    refresh(nextDocumentData = state.documentData) {
      state.documentData = nextDocumentData;
      state.message = '';
      render();
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      container.removeEventListener?.('click', handleClick);
      container.removeEventListener?.('input', handleInput);
      container.replaceChildren?.();
    }
  };
}
