import type { Ref } from 'vue';

import type { AxiosProgressEvent, InfraFileApi } from '#/api/core/file';

import { computed, unref } from 'vue';

import { useAppConfig } from '@vben/hooks';
import { $t } from '@vben/locales';

import { createFile, getFilePresignedUrl, uploadFile } from '#/api/core/file';
import { baseRequestClient } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/**
 * 上传类型
 */
enum UPLOAD_TYPE {
  // 客户端直接上传（只支持S3服务）
  CLIENT = 'client',
  // 客户端发送到后端上传
  SERVER = 'server',
}

/**
 * 安全读取运行时上传模式配置，避免单测或非标准宿主缺少全局配置对象时在模块加载期抛错。
 *
 * @returns 上传模式（client 或 server）
 */
function resolveUploadType(): string {
  const runtimeConf = (
    globalThis as { _VBEN_ADMIN_PRO_APP_CONF_?: { VITE_UPLOAD_TYPE?: string } }
  )._VBEN_ADMIN_PRO_APP_CONF_;
  return (
    runtimeConf?.VITE_UPLOAD_TYPE ||
    import.meta.env.VITE_UPLOAD_TYPE ||
    UPLOAD_TYPE.SERVER
  );
}

/**
 * 上传类型钩子函数
 *
 * @param options 上传限制的响应式参数
 * @param options.acceptRef 接受的文件类型
 * @param options.helpTextRef 帮助文本
 * @param options.maxNumberRef 最大文件数量
 * @param options.maxSizeRef 最大文件大小
 * @returns 文件类型限制和帮助文本的计算属性
 */
export function useUploadType({
  acceptRef,
  helpTextRef,
  maxNumberRef,
  maxSizeRef,
}: {
  acceptRef: Ref<string[]>;
  helpTextRef: Ref<string>;
  maxNumberRef: Ref<number>;
  maxSizeRef: Ref<number>;
}) {
  // 文件类型限制
  const getAccept = computed(() => {
    const accept = unref(acceptRef);
    if (accept && accept.length > 0) {
      return accept;
    }
    return [];
  });
  const getStringAccept = computed(() => {
    return unref(getAccept)
      .map((item) => {
        return item.indexOf('/') > 0 || item.startsWith('.')
          ? item
          : `.${item}`;
      })
      .join(',');
  });

  // 支持jpg、jpeg、png格式，不超过2M，最多可选择10张图片，。
  const getHelpText = computed(() => {
    const helpText = unref(helpTextRef);
    if (helpText) {
      return helpText;
    }
    const helpTexts: string[] = [];

    const accept = unref(acceptRef);
    if (accept.length > 0) {
      helpTexts.push($t('ui.upload.accept', [accept.join(',')]));
    }

    const maxSize = unref(maxSizeRef);
    if (maxSize) {
      helpTexts.push($t('ui.upload.maxSize', [maxSize]));
    }

    const maxNumber = unref(maxNumberRef);
    if (maxNumber && maxNumber !== Infinity) {
      helpTexts.push($t('ui.upload.maxNumber', [maxNumber]));
    }
    return helpTexts.join('，');
  });
  return { getAccept, getStringAccept, getHelpText };
}

/**
 * 上传钩子函数
 * @param directory 上传目录
 * @returns 上传 URL 和自定义上传方法
 */
export function useUpload(directory?: string) {
  // 后端上传地址
  const uploadUrl = getUploadUrl();
  // 是否使用前端直连上传
  const isClientUpload = UPLOAD_TYPE.CLIENT === resolveUploadType();
  // 重写ElUpload上传方法
  async function httpRequest(
    file: File,
    onUploadProgress?: AxiosProgressEvent,
  ) {
    // 模式一：前端上传
    if (isClientUpload) {
      // 1.1 生成文件名称
      const fileName = await generateFileName(file);
      // 1.2 获取文件预签名地址
      const presignedInfo = await getFilePresignedUrl(fileName, directory);
      // 1.3 上传文件到对象存储（透传后端签名绑定的 Content-Type，防止浏览器 MIME 差异触发 SigV4 403）
      const contentType =
        presignedInfo.contentType || file.type || 'application/octet-stream';
      await baseRequestClient.put(presignedInfo.uploadUrl, file, {
        headers: {
          'Content-Type': contentType,
        },
        onUploadProgress,
        timeout: 120_000,
      });
      // 1.4 同步等待后端元数据登记成功，并返回与后端上传模式一致的 URL 字符串
      await createFile0(presignedInfo, file);
      return presignedInfo.url;
    } else {
      // 模式二：后端上传
      return uploadFile({ file, directory }, onUploadProgress);
    }
  }

  return {
    uploadUrl,
    httpRequest,
  };
}

/**
 * 获得上传 URL
 */
export function getUploadUrl(): string {
  return `${apiURL}/infra/file/upload`;
}

/**
 * 将已直传对象存储的文件元数据登记到后端。
 *
 * @param vo 文件预签名信息
 * @param file 原始文件对象
 * @returns 登记完成后的文件记录编号
 */
async function createFile0(
  vo: InfraFileApi.FilePresignedUrlRespVO,
  file: File,
) {
  return createFile({
    name: file.name,
    path: vo.path,
    size: file.size,
    type: file.type,
    url: vo.url,
  });
}

/**
 * 返回原始文件名；实际唯一对象路径由后端 presigned-url 接口规范化生成。
 *
 * @param file 要上传的文件
 * @returns 原始文件名
 */
async function generateFileName(file: File) {
  return file.name;
}
