export const LIVE_INVITATION_HASH_PREFIX = '#tisjoin1.';
export const MAX_LIVE_INVITATION_LINK_LENGTH = 16_384;
const INVITATION_PATTERN = /^tisd1\.[A-Za-z0-9_-]+$/u;
const OFFER_PATTERN = /^tisc1\.[A-Za-z0-9_-]+$/u;

function validateParts(invitation, offerCapsule) {
  if (typeof invitation !== 'string' || !INVITATION_PATTERN.test(invitation)) {
    throw new TypeError('This invite link has an invalid design invitation.');
  }
  if (typeof offerCapsule !== 'string' || !OFFER_PATTERN.test(offerCapsule)) {
    throw new TypeError('This invite link has an invalid or missing connection offer.');
  }
}

/** Put the stable design capability and this guest's short-lived offer in the URL fragment. */
export function createLiveInvitationLink(baseUrl, invitation, offerCapsule, { maxLength = MAX_LIVE_INVITATION_LINK_LENGTH } = {}) {
  validateParts(invitation, offerCapsule);
  const url = new URL(String(baseUrl));
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Invite links need a Tiny Image Star web address.');
  url.hash = `${LIVE_INVITATION_HASH_PREFIX.slice(1)}${invitation}.${offerCapsule}`;
  if (url.href.length > maxLength) throw new RangeError('This invite is too large for a reliable share link. Use the full invite message instead.');
  return url.href;
}

/** Parse share data carried in the fragment; handshake verification still treats all tokens as untrusted. */
export function parseLiveInvitationLink(value, { maxLength = MAX_LIVE_INVITATION_LINK_LENGTH } = {}) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) throw new RangeError('This invite link is empty or too large.');
  let url;
  try { url = new URL(text); }
  catch { throw new TypeError('This is not a valid Tiny Image Star invite link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hash.startsWith(LIVE_INVITATION_HASH_PREFIX)) {
    throw new TypeError('This link does not contain a complete Tiny Image Star invite.');
  }
  const match = url.hash.slice(LIVE_INVITATION_HASH_PREFIX.length).match(/^(tisd1\.[A-Za-z0-9_-]+)\.(tisc1\.[A-Za-z0-9_-]+)$/u);
  if (!match) throw new TypeError('This Tiny Image Star invite link is incomplete.');
  validateParts(match[1], match[2]);
  return Object.freeze({ invitation: match[1], offerCapsule: match[2] });
}
