import { describe, expect, it, vi } from 'vitest';

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

it('tests the saved credential without redisplaying it and coordinates removal', async () => {
  const config = {
    ...DEFAULT_APP_CONFIG,
    github_pat: 'enc1:ciphertext',
    github_owner: 'owner',
    github_repo: 'repo',
  };
  const onTestConnection = vi.fn(async () => ({
    ok: true,
    canWrite: true,
    message: 'sync.readable',
  }));
  const onRemoveToken = vi.fn(async () => {
    config.github_pat = '';
  });
  const modal = new SettingsModal(
    { appConfig: config, updateConfig: async () => config },
    {
      onClose: vi.fn(),
      onExport: vi.fn(),
      onImport: vi.fn(),
      onTestConnection,
      onCheckFile: async () => true,
      onInitialize: vi.fn(),
      onSaved: vi.fn(),
      onSyncNow: vi.fn(),
      onRegisterLock: vi.fn(),
      onDisableLock: vi.fn(),
      encryptToken: async () => 'enc1:new',
      getSavedToken: () => 'saved-secret',
      onRemoveToken,
    },
  );
  document.body.appendChild(modal.element);
  modal.open();
  expect(
    [...modal.element.querySelectorAll('input')].some(
      (input) => input.value.includes('secret') || input.value.includes('ciphertext'),
    ),
  ).toBe(false);
  [...modal.element.querySelectorAll('button')]
    .find((button) => button.textContent === 'Test connection')
    ?.click();
  await vi.waitFor(() =>
    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'saved-secret' }),
    ),
  );
  [...modal.element.querySelectorAll('button')]
    .find((button) => button.textContent === 'Remove')
    ?.click();
  await vi.waitFor(() => expect(onRemoveToken).toHaveBeenCalledTimes(1));
  modal.close();
  modal.element.remove();
});
