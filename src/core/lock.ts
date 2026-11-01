/**
 * Hub App Lock (WebAuthn)
 * -----------------------
 * Gates the app behind the device screen lock / biometrics using a WebAuthn
 * platform authenticator with `userVerification: 'required'`. The lock decision
 * (`resolveInitialLock`) is a pure function so it is unit-testable; the
 * credential helpers are feature-detected and no-op safely when WebAuthn is
 * unavailable.
 */

/** Lifecycle state of the app lock. */
export type LockPhase = 'unlocked' | 'locked' | 'unsupported';

/** The subset of `AppConfig` the lock cares about. */
export interface LockConfig {
  app_lock_enabled: boolean;
  app_lock_credential_id?: string;
}

/** Feature-detect the WebAuthn platform authenticator APIs. */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}

/**
 * Decide the phase the app should start in:
 *   - lock disabled           -> unlocked
 *   - lock enabled, no WebAuthn -> unsupported (the UI warns the user)
 *   - lock enabled, no credential yet -> unlocked (nothing to verify against)
 *   - lock enabled, credential present -> locked
 */
export function resolveInitialLock(config: LockConfig, supported: boolean): LockPhase {
  if (!config.app_lock_enabled) {
    return 'unlocked';
  }
  if (!supported) {
    return 'unsupported';
  }
  if (!config.app_lock_credential_id) {
    return 'unlocked';
  }
  return 'locked';
}

/* ------------------------------------------------------------------ */
/* Base64url helpers                                                   */
/* ------------------------------------------------------------------ */

/** Decode a URL-safe Base64 string into bytes. */
export function base64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** Encode bytes as a URL-safe Base64 string without padding. */
export function bytesToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Credential lifecycle                                                */
/* ------------------------------------------------------------------ */

/**
 * Register a platform credential (screen lock / biometrics). Returns the
 * base64url credential id, or `null` when registration is cancelled or
 * unsupported.
 */
export async function registerAppLock(userName = 'hub-user'): Promise<string | null> {
  if (!isWebAuthnAvailable()) {
    return null;
  }

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Hub', id: window.location.hostname },
        user: {
          id: randomBytes(16),
          name: userName,
          displayName: 'Hub',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    return credential ? bytesToBase64url(credential.rawId) : null;
  } catch {
    return null;
  }
}

/**
 * Prompt the platform authenticator to verify the user against a previously
 * registered credential. Returns `true` on a successful assertion.
 */
export async function verifyAppLock(credentialId: string): Promise<boolean> {
  if (!isWebAuthnAvailable() || credentialId.trim().length === 0) {
    return false;
  }

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [
          {
            id: base64urlToBytes(credentialId),
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;

    return assertion !== null;
  } catch {
    return false;
  }
}
