/** 直传预约、暂存上传与完成登记的顺序边界，防止提前成功和跨身份续传。 */
import type { AxiosProgressEvent } from '#/api/core/file';

import { createFile, getFilePresignedUrl } from '#/api/core/file';
import { baseRequestClient } from '#/api/request';
import { assertCurrentSession, getSessionEpoch } from '#/utils/auth-session';

/**
 * 上传暂存对象后等待服务端验证与元数据提交，任何失败都保留失败结果。
 * @param file 当前身份选择的文件
 * @param directory 可选业务目录
 * @param onUploadProgress 暂存对象上传进度；完成登记成功前不代表整个任务成功
 * @returns 已完成登记的最终访问地址
 * @throws 预约、对象上传、登记失败或会话切换时拒绝
 */
export async function uploadDirect(
  file: File,
  directory?: string,
  onUploadProgress?: AxiosProgressEvent,
): Promise<string> {
  const epoch = getSessionEpoch();
  const reservation = await getFilePresignedUrl(
    file.name,
    file.size,
    directory,
  );
  assertCurrentSession(epoch);
  await baseRequestClient.put(reservation.uploadUrl, file, {
    headers: reservation.headers,
    onUploadProgress,
  });
  assertCurrentSession(epoch);
  await createFile({
    path: reservation.path,
    name: file.name,
    url: reservation.url,
    type: file.type,
    size: file.size,
  });
  assertCurrentSession(epoch);
  return reservation.url;
}
