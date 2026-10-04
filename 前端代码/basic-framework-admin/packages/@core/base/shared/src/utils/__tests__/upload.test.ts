/** 上传辅助工具的测试：accept 属性拼装、文件名解析、类型判定与文件大小/图标展示。 */
import { describe, expect, it } from 'vitest';

import {
  checkFileType,
  defaultImageAccepts,
  formatFileSize,
  generateAcceptedFileTypes,
  getFileIcon,
  getFileNameFromUrl,
  getFileTypeClass,
  isImage,
} from '../upload';

/** 覆盖 accept 映射表里每一种已支持类型，用于验证每个分支都会产出 MIME。 */
const ALL_SUPPORTED_TYPES = [
  'txt',
  'pdf',
  'html',
  'htm',
  'csv',
  'xlsx',
  'xls',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'xml',
  'md',
  'markdown',
  'epub',
  'eml',
  'msg',
];

/** 从 accept 属性串里取出 MIME 段，用于比较不同扩展名的 MIME 映射是否一致。
 * @param types 业务侧的类型清单。
 * @returns 该类型清单对应的 MIME 列表，不含以点开头的扩展名段。
 */
function mimeTypesOf(types: string[]): string[] {
  return generateAcceptedFileTypes(types)
    .split(',')
    .filter(
      /** 过滤掉以点开头的扩展名段。 */ (value) => !value.startsWith('.'),
    );
}

describe('generateAcceptedFileTypes', /** 把业务侧的类型清单翻译成浏览器 accept 属性需要的 MIME 与扩展名列表。 */ () => {
  it('覆盖全部受支持类型时产出完整 MIME 列表', /** 缺一个分支就会让该类文件在选择器里被过滤掉。 */ () => {
    const accept = generateAcceptedFileTypes(ALL_SUPPORTED_TYPES).split(',');

    expect(accept).toEqual([
      'text/plain',
      'application/pdf',
      'text/html',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/xml',
      'text/xml',
      'text/markdown',
      'application/epub+zip',
      'message/rfc822',
      'application/vnd.ms-outlook',
      '.txt',
      '.pdf',
      '.html',
      '.htm',
      '.csv',
      '.xlsx',
      '.xls',
      '.docx',
      '.doc',
      '.pptx',
      '.ppt',
      '.xml',
      '.md',
      '.markdown',
      '.epub',
      '.eml',
      '.msg',
    ]);
  });

  it('输入大写扩展名时统一转小写', /** 业务配置里可能写成大写，浏览器 accept 只认小写扩展名。 */ () => {
    expect(generateAcceptedFileTypes(['PDF'])).toBe('application/pdf,.pdf');
  });

  it('未知类型只产出扩展名', /** 没有 MIME 映射的类型仍要能通过扩展名匹配。 */ () => {
    expect(generateAcceptedFileTypes(['zip'])).toBe('.zip');
  });

  it('空清单返回空串', /** 不限制类型时 accept 应为空，而不是一个逗号。 */ () => {
    expect(generateAcceptedFileTypes([])).toBe('');
  });

  it('新旧扩展名别名命中同一条 MIME', /** xls 与 xlsx、doc 与 docx 必须映射到同一组 MIME，只有扩展名后缀不同。 */ () => {
    expect(mimeTypesOf(['xls'])).toEqual(mimeTypesOf(['xlsx']));
    expect(mimeTypesOf(['doc'])).toEqual(mimeTypesOf(['docx']));
  });
});

describe('getFileNameFromUrl', /** 从下载地址里取回可展示的文件名，无法解析时给出确定的兜底值。 */ () => {
  it('空值返回 unknown', /** 附件地址缺失时不能返回 undefined 让链接显示空白。 */ () => {
    expect(getFileNameFromUrl(undefined)).toBe('unknown');
    expect(getFileNameFromUrl(null)).toBe('unknown');
    expect(getFileNameFromUrl('')).toBe('unknown');
  });

  it('解析标准 URL 的末段文件名', /** 下载地址末段就是文件名。 */ () => {
    expect(getFileNameFromUrl('https://host.com/files/report.pdf')).toBe(
      'report.pdf',
    );
  });

  it('解码百分号编码的中文名', /** 对象存储里的中文名会被编码，必须还原才能展示。 */ () => {
    expect(
      getFileNameFromUrl('https://host.com/files/%E6%8A%A5%E8%A1%A8.pdf'),
    ).toBe('报表.pdf');
  });

  it('路径以斜杠结尾时返回 unknown', /** 目录地址没有文件名，不能返回空串。 */ () => {
    expect(getFileNameFromUrl('https://host.com/files/')).toBe('unknown');
  });

  it('非法 URL 退化为按斜杠截取', /** 后端返回相对路径时也要能取到末段。 */ () => {
    expect(getFileNameFromUrl('/static/docs/manual.docx')).toBe('manual.docx');
  });

  it('带查询串的地址去掉参数', /** 带签名的下载地址不能把查询参数当成文件名。 */ () => {
    expect(
      getFileNameFromUrl('https://host.com/files/report.pdf?token=DUMMY'),
    ).toBe('report.pdf');
  });
});

describe('isImage', /** 判断文件名是否为图片，决定预览还是只提供下载。 */ () => {
  it('默认图片类型包含常见格式', /** 预览能力覆盖主流图片格式。 */ () => {
    expect(defaultImageAccepts).toContain('png');
    expect(defaultImageAccepts).toContain('webp');
  });

  it('按默认清单识别图片', /** png 与 webp 属于默认图片类型。 */ () => {
    expect(isImage('photo.PNG')).toBe(true);
    expect(isImage('photo.webp')).toBe(true);
  });

  it('非图片文件返回 false', /** pdf 不能走图片预览。 */ () => {
    expect(isImage('report.pdf')).toBe(false);
  });

  it('文件名为空时返回 false', /** 缺文件名时不能猜测类型。 */ () => {
    expect(isImage(undefined)).toBe(false);
    expect(isImage(null)).toBe(false);
    expect(isImage('')).toBe(false);
  });

  it('允许列表为空时一律返回 false', /** 调用方显式清空列表表示不启用图片识别。 */ () => {
    expect(isImage('photo.png', [])).toBe(false);
  });

  it('按调用方自定义的列表判定', /** 部分场景只允许特定图片格式。 */ () => {
    expect(isImage('photo.gif', ['gif'])).toBe(true);
    expect(isImage('photo.png', ['gif'])).toBe(false);
  });
});

describe('checkFileType', /** 依据扩展名校验文件是否在允许范围内，忽略大小写。 */ () => {
  it('允许列表为空时不做限制', /** 未配置限制时任何文件都应放行。 */ () => {
    expect(checkFileType(new File([], 'any.exe'), [])).toBe(true);
  });

  it('扩展名命中时放行', /** 允许 pdf 时 pdf 文件应通过。 */ () => {
    expect(checkFileType(new File([], 'report.pdf'), ['pdf'])).toBe(true);
  });

  it('扩展名未命中时拒绝', /** exe 不在允许列表内必须被拦下。 */ () => {
    expect(checkFileType(new File([], 'tool.exe'), ['pdf', 'docx'])).toBe(
      false,
    );
  });

  it('大写扩展名同样命中', /** 浏览器给出的文件名大小写不可控。 */ () => {
    expect(checkFileType(new File([], 'REPORT.PDF'), ['pdf'])).toBe(true);
  });

  it('只匹配结尾而不是子串', /** a.pdf.exe 不能因为含 pdf 就被放行。 */ () => {
    expect(checkFileType(new File([], 'a.pdf.exe'), ['pdf'])).toBe(false);
  });
});

describe('formatFileSize', /** 按 1024 进制把字节数转成人类可读的大小。 */ () => {
  it('零字节显示 0 B', /** 空文件不能显示成 0.00 B。 */ () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('不足 1KB 时按字节显示', /** 512 字节保留在 B 档。 */ () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('按 KB 档显示并去掉多余的零', /** 1536 字节是 1.5 KB，末尾的 0 要去掉。 */ () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('向上取整到更高单位', /** 超过 1MB 后单位切换为 MB。 */ () => {
    expect(formatFileSize(1024 * 1024 * 3.25)).toBe('3.25 MB');
  });

  it('按传入位数保留小数', /** 某些表格需要更多精度。 */ () => {
    expect(formatFileSize(1536, 3)).toBe('1.5 KB');
    expect(formatFileSize(1234, 1)).toBe('1.2 KB');
  });
});

describe('getFileIcon', /** 按扩展名返回 Lucide 图标名，未知类型落到通用文件图标。 */ () => {
  it('图片使用图片图标', /** 图片用专用图标区分。 */ () => {
    expect(getFileIcon('photo.png')).toBe('lucide:image');
  });

  it('文档类使用文本图标', /** pdf 与 doc/docx 共用文本图标。 */ () => {
    expect(getFileIcon('report.pdf')).toBe('lucide:file-text');
    expect(getFileIcon('report.doc')).toBe('lucide:file-text');
    expect(getFileIcon('report.docx')).toBe('lucide:file-text');
  });

  it('表格类使用表格图标', /** xls/xlsx 共用表格图标。 */ () => {
    expect(getFileIcon('book.xls')).toBe('lucide:file-spreadsheet');
    expect(getFileIcon('book.xlsx')).toBe('lucide:file-spreadsheet');
  });

  it('演示类使用演示图标', /** ppt/pptx 共用演示图标。 */ () => {
    expect(getFileIcon('deck.ppt')).toBe('lucide:presentation');
    expect(getFileIcon('deck.pptx')).toBe('lucide:presentation');
  });

  it('音频类使用音乐图标', /** 常见音频格式归为音乐。 */ () => {
    for (const name of ['a.aac', 'a.m4a', 'a.mp3', 'a.wav']) {
      expect(getFileIcon(name)).toBe('lucide:music');
    }
  });

  it('视频类使用视频图标', /** 常见视频格式归为视频。 */ () => {
    for (const name of ['v.avi', 'v.mov', 'v.mp4', 'v.wmv']) {
      expect(getFileIcon(name)).toBe('lucide:video');
    }
  });

  it('大写扩展名同样命中', /** 文件名大小写不可控。 */ () => {
    expect(getFileIcon('REPORT.PDF')).toBe('lucide:file-text');
  });

  it('未知类型与缺名都落到通用图标', /** 兜底图标保证列表始终有可显示的图形。 */ () => {
    expect(getFileIcon('archive.zip')).toBe('lucide:file');
    expect(getFileIcon(undefined)).toBe('lucide:file');
    expect(getFileIcon(null)).toBe('lucide:file');
  });
});

describe('getFileTypeClass', /** 与图标分类保持同一套 Tailwind 渐变色，未知类型落到灰色。 */ () => {
  it('图片使用暖色渐变', /** 图片卡片用暖色区分。 */ () => {
    expect(getFileTypeClass('photo.png')).toBe('from-yellow-400 to-orange-500');
  });

  it('文档类按类型给出不同渐变', /** pdf、doc、xls、ppt 的配色各不相同。 */ () => {
    expect(getFileTypeClass('report.pdf')).toBe('from-red-500 to-red-700');
    expect(getFileTypeClass('report.docx')).toBe('from-blue-600 to-blue-800');
    expect(getFileTypeClass('book.xlsx')).toBe('from-green-600 to-green-800');
    expect(getFileTypeClass('deck.pptx')).toBe('from-orange-600 to-orange-800');
  });

  it('音频类使用紫色渐变', /** 音频与视频用不同配色区分。 */ () => {
    expect(getFileTypeClass('a.mp3')).toBe('from-purple-500 to-purple-700');
  });

  it('视频类与 pdf 共用红色渐变', /** 视频当前与 pdf 使用同一组红色。 */ () => {
    expect(getFileTypeClass('v.mp4')).toBe('from-red-500 to-red-700');
  });

  it('未知类型与缺名都落到灰色渐变', /** 兜底配色保持列表可读。 */ () => {
    expect(getFileTypeClass('archive.zip')).toBe('from-gray-500 to-gray-700');
    expect(getFileTypeClass(undefined)).toBe('from-gray-500 to-gray-700');
    expect(getFileTypeClass(null)).toBe('from-gray-500 to-gray-700');
  });
});
