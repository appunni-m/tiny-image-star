export const LIVE_REPLY_CHANNEL_NAME = 'tiny-image-star-live-reply-v1';
export const LIVE_REPLY_HASH_PREFIX = '#tisreply1.';
export const MAX_LIVE_REPLY_LINK_LENGTH = 16_384;
const MAX_REPLY_CAPSULE_LENGTH = 100_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const CAPSULE_PATTERN = /^tisc1\.[A-Za-z0-9_-]+$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

function validateReply(sessionId, answerCapsule) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new TypeError('This reply link has an invalid session ID.');
  }
  if (typeof answerCapsule !== 'string' || answerCapsule.length > MAX_REPLY_CAPSULE_LENGTH || !CAPSULE_PATTERN.test(answerCapsule)) {
    throw new TypeError('This reply link has an invalid or oversized answer.');
  }
}

/** Create a self-contained reply URL. It only routes the guest's signed answer back to an open app tab. */
export function createLiveReplyLink(baseUrl, sessionId, answerCapsule, { maxLength = MAX_LIVE_REPLY_LINK_LENGTH } = {}) {
  validateReply(sessionId, answerCapsule);
  const url = new URL(String(baseUrl));
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Reply links need a Tiny Image Star web address.');
  url.hash = `${LIVE_REPLY_HASH_PREFIX.slice(1)}${sessionId}.${answerCapsule}`;
  if (url.href.length > maxLength) throw new RangeError('This reply is too large for a reliable share link. Use the manual reply code instead.');
  return url.href;
}

/** Read a reply URL without treating its session hint as proof; the host verifies the signed answer. */
export function parseLiveReplyLink(value, { maxLength = MAX_LIVE_REPLY_LINK_LENGTH } = {}) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) throw new RangeError('This reply link is empty or too large.');
  let url;
  try { url = new URL(text); }
  catch { throw new TypeError('This is not a valid Tiny Image Star reply link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hash.startsWith(LIVE_REPLY_HASH_PREFIX)) {
    throw new TypeError('This link does not contain a Tiny Image Star reply.');
  }
  const match = url.hash.slice(LIVE_REPLY_HASH_PREFIX.length).match(/^([A-Za-z0-9_-]{1,128})\.(tisc1\.[A-Za-z0-9_-]+)$/u);
  if (!match) throw new TypeError('This Tiny Image Star reply link is incomplete.');
  validateReply(match[1], match[2]);
  return Object.freeze({ sessionId: match[1], answerCapsule: match[2] });
}

function requestId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID().replace(/-/gu, '');
  if (typeof cryptoApi?.getRandomValues === 'function') {
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure random IDs are unavailable in this browser.');
}

/**
 * Cross-tab, same-origin reply handoff. The link's answer remains untrusted until the
 * owner's existing session controller verifies its signature and consumes the nonce.
 */
export function createLiveReplyHandoff({
  channelFactory = name => new BroadcastChannel(name),
  crypto: cryptoApi = globalThis.crypto,
  timeoutMs = 2_000
} = {}) {
  let channel;
  try {
    if (typeof channelFactory === 'function') channel = channelFactory(LIVE_REPLY_CHANNEL_NAME);
  } catch {}
  const handlers = new Set();
  const pending = new Map();
  let closed = false;

  function receive(event) {
    const data = event?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return;
    if (data.type === 'result' && typeof data.requestId === 'string') {
      const request = pending.get(data.requestId);
      if (!request || !['delivered', 'rejected'].includes(data.status)) return;
      if (data.status === 'delivered') {
        request.resolve({ status: 'delivered' });
        return;
      }
      request.rejection = typeof data.message === 'string' ? data.message.slice(0, 240) : 'The owner could not accept this reply.';
      return;
    }
    if (data.type !== 'reply' || typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)) return;
    let reply;
    try {
      validateReply(data.sessionId, data.answerCapsule);
      reply = { requestId: data.requestId, sessionId: data.sessionId, answerCapsule: data.answerCapsule };
    } catch { return; }
    for (const handler of handlers) {
      Promise.resolve().then(() => handler(reply)).then(result => {
        if (!result || !['delivered', 'rejected'].includes(result.status) || closed) return;
        channel.postMessage({
          v: 1, type: 'result', requestId: reply.requestId, status: result.status,
          ...(result.status === 'rejected' ? { message: String(result.message || 'The owner could not accept this reply.').slice(0, 240) } : {})
        });
      }).catch(() => {});
    }
  }

  if (channel) {
    if (typeof channel.addEventListener === 'function') channel.addEventListener('message', receive);
    else channel.onmessage = receive;
  }

  return Object.freeze({
    available: Boolean(channel),
    onReply(handler) {
      if (typeof handler !== 'function') throw new TypeError('A reply handler is required.');
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async sendReply({ sessionId, answerCapsule }) {
      validateReply(sessionId, answerCapsule);
      if (closed || !channel) return { status: 'unavailable' };
      const id = requestId(cryptoApi);
      let timer;
      let resolveResult;
      const resultPromise = new Promise(resolve => { resolveResult = resolve; });
      const request = { resolve: resolveResult, rejection: '' };
      pending.set(id, request);
      channel.postMessage({ v: 1, type: 'reply', requestId: id, sessionId, answerCapsule });
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve({ status: request.rejection ? 'rejected' : 'not-found', message: request.rejection }), timeoutMs);
      });
      const result = await Promise.race([resultPromise, timeout]);
      clearTimeout(timer);
      pending.delete(id);
      return result;
    },
    close() {
      if (closed) return;
      closed = true;
      if (channel) {
        if (typeof channel.removeEventListener === 'function') channel.removeEventListener('message', receive);
        else if (channel.onmessage === receive) channel.onmessage = null;
        channel.close?.();
      }
      for (const request of pending.values()) request.resolve({ status: 'unavailable' });
      pending.clear();
      handlers.clear();
    }
  });
}
