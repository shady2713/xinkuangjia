<script lang="ts" setup>
/**
 * 文件上传组件：以 Element Plus 上传列表承载业务文件值，
 * 负责数量、类型与大小校验，上传编排、完成项登记以及删除后向外同步值。
 * 列表项一律按 Element Plus 生成的 uid 标识，不能用文件名或时间戳代替。
 */
import type {
  UploadFile,
  UploadRawFile,
  UploadRequestOptions,
} from 'element-plus';

import type { FileUploadProps, UploadApiResult } from './typing';

import { computed, ref, toRefs, watch } from 'vue';

import { IconifyIcon } from '@vben/icons';
import { $t } from '@vben/locales';
import { checkFileType, isObject, isString, logError } from '@vben/utils';

import { ElButton, ElUpload } from 'element-plus';

import {
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
  toUploadAjaxError,
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
 * returnText：上传前读取到文件文本内容时触发，载荷为文件原文，用于需要预览文本的场景。
 * preview：点击预览已上传文件时触发，载荷为文件地址。
 */
const emit = defineEmits([
  'change',
  'update:value',
  'update:modelValue',
  'delete',
  'returnText',
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
const isLtMsg = ref<boolean>(true); // 文件大小错误提示
const isActMsg = ref<boolean>(true); // 文件类型错误提示
const isFirstRender = ref<boolean>(true); // 是否第一次渲染
const uploadNumber = ref<number>(0); // 上传文件计数器
// 临时上传列表：等待本批次全部上传成功后并入 fileList
const uploadList = ref<UploadFile[]>([]); // 临时上传列表

watch(
  currentValue,
  /**
   * 外部绑定值变化时按新值重建文件列表。
   * 组件自身触发的变更（删除、上传完成）只复位内部标记后直接返回，避免与 emit 形成回环；
   * 首次渲染不向外发 change 事件，值被清空时清空列表。
   * @param v 变化后的绑定值，可能是字符串、字符串数组或已上传文件对象数组。
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
        .map(
          /**
           * 把绑定值中的每一项转换为 ElUpload 的文件项：字符串按地址解析出文件名，
           * 对象按其既有字段透传；无法识别的项返回 null，随后由 filter 统一剔除。
           * @param item 当前待转换的绑定值元素。
           * @param i 元素在数组中的下标，用于缺少 uid 时生成稳定的负数标识。
           * @returns 转换后的文件项；无法识别时返回 null。
           */
          (item, i) => {
            if (item && isString(item)) {
              return {
                uid: -i,
                name: item.slice(Math.max(0, item.lastIndexOf('/') + 1)),
                status: UploadResultStatus.SUCCESS,
                url: item,
              } as UploadFile;
            } else if (item && isObject(item)) {
              // isObject 已把 item 收窄为记录视图，字段取值按 unknown 语义直接透传
              const file = item;
              return {
                uid: file.uid ?? -i,
                name: file.name ?? '',
                status: file.status ?? UploadResultStatus.SUCCESS,
                url: file.url,
              } as UploadFile;
            }
            return null;
          },
        )
        .filter(Boolean) as UploadFile[];
    } else {
      // 值为空时清空文件列表
      fileList.value = [];
    }
    // 首次渲染只建立内部列表，不向外发变更事件，避免调用方把初始化当成用户修改；
    // 标记必须在首次处理结束时独立复位，放在抛出分支内会让外部变化永远不通知调用方。
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
    window.open(file.url);
  }
}

/** 处理文件数量超限 */
function handleExceed() {
  showErrorMessage($t('ui.upload.maxNumber', [maxNumber.value]));
}

/** 处理上传错误 */
function handleUploadError(error: unknown) {
  logError('upload:file:error', error);
  showError(error, $t('ui.upload.uploadError'));
  // 上传失败时减少计数器
  uploadNumber.value = Math.max(0, uploadNumber.value - 1);
}

/**
 * 上传前校验
 * @param file 待上传的文件
 * @returns 是否允许上传
 */
// 数量口径分支：空值按 0、单值按 1、数组按长度，嵌套三元可读性优于展开为 if 链
/* eslint-disable unicorn/no-nested-ternary */
async function beforeUpload(file: File) {
  const fileContent = await file.text();
  emit('returnText', fileContent);

  // 检查文件数量限制（使用 getValue 获取实际已上传的文件数量）
  const currentFiles = getValue();
  const currentCount = Array.isArray(currentFiles)
    ? currentFiles.length
    : currentFiles
      ? 1
      : 0;
  if (currentCount >= props.maxNumber) {
    showErrorMessage($t('ui.upload.maxNumber', [props.maxNumber]));
    return false;
  }

  const { maxSize, accept } = props;
  const isAct = checkFileType(file, accept);
  if (!isAct) {
    showErrorMessage($t('ui.upload.acceptUpload', [accept]));
    isActMsg.value = false;
    // 防止弹出多个错误提示
    setTimeout(() => (isActMsg.value = true), 1000);
    return false;
  }
  const isLt = file.size / 1024 / 1024 > maxSize;
  if (isLt) {
    showErrorMessage($t('ui.upload.maxSizeMultiple', [maxSize]));
    isLtMsg.value = false;
    // 防止弹出多个错误提示
    setTimeout(() => (isLtMsg.value = true), 1000);
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
    handleUploadSuccess(res, options.file);

    options.onSuccess(res);
    showSuccessMessage($t('ui.upload.uploadSuccess'));
  } catch (error: unknown) {
    logError('upload:file:request', error);
    // onError 需要带 status/method/url 的错误对象，补齐后再交给 Element Plus
    options.onError(toUploadAjaxError(error, options));
    handleUploadError(error);
  }
}

/**
 * 处理上传成功
 * @param res 上传响应结果
 * @param file 本次上传完成的原始文件；其 `uid` 由 Element Plus 生成并保证同一列表内唯一，
 * 既用于定位要清理的临时占位项，也作为完成项的标识沿用下去
 */
function handleUploadSuccess(res: UploadApiResult, file: UploadRawFile) {
  // 删除本次上传对应的临时占位项；fileList 始终是数组，findIndex 不会返回 undefined，
  // 必须同时排除 -1，否则 splice(-1) 会误删最后一项
  const index = fileList.value.findIndex(
    /**
     * 按 Element Plus 生成的文件标识匹配本次上传的占位项。
     * 不能按文件名匹配：同名文件（例如不同目录下的同名文件）同时上传时会删错占位项，
     * 留下的占位项与完成项重名重标，后续删除、计数都会指向错误的条目。
     */
    (item) => item.uid === file.uid,
  );
  if (index !== -1) {
    fileList.value.splice(index, 1);
  }

  // 添加到临时上传列表
  const fileUrl = resolveUploadUrl(res);
  uploadList.value.push({
    name: file.name,
    url: fileUrl,
    status: UploadResultStatus.SUCCESS,
    // 沿用原始上传文件的 uid：它由 Element Plus 逐文件递增生成，
    // 同一毫秒完成的上传不会共享标识，删除时按 uid 过滤才只影响目标文件。
    uid: file.uid,
  });

  // 检查是否所有文件都上传完成
  if (uploadList.value.length >= uploadNumber.value) {
    fileList.value.push(...uploadList.value);
    uploadList.value = [];
    uploadNumber.value = 0;

    // 更新值
    const value = getValue();
    isInnerOperate.value = true;
    emit('update:value', value);
    emit('update:modelValue', value);
    emit('change', value);
  }
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
