<script lang="ts" setup>
/**
 * 图片上传组件：在文件上传能力之上提供卡片式列表与图片预览，
 * 负责图片类型与大小校验，上传编排、完成项登记以及删除后向外同步图片地址。
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
import {
  defaultImageAccepts,
  isImage,
  isObject,
  isString,
  logError,
} from '@vben/utils';

import { ElDialog, ElUpload } from 'element-plus';

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

defineOptions({ name: 'ImageUpload', inheritAttrs: false });

const props = withDefaults(defineProps<FileUploadProps>(), {
  /** 缺省空列表：此时图片列表为空，对外值也为空 */
  value: () => [],
  modelValue: undefined,
  directory: undefined,
  disabled: false,
  listType: 'picture-card',
  helpText: '',
  maxSize: 2,
  maxNumber: 1,
  /** 缺省接受框架内置的图片后缀白名单，调用方传入 accept 后以此为准 */
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
const isLtMsg = ref<boolean>(true); // 文件大小错误提示
const isActMsg = ref<boolean>(true); // 文件类型错误提示
const isFirstRender = ref<boolean>(true); // 是否第一次渲染
const uploadNumber = ref<number>(0); // 上传文件计数器
// 临时上传列表：等待本批次全部上传成功后并入 fileList
const uploadList = ref<UploadFile[]>([]);

watch(
  currentValue,
  /**
   * 外部绑定值变化时按新值重建文件列表。
   * 组件自身触发的变更（删除、上传完成）只复位内部标记后直接返回，避免与 emit 形成回环；
   * 首次渲染不向外发 change 事件。
   * @param v 变化后的绑定值，可能是字符串、字符串数组或已上传文件对象数组。
   */
  async (v) => {
    if (isInnerOperate.value) {
      isInnerOperate.value = false;
      return;
    }
    let value: string | string[] = [];
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

/** 处理图片预览 */
/**
 * 打开图片预览：已有地址直接展示，否则用原始文件生成 base64 兜底。
 * @param file 被点击的文件项；既无地址又无原始文件时不打开预览。
 */
async function handlePreview(file: UploadFile) {
  if (!file.url) {
    // 没有地址时才回退到本地文件生成 base64；raw 只在用户刚选择文件时存在，
    // 缺失说明该条目既无地址也无原始文件，此时无法预览，直接结束而不是让
    // FileReader 收到 undefined 抛错。
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
    /**
     * 按 Element Plus 生成的文件标识定位待删除项；匹配不到时返回 -1，
     * 调用方据此跳过删除，避免误删列表最后一项。
     */
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
  if (fileList.value.length >= props.maxNumber) {
    showErrorMessage($t('ui.upload.maxNumber', [props.maxNumber]));
    return false;
  }

  const { maxSize, accept } = props;
  const isAct = isImage(file.name, accept);
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
    logError('upload:image:request', error);
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
     * 不能按文件名匹配：同名图片同时上传时会删错占位项，
     * 留下的占位项与完成项重名重标，后续预览、删除都会指向错误的条目。
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
    // 同一毫秒完成的上传不会共享标识，删除时按 uid 过滤才只影响目标图片。
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

/** 处理上传错误 */
function handleUploadError(error: unknown) {
  logError('upload:image:error', error);
  showError(error, $t('ui.upload.uploadError'));
  // 上传失败时减少计数器
  uploadNumber.value = Math.max(0, uploadNumber.value - 1);
}

/**
 * 获取当前文件列表的值
 * @returns 文件 URL 列表或字符串
 */
function getValue() {
  /**
   * 只收敛上传成功的图片项：上传中与失败的条目一旦进入对外值，
   * 调用方就会拿到还不可访问的地址。resultField 决定每项暴露完整响应还是图片 URL。
   */
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
