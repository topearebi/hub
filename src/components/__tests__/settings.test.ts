import { describe, expect, it } from 'vitest';

import { SettingsModal } from '../settings';
import { DEFAULT_APP_CONFIG } from '../../types/schemas';
import type { AppConfig } from '../../types/schemas';

/** Build a settings modal backed by an in-memory config. */
function makeSettings(): SettingsModal {
  const config: AppConfig = { ...DEFAULT_APP_CONFIG };
  const fakeStore = {
    appConfig: config,
    updateConfig: async () => config,
  };
  return new SettingsModal(fakeStore, {
    onClose: () => undefined,
    onExport: () => undefined,
    onImport: () => undefined,
    onTestConnection: async () => ({ ok: true, canWrite: true, message: 'ok' }),
    onCheckFile: async () => true,
    onInitialize: async () => undefined,
    onSaved: () => undefined,
    onSyncNow: () => undefined,
    onRegisterLock: async () => undefined,
    onDisableLock: async () => undefined,
    encryptToken: async (plaintext) => `enc1:${plaintext}`,
  });
}

describe('SettingsModal', () => {
  it('closes when Escape is pressed', () => {
    const settings = makeSettings();
    document.body.appendChild(settings.element);

    settings.open();
    expect(settings.element.classList.contains('is-open')).toBe(true);

    settings.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(settings.element.classList.contains('is-open')).toBe(false);
  });
});
