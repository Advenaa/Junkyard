import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended
const KEY_LENGTH = 32; // 256 bits

/**
 * Derives a 256-bit encryption key from a passphrase.
 * Uses PBKDF2 with a fixed salt derived from the app context.
 * The passphrase should be TOKEN_ENCRYPTION_KEY or SESSION_SECRET env var.
 */
function deriveKey(passphrase: string): Buffer {
  // Fixed salt — not ideal but acceptable since the passphrase is already high-entropy
  // (either a dedicated key or SESSION_SECRET which is 32 random bytes hex)
  const salt = Buffer.from('podders-token-encryption-v1', 'utf-8');
  return crypto.pbkdf2Sync(passphrase, salt, 100_000, KEY_LENGTH, 'sha256');
}

export interface EncryptedToken {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/**
 * Encrypt a plaintext secret.
 */
export function encryptSecret(plaintext: string, passphrase: string): EncryptedToken {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf-8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt an encrypted secret back to plaintext.
 * Throws if the key is wrong or data is tampered.
 */
export function decryptSecret(encrypted: EncryptedToken, passphrase: string): string {
  const key = deriveKey(passphrase);
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted.ciphertext, 'base64', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

/**
 * Get the encryption passphrase from environment.
 * Prefers TOKEN_ENCRYPTION_KEY, falls back to SESSION_SECRET.
 * Returns null if neither is available (tokens cannot be stored).
 */
export function getEncryptionKey(): string | null {
  return process.env['TOKEN_ENCRYPTION_KEY'] || process.env['SESSION_SECRET'] || null;
}

export function encryptToken(plaintext: string, passphrase: string): EncryptedToken {
  return encryptSecret(plaintext, passphrase);
}

export function decryptToken(encrypted: EncryptedToken, passphrase: string): string {
  return decryptSecret(encrypted, passphrase);
}
