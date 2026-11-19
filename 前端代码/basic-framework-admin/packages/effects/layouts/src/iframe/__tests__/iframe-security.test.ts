/** 验证 iframe 地址协议白名单与同源 sandbox 沙箱降权规则。 */
import { describe, expect, it } from 'vitest';

import { resolveIframeSandbox, resolveSafeIframeSrc } from '../iframe-security';

/** IFrame 安全策略单测套件。 */
function describeIframeSecurity() {
  const origin = 'https://admin.example.com';

  it('仅放行同源绝对路径与 http/https 协议，拦截危险伪协议', () => {
    expect(resolveSafeIframeSrc('/doc.html')).toBe('/doc.html');
    expect(resolveSafeIframeSrc('https://docs.example.com/a?x=1')).toBe(
      'https://docs.example.com/a?x=1',
    );
    expect(resolveSafeIframeSrc('javascript:alert(1)')).toBe('');
    expect(resolveSafeIframeSrc('data:text/html,<h1>x</h1>')).toBe('');
    expect(resolveSafeIframeSrc('//evil.example.com')).toBe('');
    expect(resolveSafeIframeSrc('not a valid url')).toBe('');
  });

  it('同源地址强制移除 allow-same-origin，跨源地址保留跨源交互权限', () => {
    expect(resolveIframeSandbox('/doc.html', origin)).toBe(
      'allow-scripts allow-forms allow-popups',
    );
    expect(resolveIframeSandbox(`${origin}/report`, origin)).toBe(
      'allow-scripts allow-forms allow-popups',
    );
    expect(
      resolveIframeSandbox('https://partner.example.com/embed', origin),
    ).toBe('allow-scripts allow-same-origin allow-forms allow-popups');
  });
}

describe('iframeSecurity', describeIframeSecurity);
