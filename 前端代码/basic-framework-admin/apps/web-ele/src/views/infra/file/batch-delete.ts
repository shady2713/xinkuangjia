/** 文件批删允许部分完成，失败后重新读取当前身份的剩余文件并保留原失败。 */
import { deleteFileList } from '#/api/infra/file';
import { getSessionEpoch, isCurrentSession } from '#/utils/auth-session';

/** 批量删除文件；失败时刷新真实列表，旧身份的迟到失败不得发起新身份请求。
 * @param ids 用户确认删除的文件编号。
 * @param refresh 重新查询列表并清除过期选择项的动作。
 * @returns 全部删除完成；成功后的常规刷新由 CRUD 动作执行。
 * @throws {Error} 删除失败时保留原异常；刷新也失败时同时保留两项失败。
 */
export async function deleteFileBatchAndRefreshOnFailure(
  ids: number[],
  refresh: /** 从服务端更新当前可见文件。 */ () => Promise<void>,
): Promise<void> {
  const epoch = getSessionEpoch();
  try {
    await deleteFileList(ids);
  } catch (error) {
    if (isCurrentSession(epoch)) {
      try {
        await refresh();
      } catch (refreshError) {
        throw new AggregateError(
          [error, refreshError],
          '批量删除未全部完成，列表刷新失败，请手动刷新确认剩余文件。',
        );
      }
    }
    throw error;
  }
}
