/** 验证暂存对象成功不等于文件登记成功，以及多步请求始终归属原身份。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFile, getFilePresignedUrl } from '#/api/core/file';
import { baseRequestClient } from '#/api/request';
import { advanceSession, SessionChangedError } from '#/utils/auth-session';

import { uploadDirect } from './upload-direct';

vi.mock(
  '#/api/core/file',
  /** 仅控制服务端预约与登记边界。 */ () => ({
    createFile: vi.fn(),
    getFilePresignedUrl: vi.fn(),
  }),
);
vi.mock(
  '#/api/request',
  /** 仅控制 S3 传输完成时机。 */ () => ({
    baseRequestClient: { put: vi.fn() },
  }),
);

/** 创建可释放的外部请求，避免用固定睡眠猜测异步顺序。 */
function pending<T>() {
  let resolve!: /** 交还指定外部结果。 */ (value: T) => void;
  let reject!: /** 注入外部失败。 */ (error: Error) => void;
  const promise = new Promise<T>(
    /** 保存由用例显式控制的边界。 */ (accept, fail) => {
      resolve = accept;
      reject = fail;
    },
  );
  return { promise, resolve, reject };
}

describe('直传完成边界', /** 每个场景实际运行预约到完成的编排逻辑。 */ () => {
  const reservation = {
    path: 'owned/final.txt',
    url: 'https://files.example.test/owned/final.txt',
    uploadUrl: 'https://files.example.test/upload-staging/unique',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
    },
  };

  beforeEach(
    /** 清除所有外部响应并切换为独立测试身份。 */ () => {
      vi.resetAllMocks();
      advanceSession();
      vi.mocked(getFilePresignedUrl).mockResolvedValue(reservation);
      vi.mocked(baseRequestClient.put).mockResolvedValue(undefined);
      vi.mocked(createFile).mockResolvedValue(1);
    },
  );

  it('等登记完成才返回地址并传递精确大小和签名头', /** 对象传输成功但登记悬挂时仍不通知成功。 */ async () => {
    const completion = pending<number>();
    const reached = pending<undefined>();
    vi.mocked(createFile).mockImplementationOnce(
      /** 显式标记已进入登记边界。 */ () => {
        reached.resolve(undefined);
        return completion.promise;
      },
    );
    const result = uploadDirect(new File(['hello'], 'note.txt'), 'notes');
    const settled = vi.fn();
    void result.then(settled);
    await reached.promise;
    expect(settled).not.toHaveBeenCalled();
    expect(getFilePresignedUrl).toHaveBeenCalledWith('note.txt', 5, 'notes');
    expect(baseRequestClient.put).toHaveBeenCalledWith(
      reservation.uploadUrl,
      expect.any(File),
      {
        headers: reservation.headers,
        onUploadProgress: undefined,
      },
    );
    completion.resolve(1);
    await expect(result).resolves.toBe(reservation.url);
  });

  it('登记失败保持失败', /** 上传组件不得因 PUT 成功吞掉数据库失败。 */ async () => {
    const failure = new Error('登记未完成');
    vi.mocked(createFile).mockRejectedValueOnce(failure);
    await expect(uploadDirect(new File(['hello'], 'note.txt'))).rejects.toBe(
      failure,
    );
  });

  it('对象传输失败不登记', /** 存储拒绝不能制造可用文件记录。 */ async () => {
    const failure = new Error('对象存储拒绝');
    vi.mocked(baseRequestClient.put).mockRejectedValueOnce(failure);
    await expect(uploadDirect(new File(['hello'], 'note.txt'))).rejects.toBe(
      failure,
    );
    expect(createFile).not.toHaveBeenCalled();
  });

  it('对象上传期间换账号后不借用新账号登记', /** 将身份切换放在无认证 S3 请求与认证登记之间。 */ async () => {
    const upload = pending<undefined>();
    const reached = pending<undefined>();
    vi.mocked(baseRequestClient.put).mockImplementationOnce(
      /** 暂停真实编排的对象边界。 */ () => {
        reached.resolve(undefined);
        return upload.promise;
      },
    );
    const result = uploadDirect(new File(['hello'], 'note.txt'));
    const assertion =
      expect(result).rejects.toBeInstanceOf(SessionChangedError);
    await reached.promise;
    advanceSession();
    upload.resolve(undefined);
    await assertion;
    expect(createFile).not.toHaveBeenCalled();
  });

  it('登记期间换账号后不发布旧地址', /** 已提交文件留待原身份管理，不写入新身份界面。 */ async () => {
    const completion = pending<number>();
    const reached = pending<undefined>();
    vi.mocked(createFile).mockImplementationOnce(
      /** 悬挂已发出的原身份登记。 */ () => {
        reached.resolve(undefined);
        return completion.promise;
      },
    );
    const result = uploadDirect(new File(['hello'], 'note.txt'));
    const assertion =
      expect(result).rejects.toBeInstanceOf(SessionChangedError);
    await reached.promise;
    advanceSession();
    completion.resolve(1);
    await assertion;
  });
});
