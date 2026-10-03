/** 验证上传 HTTP 边界拒绝无效预约、未提交标记和不安全地址，不能靠泛型冒充真实响应。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { createFile, getFilePresignedUrl, uploadFile } from './file';

vi.mock(
  '#/api/request',
  /** 只控制远端字节解析后的未知响应。 */ () => ({
    requestClient: { get: vi.fn(), post: vi.fn(), upload: vi.fn() },
  }),
);

describe('上传响应契约', /** 正常响应和各类不可作为成功凭据的响应分别验证。 */ () => {
  beforeEach(
    /** 每例独立提供响应，不继承上例成功结果。 */ () => vi.resetAllMocks(),
  );

  it('按精确大小请求预约并只保留签名所需请求头', /** 不把额外远端字段展开成上传身份头。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue({
      path: 'files/reserved.txt',
      url: 'https://files.example.test/files/reserved.txt',
      uploadUrl: 'https://files.example.test/upload-staging/reserved',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment',
        Authorization: 'must-not-forward',
      },
    });
    const result = await getFilePresignedUrl('note.txt', 5, 'notes');
    expect(requestClient.get).toHaveBeenCalledWith(
      '/infra/file/presigned-url',
      {
        params: { name: 'note.txt', size: 5, directory: 'notes' },
      },
    );
    expect(result.headers).toEqual({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
    });
  });

  it.each([
    null,
    {},
    { path: 1 },
    {
      path: 'a',
      url: 'https://files.example.test/a',
      uploadUrl: 'https://files.example.test/staging',
      headers: {},
    },
  ])(
    '拒绝不完整预约 %j',
    /** 无签名请求头的旧响应不能绕过新协议。 */ async (value) => {
      vi.mocked(requestClient.get).mockResolvedValue(value);
      await expect(getFilePresignedUrl('note.txt', 5)).rejects.toThrow(
        '上传预约响应格式无效',
      );
    },
  );

  it.each([0, -1, null, '1', Number.MAX_SAFE_INTEGER + 1])(
    '拒绝无效登记编号 %j',
    /** 无有效编号不能将上传视作已登记。 */ async (value) => {
      vi.mocked(requestClient.post).mockResolvedValue(value);
      await expect(createFile({ path: 'reserved.txt' })).rejects.toThrow(
        '文件登记响应编号无效',
      );
    },
  );

  it('登记与后端上传接受有效结果', /** 两条正常路径分别返回已验证的编号和公开地址。 */ async () => {
    vi.mocked(requestClient.post).mockResolvedValue(123);
    await expect(createFile({ path: 'reserved.txt' })).resolves.toBe(123);
    vi.mocked(requestClient.upload).mockResolvedValue(
      'https://files.example.test/ready.txt',
    );
    await expect(
      uploadFile({ file: new File(['ok'], 'note.txt') }),
    ).resolves.toBe('https://files.example.test/ready.txt');
  });

  it.each([
    undefined,
    {},
    'javascript:alert(1)',
    'https://CHANGE_ME_USER:CHANGE_ME_PASSWORD@files.example.test/a',
  ])(
    '拒绝不可用上传地址 %j',
    /** 上传组件不能展示脚本 URL 或泄漏 URL 内嵌凭据。 */ async (value) => {
      vi.mocked(requestClient.upload).mockResolvedValue(value);
      await expect(
        uploadFile({ file: new File(['ok'], 'note.txt') }),
      ).rejects.toThrow('上传响应地址无效');
    },
  );
});
