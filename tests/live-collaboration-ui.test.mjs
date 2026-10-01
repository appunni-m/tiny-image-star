import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('live sharing distinguishes the stable invitation and offer and discloses channel-visible network details', () => {
  assert.match(html, /id="live-invite-value"/);
  assert.match(html, /id="live-offer-value"/);
  assert.match(html, /The channel you use can read both items, including network details in the offer/);
  assert.match(html, /The service carrying your answer can read its network details/);
});
