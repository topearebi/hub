// @vitest-environment node
//
// `core/token.ts` is headless (no DOM). Running its tests in the Node
// environment keeps the injected `node:crypto` WebCrypto and the global
// `Uint8Array`/`ArrayBuffer`/`atob` in the same realm: WebCrypto brand-checks
// its `BufferSource` arguments, so a jsdom-realm buffer would be rejected on
// some Node versions.
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ENVELOPE_PREFIX,
  TokenVault,
  decryptToken,
  encryptToken,
  generateTokenKey,
  isEncryptedToken,
} from '../token';
import type { TokenKeyStore } from '../token';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

/** In-memory key store (fake-indexeddb cannot round-trip a CryptoKey). */
function memoryKeyStore(): TokenKeyStore {
  let key: CryptoKey | undefined;
  return {
    get: async () => key,
    set: async (value) => {
      key = value;
    },
    delete: async () => {
      key = undefined;
    },
  };
}

describe('isEncryptedToken', () => {
  it('detects the enc1: envelope prefix', () => {
    expect(isEncryptedToken(`${ENVELOPE_PREFIX}abc.def`)).toBe(true);
    expect(isEncryptedToken('ghp_plaintext')).toBe(false);
    expect(isEncryptedToken(undefined)).toBe(false);
  });
});

describe('encryptToken / decryptToken', () => {
  it('round-trips a token through an enc1: envelope', async () => {
    const key = await generateTokenKey(subtle);
    const envelope = await encryptToken('ghp_secret_value', key, subtle);
    expect(envelope.startsWith(ENVELOPE_PREFIX)).toBe(true);
    expect(envelope).not.toContain('ghp_secret_value');
    await expect(decryptToken(envelope, key, subtle)).resolves.toBe('ghp_secret_value');
  });

  it('produces a different ciphertext each time (random IV)', async () => {
    const key = await generateTokenKey(subtle);
    const a = await encryptToken('same', key, subtle);
    const b = await encryptToken('same', key, subtle);
    expect(a).not.toBe(b);
  });

  it('returns null when decrypted with the wrong key', async () => {
    const key = await generateTokenKey(subtle);
    const other = await generateTokenKey(subtle);
    const envelope = await encryptToken('secret', key, subtle);
    await expect(decryptToken(envelope, other, subtle)).resolves.toBeNull();
  });

  it('returns null for malformed or plaintext input', async () => {
    const key = await generateTokenKey(subtle);
    await expect(decryptToken('ghp_plaintext', key, subtle)).resolves.toBeNull();
    await expect(decryptToken(`${ENVELOPE_PREFIX}nodot`, key, subtle)).resolves.toBeNull();
    await expect(decryptToken(`${ENVELOPE_PREFIX}iv.`, key, subtle)).resolves.toBeNull();
  });
});

describe('TokenVault', () => {
  it('reports none when no token is stored', async () => {
    const vault = new TokenVault({ keyStore: memoryKeyStore(), subtle });
    await expect(vault.init(undefined)).resolves.toEqual({ status: 'none' });
    expect(vault.isConfigured).toBe(false);
  });

  it('migrates legacy plaintext in place and returns the envelope', async () => {
    const vault = new TokenVault({ keyStore: memoryKeyStore(), subtle });
    const result = await vault.init('ghp_legacy');
    expect(result.status).toBe('ready');
    expect(result.migratedEnvelope?.startsWith(ENVELOPE_PREFIX)).toBe(true);
    expect(vault.token).toBe('ghp_legacy');
  });

  it('decrypts a stored envelope into memory', async () => {
    const keyStore = memoryKeyStore();
    const first = new TokenVault({ keyStore, subtle });
    const envelope = await first.setToken('ghp_roundtrip');

    const second = new TokenVault({ keyStore, subtle });
    await expect(second.init(envelope)).resolves.toEqual({ status: 'ready' });
    expect(second.token).toBe('ghp_roundtrip');
  });

  it('asks for re-entry when the key record is missing', async () => {
    const keyStore = memoryKeyStore();
    const first = new TokenVault({ keyStore, subtle });
    const envelope = await first.setToken('ghp_roundtrip');

    const fresh = new TokenVault({ keyStore: memoryKeyStore(), subtle });
    await expect(fresh.init(envelope)).resolves.toEqual({ status: 'needs-reentry' });
    expect(fresh.isConfigured).toBe(false);
  });

  it('asks for re-entry when the envelope is undecryptable', async () => {
    const vault = new TokenVault({ keyStore: memoryKeyStore(), subtle });
    await expect(vault.init(`${ENVELOPE_PREFIX}AAAA.BBBB`)).resolves.toEqual({
      status: 'needs-reentry',
    });
  });

  it('never surfaces ciphertext when WebCrypto is unavailable', async () => {
    const vault = new TokenVault({ keyStore: memoryKeyStore(), subtle: null });
    expect(vault.isSupported).toBe(false);
    await expect(vault.init(`${ENVELOPE_PREFIX}AAAA.BBBB`)).resolves.toEqual({
      status: 'needs-reentry',
    });
    expect(vault.token).toBe('');
  });

  it('clears the in-memory token and can destroy the key', async () => {
    const keyStore = memoryKeyStore();
    const vault = new TokenVault({ keyStore, subtle });
    await vault.setToken('ghp_x');
    expect(vault.isConfigured).toBe(true);
    vault.clear();
    expect(vault.isConfigured).toBe(false);

    await vault.setToken('ghp_y');
    await vault.destroyKey();
    expect(vault.isConfigured).toBe(false);
    await expect(keyStore.get()).resolves.toBeUndefined();
  });
});
