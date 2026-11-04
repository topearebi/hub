/**
 * Hub Token Vault
 * ---------------
 * Encrypts the GitHub personal access token (PAT) at rest with the native
 * WebCrypto API and a **non-extractable** AES-GCM key (SCHEMAS.md §3.5).
 *
 * Storage shape (approved):
 *   - `AppConfig.github_pat` holds a versioned envelope string,
 *     `"enc1:" + base64url(iv) + "." + base64url(ciphertext)`.
 *   - A singleton `config` record `{ key: "token_key", value: CryptoKey }`
 *     holds the non-extractable key. No new object store, no `DB_VERSION` bump.
 *
 * The raw token exists only in memory for the duration of a request. It is
 * never logged, never written to export JSON, never in the sync payload, and
 * the settings field never re-displays it.
 *
 * Headless by design (no DOM imports) so it is unit-testable. The key store is
 * injected so tests can supply an in-memory implementation (fake-indexeddb and
 * Node's WebCrypto do not round-trip a `CryptoKey` identically to browsers).
 */

/** Versioned envelope prefix. A value without it is legacy plaintext. */
export const ENVELOPE_PREFIX = 'enc1:';

/** Persistence abstraction for the non-extractable AES-GCM key. */
export interface TokenKeyStore {
  get(): Promise<CryptoKey | undefined>;
  set(key: CryptoKey): Promise<void>;
  delete(): Promise<void>;
}

/** Outcome of loading the stored token into memory. */
export type TokenInitStatus = 'none' | 'ready' | 'needs-reentry';

/** Result of {@link TokenVault.init}. */
export interface TokenInitResult {
  status: TokenInitStatus;
  /**
   * Present when a legacy plaintext token was migrated: the caller must persist
   * this envelope over the old plaintext value.
   */
  migratedEnvelope?: string;
}

/** True when `value` is an `enc1:` envelope (as opposed to legacy plaintext). */
export function isEncryptedToken(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

/* ------------------------------------------------------------------ */
/* base64url helpers                                                   */
/* ------------------------------------------------------------------ */

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  // `bytes.buffer` is `ArrayBufferLike`; narrow it to `ArrayBuffer` so it is a
  // valid `BufferSource` for WebCrypto under the strict lib types.
  return bytes.buffer as ArrayBuffer;
}

/* ------------------------------------------------------------------ */
/* Pure crypto primitives                                              */
/* ------------------------------------------------------------------ */

/** Generate a fresh non-extractable AES-GCM 256-bit key. */
export function generateTokenKey(subtle: SubtleCrypto): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]) as Promise<CryptoKey>;
}

/** Encrypt `plaintext` into an `enc1:` envelope. */
export async function encryptToken(
  plaintext: string,
  key: CryptoKey,
  subtle: SubtleCrypto,
): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${ENVELOPE_PREFIX}${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

/**
 * Decrypt an `enc1:` envelope. Returns `null` for a malformed envelope, a
 * missing/incorrect key, or any decryption failure (the caller then treats sync
 * as "not configured" and asks the user to re-enter the token).
 */
export async function decryptToken(
  envelope: string,
  key: CryptoKey,
  subtle: SubtleCrypto,
): Promise<string | null> {
  if (!isEncryptedToken(envelope)) {
    return null;
  }
  const body = envelope.slice(ENVELOPE_PREFIX.length);
  const separator = body.indexOf('.');
  if (separator <= 0) {
    return null;
  }
  const ivPart = body.slice(0, separator);
  const cipherPart = body.slice(separator + 1);
  if (cipherPart.length === 0) {
    return null;
  }
  try {
    const iv = fromBase64Url(ivPart);
    const cipher = fromBase64Url(cipherPart);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Vault                                                               */
/* ------------------------------------------------------------------ */

export interface TokenVaultOptions {
  keyStore: TokenKeyStore;
  /**
   * WebCrypto implementation. Omit to use `globalThis.crypto?.subtle`; pass
   * `null` to force the "unavailable" path (used by tests).
   */
  subtle?: SubtleCrypto | null | undefined;
}

/**
 * Holds the decrypted token in memory and mediates encryption/decryption. The
 * sync engine reads {@link TokenVault.token}; the settings UI calls
 * {@link TokenVault.setToken} to obtain the envelope to persist.
 */
export class TokenVault {
  private plaintext = '';
  private readonly keyStore: TokenKeyStore;
  private readonly subtle: SubtleCrypto | undefined;

  constructor(options: TokenVaultOptions) {
    this.keyStore = options.keyStore;
    this.subtle =
      options.subtle === null ? undefined : (options.subtle ?? globalThis.crypto?.subtle);
  }

  /** The decrypted token, or an empty string when none is configured. */
  get token(): string {
    return this.plaintext;
  }

  /** True when a usable token is held in memory. */
  get isConfigured(): boolean {
    return this.plaintext.length > 0;
  }

  /** True when WebCrypto is available in this environment. */
  get isSupported(): boolean {
    return this.subtle !== undefined;
  }

  /**
   * Load the stored value into memory, migrating legacy plaintext in place.
   * Never exposes ciphertext: an undecryptable envelope yields `needs-reentry`.
   */
  async init(stored: string | undefined): Promise<TokenInitResult> {
    this.plaintext = '';
    if (!stored) {
      return { status: 'none' };
    }
    if (!this.subtle) {
      // Without WebCrypto we cannot decrypt; never surface the ciphertext.
      return { status: isEncryptedToken(stored) ? 'needs-reentry' : 'none' };
    }

    if (!isEncryptedToken(stored)) {
      // Legacy plaintext: encrypt in place and hand the envelope back to persist.
      const key = await this.ensureKey();
      const envelope = await encryptToken(stored, key, this.subtle);
      this.plaintext = stored;
      return { status: 'ready', migratedEnvelope: envelope };
    }

    const key = await this.keyStore.get();
    if (!key) {
      return { status: 'needs-reentry' };
    }
    const plain = await decryptToken(stored, key, this.subtle);
    if (plain === null) {
      return { status: 'needs-reentry' };
    }
    this.plaintext = plain;
    return { status: 'ready' };
  }

  /** Encrypt a new token and return the envelope to persist. */
  async setToken(plaintext: string): Promise<string> {
    if (!this.subtle) {
      throw new Error('WebCrypto is unavailable; cannot encrypt the token.');
    }
    const key = await this.ensureKey();
    const envelope = await encryptToken(plaintext, key, this.subtle);
    this.plaintext = plaintext;
    return envelope;
  }

  /** Forget the in-memory token (the caller clears the stored envelope). */
  clear(): void {
    this.plaintext = '';
  }

  /** Delete the key record (used by "Reset app data"). */
  async destroyKey(): Promise<void> {
    await this.keyStore.delete();
    this.plaintext = '';
  }

  private async ensureKey(): Promise<CryptoKey> {
    const existing = await this.keyStore.get();
    if (existing) {
      return existing;
    }
    const key = await generateTokenKey(this.subtle as SubtleCrypto);
    await this.keyStore.set(key);
    return key;
  }
}
