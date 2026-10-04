import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installLiveLinkHashChangeHandler } from '../src/collaboration/live-link-entry.js';

test('live invitation and reply links clicked in an open tab route to their entry flows', () => {
  const target = new EventTarget();
  target.location = { hash: '' };
  const received = [];
  const removeListener = installLiveLinkHashChangeHandler(target, {
    onInvitation: () => received.push('invitation'),
    onReply: () => received.push('reply')
  });
  const navigate = hash => {
    target.location.hash = hash;
    target.dispatchEvent(new Event('hashchange'));
  };

  navigate('#tisjoin1.invite.offer');
  navigate('#tisd1.identity');
  navigate('#tisreply1.answer');
  navigate('#theme=dark');
  assert.deepEqual(received, ['invitation', 'invitation', 'reply']);

  removeListener();
  navigate('#tisjoin1.another.offer');
  assert.deepEqual(received, ['invitation', 'invitation', 'reply']);
});

test('the editor routes in-page URL changes through existing join and reply handlers', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /installLiveLinkHashChangeHandler\(window,\s*\{\s*onInvitation:\s*\(\)\s*=>\s*\{\s*startJoinFromStableLink\(\);\s*\},\s*onReply:\s*\(\)\s*=>\s*\{\s*void startLiveReplyFromLink\(\);\s*\}\s*\}\)/);
});
