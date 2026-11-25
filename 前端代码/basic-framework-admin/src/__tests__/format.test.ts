import { describe, expect, it } from 'vitest';

import { resolveSafeHttpUrl } from '@/utils/format';

describe('resolveSafeHttpUrl', () => {
  it('allows http, https, and relative paths', () => {
    expect(resolveSafeHttpUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(resolveSafeHttpUrl('http://127.0.0.1:48080/admin-api/infra/file/1/get/a.png')).toBe(
      'http://127.0.0.1:48080/admin-api/infra/file/1/get/a.png',
    );
    expect(resolveSafeHttpUrl('/admin-api/infra/file/1/get/a.png')).toMatch(
      /^https?:\/\/.+\/admin-api\/infra\/file\/1\/get\/a\.png$/,
    );
  });

  it('rejects javascript, data, vbscript, and empty URLs', () => {
    expect(resolveSafeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(resolveSafeHttpUrl('  JaVaScRiPt:alert(1) ')).toBeNull();
    expect(resolveSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(resolveSafeHttpUrl('vbscript:msgbox(1)')).toBeNull();
    expect(resolveSafeHttpUrl('')).toBeNull();
    expect(resolveSafeHttpUrl(undefined)).toBeNull();
  });
});
