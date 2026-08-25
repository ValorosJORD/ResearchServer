import crypto from 'crypto';
import 'dotenv';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // recommended IV length for GCM

function loadMasterKey(): Buffer {
  const encoded = process.env.FILE_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error(
      'FILE_ENCRYPTION_KEY is missing. Add it to your .env file.\n' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `FILE_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (got ${key.length}). ` +
        "Generate a new one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  return key;
}

// Loaded once at module import, so a missing/malformed key fails loudly at
// server startup rather than on someone's first upload.
const masterKey = loadMasterKey();

export interface FileEncryptionMeta {
  // The per-file data key, itself encrypted ("wrapped") with the master key.
  wrappedKey: string; // base64
  keyIv: string; // base64
  keyAuthTag: string; // base64
  // The file content, encrypted with the (unwrapped) per-file data key.
  contentIv: string; // base64
  contentAuthTag: string; // base64
}

export interface EncryptedFile {
  ciphertext: Buffer;
  meta: FileEncryptionMeta;
}

/**
 * Envelope encryption: generates a random key unique to this file,
 * encrypts the file content with it, then encrypts ("wraps") that key
 * with the single master key from FILE_ENCRYPTION_KEY. Only the wrapped
 * key and metadata get stored (in the DB) — the per-file key never
 * exists anywhere in plaintext outside this function's execution.
 */
export function encryptFile(plaintext: Buffer): EncryptedFile {
  const dataKey = crypto.randomBytes(KEY_LENGTH);

  const contentIv = crypto.randomBytes(IV_LENGTH);
  const contentCipher = crypto.createCipheriv(ALGORITHM, dataKey, contentIv);
  const ciphertext = Buffer.concat([contentCipher.update(plaintext), contentCipher.final()]);
  const contentAuthTag = contentCipher.getAuthTag();

  const keyIv = crypto.randomBytes(IV_LENGTH);
  const keyCipher = crypto.createCipheriv(ALGORITHM, masterKey, keyIv);
  const wrappedKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final()]);
  const keyAuthTag = keyCipher.getAuthTag();

  return {
    ciphertext,
    meta: {
      wrappedKey: wrappedKey.toString('base64'),
      keyIv: keyIv.toString('base64'),
      keyAuthTag: keyAuthTag.toString('base64'),
      contentIv: contentIv.toString('base64'),
      contentAuthTag: contentAuthTag.toString('base64'),
    },
  };
}

/**
 * Reverses encryptFile. Throws if the master key is wrong or the
 * ciphertext/metadata has been tampered with or corrupted — GCM's auth
 * tag check fails closed rather than silently returning garbage.
 */
export function decryptFile(ciphertext: Buffer, meta: FileEncryptionMeta): Buffer {
  const keyDecipher = crypto.createDecipheriv(
    ALGORITHM,
    masterKey,
    Buffer.from(meta.keyIv, 'base64'),
  );
  keyDecipher.setAuthTag(Buffer.from(meta.keyAuthTag, 'base64'));
  const dataKey = Buffer.concat([
    keyDecipher.update(Buffer.from(meta.wrappedKey, 'base64')),
    keyDecipher.final(),
  ]);

  const contentDecipher = crypto.createDecipheriv(
    ALGORITHM,
    dataKey,
    Buffer.from(meta.contentIv, 'base64'),
  );
  contentDecipher.setAuthTag(Buffer.from(meta.contentAuthTag, 'base64'));

  return Buffer.concat([contentDecipher.update(ciphertext), contentDecipher.final()]);
}
