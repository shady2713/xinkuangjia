<script lang="ts" setup>
/** 图片上传组件：支持卡片预览、批上传部分失败保留、resultField 透传与错误提示去重。 */
import type {
  UploadFile,
  UploadRawFile,
  UploadRequestOptions,
} from 'element-plus';

import type { FileUploadProps, UploadApiResult } from './typing';

import { computed, ref, toRefs, watch } from 'vue';

import { IconifyIcon } from '@vben/icons';
import { $t } from '@vben/locales';
import {
  defaultImageAccepts,
  isImage,
  isObject,
  isString,
  logError,
} from '@vben/utils';

import { ElDialog, ElUpload } from 'element-plus';

import {
  isErrorMessageHandled,
  showError,
  showErrorMessage,
  showSuccessMessage,
} from '#/utils/feedback';

import { UploadResultStatus } from './typing';
import { useUploadType } from './use-upload';
import {
  requestUpload,
  resolveUploadUrl,
  resolveUploadValue,
} from './use-upload-core';

defineOptions({ name: 'ImageUpload', inheritAttrs: false });

const props = withDefaults(defineProps<FileUploadProps>(), {
  value: () => [],
  modelValue: undefined,
  directory: undefined,
  disabled: false,
  listType: 'picture-card',
  helpText: '',
  maxSize: 2,
  maxNumber: 1,
  accept: () => defaultImageAccepts,
  multiple: false,
  api: undefined,
  resultField: '',
  showDescription: true,
});
/**
 * change：已上传图片值变化时触发，载荷为最新图片地址（字符串或字符串数组）。
 * update:value / update:modelValue：分别支持 v-model:value 和 v-model；modelValue 不为 undefined 时优先使用。
 * delete：删除某张已上传图片时触发，载荷为被删除图片的地址。
 */
const emit = defineEmits([
  'change',
  'update:value',
  'update:modelValue',
  'delete',
]);
const { accept, helpText, maxNumber, maxSize } = toRefs(props);
const isInnerOperate = ref<boolean>(false);
const { getStringAccept } = useUploadType({
  acceptRef: accept,
  helpTextRef: helpText,
  maxNumberRef: maxNumber,
  maxSizeRef: maxSize,
});

/** 计算当前绑定的值，优先使用 modelValue */
const currentValue = computed(() => {
  return props.modelValue === undefined ? props.value : props.modelValue;
});

/** 判断是否使用 modelValue */
const isUsingModelValue = computed(() => {
  return props.modelValue !== undefined;
});
const previewOpen = ref<boolean>(false); // 是否展示预览
const previewImage = ref<string>(''); // 预览图片
const previewTitle = ref<string>(''); // 预览标题

const fileList = ref<UploadFile[]>([]);
const isFirstRender = ref<boolean>(true); // 是否第一次渲染
const uploadNumber = ref<number>(0); // 上传文件计数器
const uploadList = ref<any[]>([]); // 临时上传列表

watch(
  currentValue,
  /**
   * 同步外部绑定值到本地预览文件列表，空值时清空列表。
   *
   * @param v 外部传入的单图地址或图片地址数组
   */
  async (v) => {
    if (isInnerOperate.value) {
      isInnerOperate.value = false;
      return;
    }
    let value: string | string[] = [];
    if (v && (!Array.isArray(v) || v.length > 0)) {
      if (Array.isArray(v)) {
        value = v;
      } else {
        value.push(v);
      }
      fileList.value = value
        .map((item, i) => {
          if (item && isString(item)) {
            return {
              uid: -i,
              name: item.slice(Math.max(0, item.lastIndexOf('/') + 1)),
              status: UploadResultStatus.SUCCESS,
              url: item,
            } as UploadFile;
          } else if (item && isObject(item)) {
            const file = item as unknown as Record<string, any>;
            return {
              uid: file.uid ?? -i,
              name: file.name ?? '',
              status: file.status ?? UploadResultStatus.SUCCESS,
              url: file.url,
            } as UploadFile;
          }
          return null;
        })
        .filter(Boolean) as UploadFile[];
    } else {
      // 外部将 v-model 置空或重置表单时必须清空内部预览列表，避免残留旧缩略图。
      fileList.value = [];
    }
    if (isFirstRender.value) {
      isFirstRender.value = false;
    } else {
      emit('change', value);
    }
  },
  {
    immediate: true,
    deep: true,
  },
);

/** 将文件转换为 Base64 格式 */
function getBase64<T extends ArrayBuffer | null | string>(file: File) {
  return new Promise<T>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.addEventListener('load', () => {
      resolve(reader.result as T);
    });
    reader.addEventListener('error', (error) => reject(error));
  });
}

/**
 * 处理图片预览；无远端地址时从本地原始文件生成预览图。
 *
 * @param file 待预览的上传文件项
 */
async function handlePreview(file: UploadFile) {
  if (!file.url) {
    if (!file.raw) {
      return;
    }
    file.url = await getBase64<string>(file.raw);
  }
  previewImage.value = file.url || '';
  previewOpen.value = true;
  previewTitle.value =
    file.name ||
    previewImage.value.slice(
      Math.max(0, previewImage.value.lastIndexOf('/') + 1),
    );
}

/** 处理文件删除 */
async function handleRemove(file: UploadFile) {
  if (fileList.value) {
    const index = fileList.value.findIndex((item) => item.uid === file.uid);
    index !== -1 && fileList.value.splice(index, 1);
    const value = getValue();
    isInnerOperate.value = true;
    emit('update:value', value);
    emit('update:modelValue', value);
    emit('change', value);
    emit('delete', file);
  }
}

/** 关闭预览弹窗 */
function handleCancel() {
  previewOpen.value = false;
  previewTitle.value = '';
}

/**
 * 上传前校验
 * @param file 待上传的文件
 * @returns 是否允许上传
 */
async function beforeUpload(file: File) {
  // 检查文件数量限制
  if (fileList.value!.length >= props.maxNumber) {
    showErrorMessage($t('ui.upload.maxNumber', [props.maxNumber]));
    return false;
  }

  const { maxSize, accept } = props;
  const isAct = isImage(file.name, accept);
  if (!isAct) {
    showErrorMessage($t('ui.upload.acceptUpload', [accept]));
    return false;
  }
  const isLt = file.size / 1024 / 1024 > maxSize;
  if (isLt) {
    showErrorMessage($t('ui.upload.maxSizeMultiple', [maxSize]));
    return false;
  }

  // 只有在验证通过后才增加计数器
  uploadNumber.value++;
  return true;
}

/** 自定义上传请求 */
async function customRequest(options: UploadRequestOptions) {
  try {
    const res = await requestUpload(props, options);

    // 处理上传成功后的逻辑
    handleUploadSuccess(res, options.file as File);

    options.onSuccess!(res);
    showSuccessMessage($t('ui.upload.uploadSuccess'));
  } catch (error: unknown) {
    logError('upload:image:request', error);
    options.onError!(error as never);
    handleUploadError(error);
  }
}

/**
 * 在本批所有上传请求均已结算（成功或失败）后，将已成功文件合并到 fileList 并同步触发 v-model 更新。
 */
function flushUploadedBatch() {
  if (uploadList.value.length < uploadNumber.value) {
    return;
  }
  if (uploadList.value.length > 0) {
    fileList.value?.push(...uploadList.value);
    uploadList.value = [];
    const value = getValue();
    isInnerOperate.value = true;
    emit('update:value', value);
    emit('update:modelValue', value);
    emit('change', value);
  }
  uploadNumber.value = 0;
}

/**
 * 处理单个图片上传成功：清除临时占位、保留原始响应以支持 resultField，并尝试提交本批成功项。
 *
 * @param res 上传响应结果
 * @param file 上传的原始文件
 */
function handleUploadSuccess(res: UploadApiResult, file: File) {
  // 优先按 Element Plus 分配的 uid 匹配临时占位项，重名文件时回退按文件名匹配
  const rawUid = (file as Partial<UploadRawFile>).uid;
  let index =
    rawUid === undefined
      ? -1
      : (fileList.value?.findIndex((item) => item.uid === rawUid) ?? -1);
  if (index === -1) {
    index = fileList.value?.findIndex((item) => item.name === file.name) ?? -1;
  }
  if (index !== -1) {
    fileList.value?.splice(index, 1);
  }

  // 保留 response 与 raw 字段以支持 resultField 解析及私有图片本地预览
  const fileUrl = resolveUploadUrl(res);
  uploadList.value.push({
    name: file.name,
    raw: file as UploadRawFile,
    response: res,
    status: UploadResultStatus.SUCCESS,
    uid: rawUid ?? Date.now() + uploadList.value.length,
    url: fileUrl,
  });

  flushUploadedBatch();
}

/**
 * 处理单个图片上传失败：仅在未被全局请求拦截器提示过时弹窗，并在其余成功项存在时触发批次提交。
 *
 * @param error 上传失败抛出的异常对象
 */
function handleUploadError(error: unknown) {
  logError('upload:image:error', error);
  if (!isErrorMessageHandled(error)) {
    showError(error, $t('ui.upload.uploadError'));
  }
  uploadNumber.value = Math.max(0, uploadNumber.value - 1);
  flushUploadedBatch();
}

/**
 * 获取当前文件列表的值
 * @returns 文件 URL 列表或字符串
 */
function getValue() {
  const list = (fileList.value || [])
    .filter((item) => item?.status === UploadResultStatus.SUCCESS)
    .map((item: UploadFile) => {
      return resolveUploadValue(item, props.resultField);
    });

  // 单个文件的情况，根据输入参数类型决定返回格式
  if (props.maxNumber === 1) {
    const singleValue = list.length > 0 ? list[0] : '';
    // 如果原始值是字符串或 modelValue 是字符串，返回字符串
    if (
      isString(props.value) ||
      (isUsingModelValue.value && isString(props.modelValue))
    ) {
      return singleValue;
    }
    return singleValue;
  }

  // 多文件情况，根据输入参数类型决定返回格式
  if (isUsingModelValue.value) {
    return Array.isArray(props.modelValue) ? list : list.join(',');
  }

  return Array.isArray(props.value) ? list : list.join(',');
}
</script>

<template>
  <div>
    <ElUpload
      v-bind="$attrs"
      v-model:file-list="fileList"
      :accept="getStringAccept"
      :before-upload="beforeUpload"
      :http-request="customRequest"
      :disabled="disabled"
      :list-type="listType"
      :limit="maxNumber"
      :multiple="multiple"
      :on-preview="handlePreview"
      :on-remove="handleRemove"
      :class="{ 'upload-limit-reached': fileList.length >= maxNumber }"
    >
      <div class="flex flex-col items-center justify-center">
        <IconifyIcon icon="lucide:cloud-upload" :size="24" />
        <div class="mt-2">{{ $t('ui.upload.imgUpload') }}</div>
      </div>
    </ElUpload>
    <div
      v-if="showDescription"
      class="mt-2 flex flex-wrap items-center text-sm"
    >
      请上传不超过
      <span class="mx-1 font-bold text-primary">{{ maxSize }}MB</span>
      的
      <span class="mx-1 font-bold text-primary">{{ accept.join('/') }}</span>
      格式文件
    </div>
    <ElDialog v-model="previewOpen" :title="previewTitle" @close="handleCancel">
      <img :src="previewImage" alt="" class="w-full" />
    </ElDialog>
  </div>
</template>

<style scoped>
.el-upload--picture-card {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 达到上传限制时隐藏上传按钮 */
.upload-limit-reached :deep(.el-upload--picture-card) {
  display: none;
}
</style>
