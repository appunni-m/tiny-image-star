import { LIVE_INVITATION_HASH_PREFIX } from './invitation-link.js';

const LIVE_DESIGN_HASH_PREFIX = '#tisd1.';
const LIVE_REPLY_HASH_PREFIX = '#tisreply1.';

/** Route live invite links clicked in an already-open editor tab. */
export function installLiveLinkHashChangeHandler(target, { onInvitation, onReply } = {}) {
  if (!target || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') {
    throw new TypeError('A window-like event target is required.');
  }
  if (typeof onInvitation !== 'function' || typeof onReply !== 'function') {
    throw new TypeError('Invitation and reply handlers are required.');
  }

  const handleHashChange = () => {
    const hash = String(target.location?.hash || '');
    if (hash.startsWith(LIVE_REPLY_HASH_PREFIX)) {
      onReply();
      return;
    }
    if (hash.startsWith(LIVE_INVITATION_HASH_PREFIX) || hash.startsWith(LIVE_DESIGN_HASH_PREFIX)) {
      onInvitation();
    }
  };
  target.addEventListener('hashchange', handleHashChange);
  return () => target.removeEventListener('hashchange', handleHashChange);
}
