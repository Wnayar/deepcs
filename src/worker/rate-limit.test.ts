import { describe, expect, it } from 'vitest';
import { limitByUid } from './rate-limit';

const limiter = (success: boolean) => ({ limit: async () => ({ success }) });

describe('limitByUid', () => {
  it('passes when under the limit', async () => {
    await expect(limitByUid(limiter(true), 'u')).resolves.toBeUndefined();
  });

  it('throws 429 over the limit', async () => {
    await expect(limitByUid(limiter(false), 'u')).rejects.toMatchObject({ status: 429 });
  });

  it('is a no-op when no binding is configured', async () => {
    await expect(limitByUid(undefined, 'u')).resolves.toBeUndefined();
  });
});
