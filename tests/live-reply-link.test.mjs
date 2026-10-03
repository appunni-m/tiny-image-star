import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveReplyHandoff, createLiveReplyLink, LIVE_REPLY_CHANNEL_NAME, MAX_LIVE_REPLY_LINK_LENGTH, parseLiveReplyLink
} from '../src/collaboration/reply-link.js';

function capsule(char = 'A', length = 180) { return `tisc1.${char.repeat(length)}`; }

test('reply links keep signed answer data in the URL fragment and round-trip session routing', () => {
  const link = createLiveReplyLink('https://app.example/tiny-image-star/?theme=dark#old-value', 'session_123', capsule());
  const url = new URL(link);
  assert.equal(url.search, '?theme=dark');
  assert.match(url.hash, /^#tisreply1\.session_123\.tisc1\./u);
  assert.deepEqual(parseLiveReplyLink(link), { sessionId: 'session_123', answerCapsule: capsule() });
  assert.equal(link.includes('?'), true);
});

test('reply link builder rejects unsafe schemes, malformed capsules, and excessive URLs', () => {
  assert.throws(() => createLiveReplyLink('javascript:alert(1)', 'session_123', capsule()), /web address/u);
  assert.throws(() => createLiveReplyLink('https://app.example/', 'bad session', capsule()), /session ID/u);
  assert.throws(() => createLiveReplyLink('https://app.example/', 'session_123', 'tisc1.bad/value'), /answer/u);
  assert.throws(() => createLiveReplyLink('https://app.example/', 'session_123', capsule('A', 40), { maxLength: 20 }), /too large/u);
  assert.ok(MAX_LIVE_REPLY_LINK_LENGTH >= 8_192);
});

test('reply parser rejects unrelated, incomplete, and malformed links', () => {
  assert.throws(() => parseLiveReplyLink('https://app.example/#tisd1.invite'), /does not contain/u);
  assert.throws(() => parseLiveReplyLink('https://app.example/#tisreply1.session_123'), /incomplete/u);
  assert.throws(() => parseLiveReplyLink('https://app.example/#tisreply1.bad%20id.tisc1.A'), /incomplete/u);
  assert.throws(() => parseLiveReplyLink(`https://app.example/#tisreply1.session_123.${capsule('A', MAX_LIVE_REPLY_LINK_LENGTH)}`), /too large/u);
});

class BroadcastBus {
  channels = new Set();
  create = name => {
    assert.equal(name, LIVE_REPLY_CHANNEL_NAME);
    const listeners = new Set();
    const channel = {
      addEventListener: (type, handler) => { if (type === 'message') listeners.add(handler); },
      removeEventListener: (type, handler) => { if (type === 'message') listeners.delete(handler); },
      postMessage: data => {
        for (const other of this.channels) if (other !== channel && !other.closed) {
          for (const listener of other.listeners) listener({ data: structuredClone(data) });
        }
      },
      close: () => { channel.closed = true; this.channels.delete(channel); },
      listeners, closed: false
    };
    this.channels.add(channel);
    return channel;
  };
}

test('clicking a reply link relays to the open owner tab and waits for verified acceptance', async () => {
  const bus = new BroadcastBus();
  const owner = createLiveReplyHandoff({ channelFactory: bus.create, timeoutMs: 50 });
  const replyTab = createLiveReplyHandoff({ channelFactory: bus.create, timeoutMs: 50 });
  const received = [];
  owner.onReply(async reply => {
    received.push(reply);
    return { status: 'delivered' };
  });
  const result = await replyTab.sendReply({ sessionId: 'session_123', answerCapsule: capsule() });
  assert.deepEqual(result, { status: 'delivered' });
  assert.deepEqual(received, [{ requestId: received[0].requestId, sessionId: 'session_123', answerCapsule: capsule() }]);
  owner.close();
  replyTab.close();
});

test('reply handoff reports an owner-side rejection and explains a missing open tab', async () => {
  const bus = new BroadcastBus();
  const owner = createLiveReplyHandoff({ channelFactory: bus.create, timeoutMs: 20 });
  const replyTab = createLiveReplyHandoff({ channelFactory: bus.create, timeoutMs: 20 });
  owner.onReply(async () => ({ status: 'rejected', message: 'This reply has already been used.' }));
  assert.deepEqual(await replyTab.sendReply({ sessionId: 'session_123', answerCapsule: capsule() }), {
    status: 'rejected', message: 'This reply has already been used.'
  });
  owner.close();
  replyTab.close();

  const noOwner = createLiveReplyHandoff({ channelFactory: new BroadcastBus().create, timeoutMs: 5 });
  assert.deepEqual(await noOwner.sendReply({ sessionId: 'session_123', answerCapsule: capsule() }), {
    status: 'not-found', message: ''
  });
  noOwner.close();
});
