import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getImageLibraryPage,
  IMAGE_LIBRARY_PAGE_SIZE,
  renderImageLibraryMarkup,
  mountImageLibraryView
} from '../src/image-library-view.js';

function makeImages(count) {
  return Array.from({ length: count }, (_, index) => ({
    assetId: `asset-${index}`,
    name: `Photo ${String(index).padStart(3, '0')}.png`,
    type: 'image/png',
    width: 2400,
    height: 1600
  }));
}

test('image library view pages large manifests and clamps page size to 100', () => {
  const documentData = { imageLibrary: makeImages(10_001) };
  const firstPage = getImageLibraryPage(documentData, { pageSize: 500 });
  assert.equal(firstPage.entries.length, IMAGE_LIBRARY_PAGE_SIZE);
  assert.equal(firstPage.totalEntries, 10_001);
  assert.equal(firstPage.totalPages, 101);
  assert.equal(firstPage.entries[0].assetId, 'asset-0');

  const lastPage = getImageLibraryPage(documentData, { page: 100, pageSize: 100 });
  assert.equal(lastPage.entries.length, 1);
  assert.equal(lastPage.start, 10_001);
  assert.equal(lastPage.end, 10_001);
  assert.equal(lastPage.entries[0].assetId, 'asset-10000');

  const markup = renderImageLibraryMarkup(documentData, { pageSize: 1000 });
  assert.equal((markup.match(/data-image-library-item=/gu) || []).length, 100);
  assert.match(markup, /Showing 1–100 of 10001 images/u);
});

test('search matches names, MIME types and dimensions without accent sensitivity', () => {
  const documentData = {
    imageLibrary: [
      { assetId: 'cafe', name: 'Café portrait.tif', type: 'image/tiff', width: 1200, height: 1600 },
      { assetId: 'wide', name: 'banner.png', type: 'image/png', width: 2400, height: 600 },
      { assetId: 'webp', name: 'compact.webp', type: 'image/webp', width: 320, height: 240 }
    ]
  };
  assert.deepEqual(getImageLibraryPage(documentData, { query: 'cafe' }).entries.map(entry => entry.assetId), ['cafe']);
  assert.deepEqual(getImageLibraryPage(documentData, { query: 'image/png' }).entries.map(entry => entry.assetId), ['wide']);
  assert.deepEqual(getImageLibraryPage(documentData, { query: '1600' }).entries.map(entry => entry.assetId), ['cafe']);
});

test('search and page markup is escaped and exposes accessible source actions', () => {
  const documentData = {
    imageLibrary: [{
      assetId: 'asset-<unsafe>',
      name: 'A <portrait> & "poster"',
      type: 'image/jpeg',
      width: 320,
      height: 240
    }]
  };
  const markup = renderImageLibraryMarkup(documentData, { query: 'A <portrait>' });
  assert.match(markup, /value="A &lt;portrait&gt;"/u);
  assert.match(markup, /data-asset-id="asset-&lt;unsafe&gt;"/u);
  assert.match(markup, /aria-label="Place A &lt;portrait&gt; &amp; &quot;poster&quot;"/u);
  assert.match(markup, /aria-label="Remove A &lt;portrait&gt; &amp; &quot;poster&quot; from image library"/u);
  assert.match(markup, /class="image-library-place"[\s\S]*?title="Place A &lt;portrait&gt; &amp; &quot;poster&quot;"[\s\S]*?<span aria-hidden="true">＋<\/span><span class="sr-only">Place<\/span>/u,
    'the compact place action should have a visible icon, hover title, and full accessible name');
  assert.match(markup, /class="image-library-remove"[\s\S]*?title="Remove A &lt;portrait&gt; &amp; &quot;poster&quot; from image library"[\s\S]*?<span aria-hidden="true">×<\/span><span class="sr-only">Remove<\/span>/u,
    'the compact remove action should retain a visible icon, hover title, and full accessible name');
  assert.doesNotMatch(markup, /<script/iu);
  assert.match(markup, /aria-live="polite"/u);
  assert.match(markup, /class="image-library-search-label sr-only"[^>]*>Search reusable images/u);
  assert.match(markup, /data-image-library-action="add"/u);
  assert.doesNotMatch(markup, /data-image-library-page=/u);
});

test('an empty library and an unmatched search have clear, distinct states', () => {
  const emptyLibrary = renderImageLibraryMarkup({});
  assert.match(emptyLibrary, /class="image-library-empty"[^>]*>[\s\S]*?<strong>No images saved yet<\/strong>/u);
  assert.match(emptyLibrary, /<small>Add originals here to reuse them on any page in this design\.<\/small>/u);
  assert.match(emptyLibrary, /<p class="image-library-status sr-only" data-image-library-status/u);
  assert.doesNotMatch(emptyLibrary, /data-image-library-search/u);
  assert.doesNotMatch(emptyLibrary, /data-image-library-page=/u);

  const unmatchedSearch = renderImageLibraryMarkup({ imageLibrary: makeImages(1) }, { query: 'missing' });
  assert.match(unmatchedSearch, /No matching images/u);
  assert.match(unmatchedSearch, /Try another name, file type or image size\./u);
  assert.match(unmatchedSearch, /data-image-library-status[^>]*>No search results/u);
});

test('pagination appears only when the filtered library has more than one page', () => {
  const markup = renderImageLibraryMarkup({ imageLibrary: makeImages(101) });
  assert.match(markup, /data-image-library-page="previous"/u);
  assert.match(markup, /data-image-library-page="next"/u);
  assert.match(markup, /Page 1 of 2/u);
});

test('mount delegates add, place and remove with detached manifest entries and supports refresh/destroy', async () => {
  const listeners = new Map();
  const container = {
    innerHTML: '',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    querySelectorAll() { return []; },
    contains() { return true; },
    replaceChildren() { this.innerHTML = ''; }
  };
  const documentData = { imageLibrary: [makeImages(1)[0]] };
  const calls = [];
  const view = mountImageLibraryView(container, {
    documentData,
    onAdd: () => calls.push(['add']),
    onPlace: (assetId, entry) => calls.push(['place', assetId, entry]),
    onRemove: (assetId, entry) => calls.push(['remove', assetId, entry])
  });
  const entry = documentData.imageLibrary[0];
  const invokeAction = action => listeners.get('click')({
    target: {
      disabled: false,
      getAttribute(name) {
        if (name === 'data-image-library-action') return action;
        if (name === 'data-asset-id') return entry.assetId;
        return null;
      },
      hasAttribute(name) { return name === 'data-image-library-action'; },
      closest() { return this; }
    }
  });

  invokeAction('add');
  invokeAction('place');
  invokeAction('remove');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call[0]), ['add', 'place', 'remove']);
  assert.equal(calls[1][1], entry.assetId);
  assert.deepEqual(calls[1][2], entry);
  assert.notEqual(calls[1][2], entry);
  assert.equal(calls[2][1], entry.assetId);

  const revised = { imageLibrary: makeImages(2) };
  view.refresh(revised);
  assert.match(container.innerHTML, /Photo 001\.png/u);
  view.destroy();
  assert.equal(container.innerHTML, '');
  assert.equal(listeners.size, 0);
});

test('failed async host actions are reported in the live status and do not strand the view', async () => {
  const listeners = new Map();
  const container = {
    innerHTML: '',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    querySelectorAll() { return []; },
    contains() { return true; }
  };
  const view = mountImageLibraryView(container, {
    documentData: { imageLibrary: makeImages(1) },
    onPlace: async () => { throw new Error('Original image is no longer available.'); }
  });
  listeners.get('click')({
    target: {
      disabled: false,
      getAttribute(name) { return name === 'data-image-library-action' ? 'place' : 'asset-0'; },
      hasAttribute(name) { return name === 'data-image-library-action'; },
      closest() { return this; }
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(container.innerHTML, /Original image is no longer available\./u);
  view.destroy();
});

test('asynchronously loaded thumbnails publish only while their library render is current', async () => {
  const listeners = new Map();
  const thumbnailRequests = [];
  const thumbnail = {
    src: '',
    hidden: false,
    isConnected: true,
    getAttribute(name) { return name === 'data-image-library-thumbnail' ? 'asset-0' : null; },
    addEventListener() {},
    closest() { return { classList: { add() {}, remove() {} } }; }
  };
  const container = {
    innerHTML: '',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    querySelectorAll() { return [thumbnail]; },
    contains() { return true; },
    replaceChildren() { this.innerHTML = ''; }
  };
  const view = mountImageLibraryView(container, {
    documentData: { imageLibrary: [makeImages(1)[0]] },
    getThumbnail: () => new Promise(resolve => thumbnailRequests.push(resolve))
  });
  view.refresh({ imageLibrary: makeImages(1) });
  thumbnailRequests[0]('blob:late-thumbnail');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(thumbnail.src, '', 'a stale asynchronous result cannot overwrite a newer library render');
  thumbnailRequests[1]('blob:current-thumbnail');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(thumbnail.src, 'blob:current-thumbnail');
  view.destroy();
});
