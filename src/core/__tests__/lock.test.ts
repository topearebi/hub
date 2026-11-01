import { describe, expect, it } from 'vitest';

import { base64urlToBytes, bytesToBase64url, resolveInitialLock } from '../lock';

describe('resolveInitialLock', () => {
  it('is unlocked when the lock is disabled', () => {
    expect(resolveInitialLock({ app_lock_enabled: false }, true)).toBe('unlocked');
  });

  it('is unsupported when enabled without WebAuthn', () => {
    expect(
      resolveInitialLock({ app_lock_enabled: true, app_lock_credential_id: 'abc' }, false),
    ).toBe('unsupported');
  });

  it('is unlocked when enabled but no credential is registered', () => {
    expect(resolveInitialLock({ app_lock_enabled: true }, true)).toBe('unlocked');
  });

  it('is locked when enabled with a credential on a supported device', () => {
    expect(
      resolveInitialLock({ app_lock_enabled: true, app_lock_credential_id: 'abc' }, true),
    ).toBe('locked');
  });
});

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]).buffer;
    const encoded = bytesToBase64url(bytes);
    expect(Array.from(base64urlToBytes(encoded))).toEqual([0, 1, 2, 250, 255]);
  });

  it('produces URL-safe output without padding', () => {
    const bytes = new Uint8Array([251, 255]).buffer;
    expect(bytesToBase64url(bytes)).toBe('-_8');
  });
});
