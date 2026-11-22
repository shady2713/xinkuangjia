<script lang="ts" setup>
/** 多文件上传组件：支持类型与大小校验、批上传部分失败保留及错误提示去重。 */
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
  checkFileType,
  isObject,
  isString,
  logError,
  openWindow,
} from '@vben/utils';

import { ElButton, ElUpload } from 'element-plus';

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

defineOptions({ name: 'FileUpload', inheritAttrs: false });

const props = withDefaults(defineProps<FileUploadProps>(), {
  value: () => [],
  modelValue: undefined,
  directory: undefined,
  disabled: false,
  drag: false,
  helpText: '',
  maxSize: 2,
  maxNumber: 1,
  accept: () => [],
  multiple: false,
  api: undefined,
  resultField: '',
  showDescription: false,
});
/**
 * change：已上传文件值变化时触发，载荷为最新文件值（字符串或字符串数组）。
 * update:value / update:modelValue：分别支持 v-model:value 和 v-model；modelValue 不为 undefined 时优先使用。
 * delete：删除某个已上传文件时触发，载荷为被删除文件的值。
 * preview：点击预览已上传文件时触发，载荷为文件地址。
 */
const emit = defineEmits([
  'change',
  'update:value',
  'update:modelValue',
  'delete',
  'preview',
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

const fileList = ref<UploadFile[]>([]);
const isFirstRender = ref<boolean>(true); // 是否第一次渲染
const uploadNumber = ref<number>(0); // 上传文件计数器
const uploadList = ref<any[]>([]); // 临时上传列表

watch(
  currentValue,
  /**
   * 同步外部绑定值到本地文件列表并在非首次渲染时触发 change 事件。
   *
   * @param v 外部传入的文件地址或地址数组
   */
  (v) => {
    if (isInnerOperate.value) {
      isInnerOperate.value = false;
      return;
    }
    let value: string[] = [];
    if (v) {
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
      // 值为空时清空文件列表
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

/** 处理文件删除 */
function handleRemove(file: UploadFile) {
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

/** 处理文件预览 */
function handlePreview(file: UploadFile) {
  emit('preview', file);
  if (file.url) {
    openWindow(file.url);
  }
}

/** 处理文件数量超限 */
function handleExceed() {
  showErrorMessage($t('ui.upload.maxNumber', [maxNumber.value]));
}

/**
 * 处理单个文件上传失败：仅在未被全局请求拦截器提示过时弹窗，并在其余成功项存在时触发批次提交。
 *
 * @param error 上传失败抛出的异常对象
 */
function handleUploadError(error: unknown) {
  logError('upload:file:error', error);
  if (!isErrorMessageHandled(error)) {
    showError(error, $t('ui.upload.uploadError'));
  }
  uploadNumber.value = Math.max(0, uploadNumber.value - 1);
  flushUploadedBatch();
}

/**
 * 上传前校验文件数量、类型与体积边界。
 *
 * @param file 待上传的文件
 * @returns 是否允许上传
 */
function beforeUpload(file: File) {
  // 检查文件数量限制（使用 getValue 获取实际已上传的文件数量）
  const currentFiles = getValue();
  // 数量口径分支：空值按 0、单值按 1、数组按长度，仅在当前表达式局部关闭嵌套三元规则
  /* eslint-disable unicorn/no-nested-ternary */
  const currentCount = Array.isArray(currentFiles)
    ? currentFiles.length
    : currentFiles
      ? 1
      : 0;
  /* eslint-enable unicorn/no-nested-ternary */
  if (currentCount >= props.maxNumber) {
    showErrorMessage($t('ui.upload.maxNumber', [props.maxNumber]));
    return false;
  }

  const { maxSize, accept } = props;
  const isAct = checkFileType(file, accept);
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
    logError('upload:file:request', error);
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
 * 处理单个文件上传成功：清除临时占位、保留原始响应以支持 resultField，并尝试提交本批成功项。
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

  // 保留 response 字段以支持 resolveUploadValue 按 props.resultField 解析自定义结果
  const fileUrl = resolveUploadUrl(res);
  uploadList.value.push({
    name: file.name,
    response: res,
    status: UploadResultStatus.SUCCESS,
    uid: rawUid ?? Date.now() + uploadList.value.length,
    url: fileUrl,
  });

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
      :limit="maxNumber"
      :multiple="multiple"
      :drag="drag"
      list-type="text"
      :on-remove="handleRemove"
      :on-preview="handlePreview"
      :on-exceed="handleExceed"
    >
      <template v-if="drag">
        <div class="upload-drag-area">
          <p class="upload-drag-icon">
            <IconifyIcon icon="lucide:cloud-upload" :size="48" />
          </p>
          <p class="upload-drag-text">点击或拖拽文件到此区域上传</p>
          <p class="upload-drag-hint">
            支持{{ accept.join('/') }}格式文件，不超过{{ maxSize }}MB
          </p>
        </div>
      </template>
      <template v-else>
        <ElButton v-if="fileList && fileList.length < maxNumber" type="primary">
          <IconifyIcon icon="lucide:cloud-upload" class="mr-1" />
          {{ $t('ui.upload.upload') }}
        </ElButton>
      </template>
    </ElUpload>
    <div
      v-if="showDescription && !drag"
      class="mt-2 flex flex-wrap items-center text-sm"
    >
      请上传不超过
      <span class="mx-1 font-bold text-primary">{{ maxSize }}MB</span>
      的
      <span class="mx-1 font-bold text-primary">{{ accept.join('/') }}</span>
      格式文件
    </div>
  </div>
</template>

<style scoped>
.upload-drag-area {
  padding: 20px;
  text-align: center;
  background-color: #fafafa;
  border-radius: 8px;
  transition: border-color 0.3s;
}

.upload-drag-area:hover {
  border-color: var(--el-color-primary);
}

.upload-drag-icon {
  margin-bottom: 16px;
  color: #d9d9d9;
}

.upload-drag-text {
  margin-bottom: 8px;
  font-size: 16px;
  color: #666;
}

.upload-drag-hint {
  font-size: 14px;
  color: #999;
}
</style>
