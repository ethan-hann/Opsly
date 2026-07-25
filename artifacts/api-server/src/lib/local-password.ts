import crypto from 'crypto';

const HASH_PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

function scrypt(
  password: string,
  salt: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

export async function hashLocalPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = await scrypt(password, salt);
  return `${HASH_PREFIX}$${salt}$${derived.toString('hex')}`;
}

export async function verifyLocalPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const [prefix, salt, hashHex] = passwordHash.split('$');
  if (!prefix || !salt || !hashHex || prefix !== HASH_PREFIX) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, salt);

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}
