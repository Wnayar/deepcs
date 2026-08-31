import { describe, expect, test } from 'vitest';
import { limitByUid } from './rate-limit';

const limiter = (success: boolean) => ({ limit: async () => ({ success }) });

describe('limitByUid', () => {
  /**
   * The ordinary path. Success is silent and returns nothing, so a route can
   * call this and carry on rather than branch on a verdict.
   */
  test('passes when under the limit', async () => {
    // Arrange
    const underLimit = limiter(true);

    // Act
    const spend = limitByUid(underLimit, 'u');

    // Assert
    await expect(spend).resolves.toBeUndefined();
  });

  /**
   * Refusal has to arrive as a throw. Every mutating route relies on the throw
   * to abandon the request; a returned false would be dropped on the floor and
   * the request would go through anyway.
   */
  test('throws 429 over the limit', async () => {
    // Arrange
    const overLimit = limiter(false);

    // Act
    const spend = limitByUid(overLimit, 'u');

    // Assert
    await expect(spend).rejects.toMatchObject({ status: 429 });
  });

  /**
   * The binding is an edge feature that does not exist locally, so both test
   * layers and every `wrangler dev` run pass undefined here. If that refused
   * or threw, nothing that writes could be exercised offline.
   */
  test('is a no-op when no binding is configured', async () => {
    // Arrange, the shape of an environment with no rate limit binding
    const noBinding = undefined;

    // Act
    const spend = limitByUid(noBinding, 'u');

    // Assert
    await expect(spend).resolves.toBeUndefined();
  });
});
