import { describe, expect, it } from 'vitest';

import { matchPermission } from '@/directives/permission';

describe('permission matching', () => {
  it('matches wildcard super permission and explicit permission codes', () => {
    expect(matchPermission('system:user:create', ['*:*:*'])).toBe(true);
    expect(
      matchPermission('system:user:create', ['system:user:query', 'system:user:create']),
    ).toBe(true);
    expect(matchPermission('system:user:delete', ['system:user:query'])).toBe(false);
    expect(
      matchPermission(['system:user:delete', 'system:user:update'], ['system:user:update']),
    ).toBe(true);
    expect(matchPermission(undefined, [])).toBe(true);
  });
});
