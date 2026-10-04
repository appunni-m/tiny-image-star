import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('prototype navigation can edit and apply the destination scroll policy', () => {
  assert.match(main, /id="prototype-scroll-position"[\s\S]*?value="preserve"[\s\S]*?value="reset"/);
  assert.match(main, /scrollPosition: state\.prototypeAction === 'navigate'[\s\S]*?prototype-scroll-position/);
  assert.match(main, /event\.target\.id === 'prototype-scroll-position'[\s\S]*?state\.prototypeScrollPosition/);
  assert.match(main, /scrollPosition: state\.prototypeAction === 'navigate' \? state\.prototypeScrollPosition : 'preserve'/);
  assert.match(main, /interaction\.action === 'navigate' && result === 'navigated'[\s\S]*?prototypeScrollOffsetsForFrame/);
});
