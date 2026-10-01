import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  THEME_PREFERENCE_KEY, createThemePreferenceController, normalizeThemePreference,
  readThemePreference, resolveTheme
} from '../src/theme-preference.js';

function fakeEnvironment({ stored = null, systemDark = false } = {}) {
  const values = new Map(stored == null ? [] : [[THEME_PREFERENCE_KEY, stored]]);
  const windowListeners = new Map();
  const mediaListeners = new Set();
  const root = { dataset: {}, style: {} };
  const themeColor = { content: '#ffffff' };
  const document = { documentElement: root, querySelector: () => themeColor };
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const media = {
    matches: systemDark,
    addEventListener: (type, listener) => { if (type === 'change') mediaListeners.add(listener); },
    removeEventListener: (type, listener) => { if (type === 'change') mediaListeners.delete(listener); },
    change(matches) { this.matches = matches; for (const listener of mediaListeners) listener({ matches }); }
  };
  const window = {
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: type => windowListeners.delete(type)
  };
  return { values, root, themeColor, media, matchMedia: () => media, window, document, storage, windowListeners, mediaListeners };
}

test('theme preference accepts only system, light, and dark and resolves system from the device', () => {
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('sepia'), 'system');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(readThemePreference({ getItem: () => 'sepia' }), 'system');
  assert.equal(readThemePreference({ getItem() { throw new Error('blocked'); } }), 'system');
});

test('theme controller applies and persists an explicit choice then tracks system changes', () => {
  const env = fakeEnvironment({ systemDark: true });
  const controller = createThemePreferenceController(env);
  assert.equal(controller.getPreference(), 'system');
  assert.equal(env.root.dataset.theme, 'dark');
  assert.equal(env.root.style.colorScheme, 'dark');
  assert.equal(env.themeColor.content, '#1b1d22');

  controller.setPreference('light');
  assert.equal(env.values.get(THEME_PREFERENCE_KEY), 'light');
  assert.equal(env.root.dataset.theme, 'light');
  env.media.change(false);
  assert.equal(env.root.dataset.theme, 'light', 'an explicit choice ignores later system changes');

  controller.setPreference('system');
  assert.equal(env.root.dataset.theme, 'light');
  env.media.change(true);
  assert.equal(env.root.dataset.theme, 'dark');
  assert.equal(env.themeColor.content, '#1b1d22');
  controller.dispose();
  assert.equal(env.mediaListeners.size, 0);
  assert.equal(env.windowListeners.size, 0);
});

test('theme choice follows cross-tab storage updates and survives blocked storage', () => {
  const env = fakeEnvironment({ stored: 'light', systemDark: true });
  const controller = createThemePreferenceController(env);
  assert.equal(env.root.dataset.theme, 'light');
  const onStorage = env.windowListeners.get('storage');
  onStorage({ key: THEME_PREFERENCE_KEY, newValue: 'dark' });
  assert.equal(controller.getPreference(), 'dark');
  assert.equal(env.root.dataset.theme, 'dark');
  onStorage({ key: 'unrelated', newValue: 'light' });
  assert.equal(controller.getPreference(), 'dark');
  controller.dispose();

  const blocked = fakeEnvironment();
  blocked.storage.setItem = () => { throw new Error('blocked'); };
  const inMemoryController = createThemePreferenceController(blocked);
  assert.equal(inMemoryController.setPreference('dark'), 'dark');
  assert.equal(inMemoryController.getTheme(), 'dark');
  assert.equal(blocked.root.dataset.theme, 'dark');
  inMemoryController.dispose();
});

test('blocking theme bootstrap honors the saved choice before CSS paints', async () => {
  const bootstrap = await readFile(new URL('../src/theme-bootstrap.js', import.meta.url), 'utf8');
  const run = ({ saved = null, systemDark = false, storageBlocked = false } = {}) => {
    const root = { dataset: {}, style: {} };
    const themeColor = { content: '' };
    const document = { documentElement: root, querySelector: () => themeColor };
    const localStorage = {
      getItem(key) {
        assert.equal(key, THEME_PREFERENCE_KEY);
        if (storageBlocked) throw new Error('blocked');
        return saved;
      }
    };
    runInNewContext(bootstrap, { document, localStorage, matchMedia: () => ({ matches: systemDark }) });
    return { root, themeColor };
  };
  assert.equal(run({ saved: 'light', systemDark: true }).root.dataset.theme, 'light');
  assert.equal(run({ saved: 'dark', systemDark: false }).themeColor.content, '#1b1d22');
  assert.equal(run({ systemDark: true }).root.style.colorScheme, 'dark');
  assert.equal(run({ storageBlocked: true }).root.dataset.theme, 'light');
});
