import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveInvitationLink, LIVE_INVITATION_HASH_PREFIX, MAX_LIVE_INVITATION_LINK_LENGTH, parseLiveInvitationLink
} from '../src/collaboration/invitation-link.js';

const invitation = `tisd1.${'I'.repeat(160)}`;
const offerCapsule = `tisc1.${'O'.repeat(420)}`;

test('the owner share URL contains both invite and short-lived offer only in its fragment', () => {
  const link = createLiveInvitationLink('https://app.example/tiny-image-star/?theme=dark#old', invitation, offerCapsule);
  const url = new URL(link);
  assert.equal(url.search, '?theme=dark');
  assert.ok(url.hash.startsWith(LIVE_INVITATION_HASH_PREFIX));
  assert.equal(url.href.includes(invitation), true);
  assert.equal(url.href.includes(offerCapsule), true);
  assert.deepEqual(parseLiveInvitationLink(link), { invitation, offerCapsule });
});

test('invite links fail closed for unsafe, incomplete, or oversized values', () => {
  assert.throws(() => createLiveInvitationLink('javascript:alert(1)', invitation, offerCapsule), /web address/u);
  assert.throws(() => createLiveInvitationLink('https://app.example/', 'tisd1.bad/value', offerCapsule), /invitation/u);
  assert.throws(() => createLiveInvitationLink('https://app.example/', invitation, 'tisc1.bad/value'), /offer/u);
  assert.throws(() => createLiveInvitationLink('https://app.example/', invitation, offerCapsule, { maxLength: 20 }), /too large/u);
  assert.throws(() => parseLiveInvitationLink('https://app.example/#tisd1.only-stable-design'), /does not contain/u);
  assert.throws(() => parseLiveInvitationLink('https://app.example/#tisjoin1.tisd1.invite'), /incomplete/u);
  assert.ok(MAX_LIVE_INVITATION_LINK_LENGTH >= 8_192);
});
