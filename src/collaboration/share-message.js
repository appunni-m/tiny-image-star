const MAX_LIVE_SHARE_MESSAGE_LENGTH = 100_000;
const SESSION_CODE_PATTERN = /\btisc1\.[A-Za-z0-9_-]+\b/gu;
const STABLE_INVITE_PATTERN = /\btisd1\.[A-Za-z0-9_-]+\b/u;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/iu;

function cleanLinkPunctuation(value) {
  return String(value).replace(/[),.;!?]+$/gu, '');
}

/** Format the two serverless WebRTC handoff values as one message people can send and paste. */
export function formatLiveShareMessage(invitationUrl, sessionCode) {
  const invitation = String(invitationUrl ?? '').trim();
  const offer = String(sessionCode ?? '').trim();
  if (!invitation || !offer.startsWith('tisc1.')) throw new TypeError('A design invitation and fresh connection code are required.');
  return [
    'Open this Tiny Image Star design',
    '',
    invitation,
    '',
    'Use this code within 5 minutes:',
    offer,
    '',
    'In Tiny Image Star, paste this whole message and tap Join design. Then send your reply back to me.'
  ].join('\n');
}

/** Format a reply so it remains recognizable when shared through a chat app. */
export function formatLiveReplyMessage(sessionCode) {
  const code = String(sessionCode ?? '').trim();
  if (!code.startsWith('tisc1.')) throw new TypeError('A fresh connection reply is required.');
  return [
    'Reply to join this Tiny Image Star design',
    '',
    code,
    '',
    'Send this whole message to the owner. They will paste it to finish connecting you.'
  ].join('\n');
}

/** Extract the invite link and temporary code from a shared message or QR handoff. */
export function parseLiveShareMessage(value) {
  const text = String(value ?? '').trim();
  if (text.length > MAX_LIVE_SHARE_MESSAGE_LENGTH) throw new RangeError('This invite message is too large. Ask the owner to send it again.');

  const codes = [...text.matchAll(SESSION_CODE_PATTERN)].map(match => match[0]);
  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length > 1) throw new TypeError('This message contains more than one connection code. Ask the owner to send one invite at a time.');

  const link = text.match(HTTP_URL_PATTERN)?.[0];
  const stableInvite = text.match(STABLE_INVITE_PATTERN)?.[0];
  const invitation = link ? cleanLinkPunctuation(link) : stableInvite || text;
  const sessionCode = uniqueCodes[0] || '';
  if (sessionCode && !link && !stableInvite) {
    throw new TypeError('This message has a connection code but no design invite. Ask the owner to send the full invite message.');
  }
  return { invitation, sessionCode };
}

/** Accept either the raw one-time reply or the complete message sent by phone share. */
export function parseLiveReplyMessage(value) {
  const text = String(value ?? '').trim();
  if (text.length > MAX_LIVE_SHARE_MESSAGE_LENGTH) throw new RangeError('This reply message is too large. Ask the guest to send it again.');
  const codes = [...new Set([...text.matchAll(SESSION_CODE_PATTERN)].map(match => match[0]))];
  if (codes.length > 1) throw new TypeError('This message contains more than one reply. Ask the guest to send one reply at a time.');
  return codes[0] || text;
}
