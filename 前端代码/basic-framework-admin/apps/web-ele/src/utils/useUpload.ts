/**
 * 上传前校验工具：按上传类型校验文件 MIME 与大小，并给出中文错误提示。
 *
 * 图片 2MB、视频 10MB、语音 2MB，限额由类型决定并覆盖入参。
 * 只做浏览器端预校验，不发起上传，服务端仍需自行校验文件合法性。
 */
import type { UploadRawFile } from 'element-plus';

import { showErrorMessage } from '#/utils/feedback';

/** 上传校验类型：决定允许的 MIME 白名单与体积上限，同时作为提示文案中的类别名。 */
enum UploadType {
  Image = 'image',
  Video = 'video',
  Voice = 'voice',
}

/** 上传前校验函数，检查文件格式和大小是否符合要求 */
const useBeforeUpload = (type: UploadType, maxSizeMB: number) => {
  /**
   * 按类型校验单个文件的 MIME 与体积，并在不合规时给出对应的中文错误提示。
   *
   * @param rawFile 待校验的原始文件，取其浏览器识别的 MIME 与字节数
   * @returns 校验通过返回 true；MIME 不在白名单内或体积超过上限时返回 false
   */
  const fn = (rawFile: UploadRawFile): boolean => {
    let allowTypes: string[] = [];
    let name = '';

    switch (type) {
      case UploadType.Image: {
        allowTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/bmp',
          'image/jpg',
        ];
        maxSizeMB = 2;
        name = '图片';
        break;
      }
      case UploadType.Video: {
        allowTypes = ['video/mp4'];
        maxSizeMB = 10;
        name = '视频';
        break;
      }
      case UploadType.Voice: {
        allowTypes = [
          'audio/mp3',
          'audio/mpeg',
          'audio/wma',
          'audio/wav',
          'audio/amr',
        ];
        maxSizeMB = 2;
        name = '语音';
        break;
      }
    }
    // 格式不正确
    if (!allowTypes.includes(rawFile.type)) {
      showErrorMessage(`上传${name}格式不对!`);
      return false;
    }
    // 大小不正确
    if (rawFile.size / 1024 / 1024 > maxSizeMB) {
      showErrorMessage(`上传${name}大小不能超过${maxSizeMB}M!`);
      return false;
    }

    return true;
  };

  return fn;
};

export { UploadType, useBeforeUpload };
