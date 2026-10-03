/** 验证文件批删的部分完成状态可见，且刷新不会掩盖删除失败或借用新身份。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteFileList } from '#/api/infra/file';
import { advanceSession } from '#/utils/auth-session';

import { deleteFileBatchAndRefreshOnFailure } from './batch-delete';

vi.mock(
  '#/api/infra/file',
  /** 在服务边界模拟逐项持久化与失败，不替换协调逻辑。 */ () => ({
    deleteFileList: vi.fn(),
  }),
);

describe('文件批删失败后的状态恢复', /** 同时验证可见数据和原始失败结果。 */ () => {
  beforeEach(
    /** 每例使用独立身份并清除接口模拟。 */ () => {
      advanceSession();
      vi.mocked(deleteFileList).mockReset();
    },
  );

  it('第一项已删除第二项失败时，刷新列表且调用方仍观察原失败', /** 使用独立的服务端记录与页面记录证明部分完成可以被用户看到。 */ async () => {
    const stored = [1, 2];
    let visible = [...stored];
    const failure = new Error('第二个对象删除失败');
    vi.mocked(deleteFileList).mockImplementationOnce(
      /** 模拟后端已提交第一项后遇到存储故障。 */ async () => {
        stored.splice(0, 1);
        throw failure;
      },
    );
    await expect(
      deleteFileBatchAndRefreshOnFailure(
        [1, 2],
        /** 从服务端重新载入当前剩余记录。 */ async () => {
          visible = [...stored];
        },
      ),
    ).rejects.toBe(failure);
    expect(visible).toEqual([2]);
  });

  it('刷新失败仍保留删除和刷新两个异常', /** 刷新不可用不得把原删除失败覆盖成单一刷新错误。 */ async () => {
    const deletion = new Error('删除失败');
    const refresh = new Error('刷新失败');
    vi.mocked(deleteFileList).mockRejectedValueOnce(deletion);
    await expect(
      deleteFileBatchAndRefreshOnFailure(
        [1],
        /** 注入列表不可用的失败边界。 */ async () => {
          throw refresh;
        },
      ),
    ).rejects.toMatchObject({ errors: [deletion, refresh] });
  });

  it('退出后旧批删失败不查询新账号的文件', /** 删除请求悬挂期间切换身份，随后返回旧错误。 */ async () => {
    let reject!: /** 释放仍在进行的旧删除请求。 */ (error: Error) => void;
    vi.mocked(deleteFileList).mockImplementationOnce(
      /** 保持旧删除在途直到用例释放。 */ () =>
        new Promise(
          /** 保存失败注入句柄。 */ (_resolve, fail) => {
            reject = fail;
          },
        ),
    );
    const refresh = vi.fn();
    const request = deleteFileBatchAndRefreshOnFailure([1], refresh);
    const failure = new Error('旧身份删除失败');
    const rejected = expect(request).rejects.toBe(failure);
    advanceSession();
    reject(failure);
    await rejected;
    expect(refresh).not.toHaveBeenCalled();
  });
});
