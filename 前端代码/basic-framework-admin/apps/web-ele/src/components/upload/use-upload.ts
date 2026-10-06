/** 根据部署上传模式编排请求，只有对象与元数据均登记成功后才返回可用地址。 */
import type { Ref } from 'vue';

import type { AxiosProgressEvent } from '#/api/core/file';

import { computed, unref } from 'vue';

import { useAppConfig } from '@vben/hooks';
import { $t } from '@vben/locales';

import { uploadFile } from '#/api/core/file';

import { uploadDirect } from './upload-direct';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
const uploadType = window._VBEN_ADMIN_PRO_APP_CONF_.VITE_UPLOAD_TYPE;

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
  /** 把 accept 列表拼成 input 的 accept 字符串：已带斜杠或点号的原样使用，其余补点号。 */
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
  const isClientUpload = UPLOAD_TYPE.CLIENT === uploadType;
  /** 等待预约完成与持久化登记，失败必须由上传组件显示为失败。 */
  async function httpRequest(
    file: File,
    onUploadProgress?: AxiosProgressEvent,
  ) {
    return isClientUpload
      ? uploadDirect(file, directory, onUploadProgress)
      : uploadFile({ file, directory }, onUploadProgress);
  }

  return {
    uploadUrl,
    httpRequest,
  };
}

/**
 * 获得后端 multipart 上传入口地址。
 * @returns 与当前应用 API 根地址一致的上传 URL
 */
export function getUploadUrl(): string {
  return `${apiURL}/infra/file/upload`;
}
