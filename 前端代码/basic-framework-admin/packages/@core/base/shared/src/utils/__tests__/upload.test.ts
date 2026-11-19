/**
 * 上传辅助工具安全性与扩展名正则转义回归测试。
 *
 * @author shady2713
 */
import { describe, expect, it } from 'vitest';

import { checkFileType, defaultImageAccepts, isImage } from '../upload';

describe('upload helpers', () => {
  it('默认图片白名单排除 svg，防止矢量脚本绕过', () => {
    expect(defaultImageAccepts).not.toContain('svg');
    expect(isImage('avatar.png')).toBe(true);
    expect(isImage('xss.svg')).toBe(false);
  });

  it('checkFileType 正确转义带点号和正则元字符的扩展名', () => {
    const pngFile = new File(['x'], 'demo.png');
    const badFile = new File(['x'], 'demo_png');
    const specialFile = new File(['x'], 'file.c++');

    expect(checkFileType(pngFile, ['.png', 'jpg'])).toBe(true);
    expect(checkFileType(badFile, ['.png'])).toBe(false);
    expect(checkFileType(specialFile, ['c++'])).toBe(true);
  });
});
