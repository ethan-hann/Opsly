import { describe, expect, it } from 'vitest';

import { hashLocalPassword, verifyLocalPassword } from './local-password';

describe('local-password', () => {
  it('hashes and verifies a valid password', async () => {
    const hash = await hashLocalPassword('CorrectHorseBatteryStaple');
    await expect(
      verifyLocalPassword('CorrectHorseBatteryStaple', hash),
    ).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashLocalPassword('CorrectHorseBatteryStaple');
    await expect(verifyLocalPassword('wrong-password', hash)).resolves.toBe(
      false,
    );
  });

  it('rejects invalid hash formats', async () => {
    await expect(
      verifyLocalPassword('anything', 'invalid-format'),
    ).resolves.toBe(false);
  });
});
