import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLiveReplyMessage, formatLiveShareMessage, parseLiveReplyMessage, parseLiveShareMessage } from '../src/collaboration/share-message.js';

const invitation = 'https://appunni-m.github.io/tiny-image-star/#tisd1.invite_token';
const code = `tisc1.${'a'.repeat(128)}`;

test('a single friendly invite message round-trips as one link and one short-lived code', () => {
  const message = formatLiveShareMessage(invitation, code);
  assert.match(message, /Join my Tiny Image Star design/);
  assert.match(message, /expires in about 5 minutes/);
  assert.deepEqual(parseLiveShareMessage(message), { invitation, sessionCode: code });
});

test('the guest can paste the whole message or a standalone stable invitation link', () => {
  assert.deepEqual(parseLiveShareMessage(`Please join: ${invitation}.`), { invitation, sessionCode: '' });
  assert.deepEqual(parseLiveShareMessage(`tisd1.invite_token\n${code}`), { invitation: 'tisd1.invite_token', sessionCode: code });
});

test('the owner can paste a whole phone-shared reply or the raw code', () => {
  const message = formatLiveReplyMessage(code);
  assert.match(message, /Paste this whole reply in the owner’s Tiny Image Star window/);
  assert.equal(parseLiveReplyMessage(message), code);
  assert.equal(parseLiveReplyMessage(code), code);
  assert.throws(() => parseLiveReplyMessage(`${code}\n${code.replace(/a/g, 'b')}`), /more than one reply/);
});

test('ambiguous or incomplete invitations get a clear bounded error', () => {
  assert.throws(() => parseLiveShareMessage(`${invitation}\n${code}\n${code.replace(/a/g, 'b')}`), /more than one connection code/);
  assert.throws(() => parseLiveShareMessage(code), /no design invite/);
  assert.throws(() => parseLiveShareMessage('x'.repeat(100_001)), /too large/);
  assert.throws(() => formatLiveShareMessage(invitation, 'not-a-code'), /fresh connection code/);
});
