<script lang="ts" setup>
/**
 * 图片裁剪弹窗：选图后在弹窗内旋转、缩放、裁剪，确认时把结果交给 uploadApi。
 * 作为 CropperAvatar 的内部弹窗使用，也可由 vben Modal 的 register 机制单独挂载；
 * 只做裁剪与上传编排，头像展示与地址回写由调用方负责。
 */
import type { CropendResult, CropperModalProps, CropperType } from './typing';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';
import { $t } from '@vben/locales';
import { dataURLtoBlob, isFunction } from '@vben/utils';

import { ElAvatar, ElButton, ElSpace, ElTooltip, ElUpload } from 'element-plus';

import { showWarningMessage } from '#/utils/feedback';

import CropperImage from './cropper.vue';

defineOptions({ name: 'CropperModal' });

/**
 * 图片裁剪弹窗：选择图片后在弹窗内裁剪，确认时调用 uploadApi 上传裁剪结果。
 * 作为 CropperAvatar 的内部弹窗使用，也可通过 vben Modal 的 register 机制单独挂载。
 */
const props = withDefaults(defineProps<CropperModalProps>(), {
  circled: true,
  size: 0,
  src: '',
  // 未传 uploadApi 时不做真实上传，返回空串让弹窗保持在当前预览态。
  uploadApi: () => Promise.resolve(''),
});

/**
 * uploadSuccess：上传成功时触发，载荷为 { data: 上传接口返回值, source: 裁剪结果 base64 }。
 * uploadError：上传前校验失败（如图片超过 size 上限）时触发，载荷为 { msg: 错误提示 }。
 * register：vben Modal 的注册事件，由 useVbenModal 机制内部使用，业务方无需监听。
 */
const emit = defineEmits(['uploadSuccess', 'uploadError', 'register']);

let filename = '';
const src = ref(props.src || '');
const previewSource = ref('');
const cropper = ref<CropperType>();
let scaleX = 1;
let scaleY = 1;

const [Modal, modalApi] = useVbenModal({
  onConfirm: handleOk,
  /**
   * 弹窗开关变化时同步 loading 与预览态：打开先置 loading，等裁剪画布就绪再关闭；
   * 关闭时清空预览并复位 loading，避免下次打开残留上一次的裁剪结果。
   * @param isOpen 当前弹窗是否处于打开状态。
   */
  onOpenChange(isOpen) {
    if (isOpen) {
      // 打开时，进行 loading 加载。后续 CropperImage 组件加载完毕，会自动关闭 loading（通过 handleReady）
      modalLoading(true);
    } else {
      // 关闭时，清空右侧预览
      previewSource.value = '';
      modalLoading(false);
    }
  },
});

/** 同步弹窗的确定按钮与遮罩 loading 状态：裁剪画布加载中与上传中共用这一状态。 */
function modalLoading(loading: boolean) {
  modalApi.setState({ confirmLoading: loading, loading });
}

// Block upload
/**
 * 选图后的本地处理：先按 size 上限拦截超限图片，再读成 dataURL 作为裁剪源。
 * 恒返回 false 以阻止 Element Plus 自行上传，真实上传只在确认裁剪时由 uploadApi 发起。
 * @param file 用户选中的图片文件。
 * @returns 恒为 false，表示不走组件内置的上传流程。
 */
function handleBeforeUpload(file: File) {
  if (props.size > 0 && file.size > 1024 * 1024 * props.size) {
    emit('uploadError', { msg: $t('ui.cropper.imageTooBig') });
    return false;
  }
  const reader = new FileReader();
  reader.readAsDataURL(file);
  src.value = '';
  previewSource.value = '';
  reader.addEventListener('load', (e) => {
    src.value = (e.target?.result as string) ?? '';
    filename = file.name;
  });
  return false;
}

/** 裁剪完成只更新右侧预览，不触发上传：用户可继续调整，确认后才发起真实上传。 */
function handleCropend({ imgBase64 }: CropendResult) {
  previewSource.value = imgBase64;
}

/** 裁剪画布就绪后保存实例供工具栏按钮调用，并关闭打开阶段的 loading。 */
function handleReady(cropperInstance: CropperType) {
  cropper.value = cropperInstance;
  // 画布加载完毕 关闭 loading
  modalLoading(false);
}

/**
 * 响应工具栏按钮，把 scaleX / scaleY 等 cropperjs 方法转发给当前实例。
 * cropperjs 的实例方法不在事件名联合类型里，这里按方法名取实例上的同名函数再调用；
 * 实例未就绪时静默跳过，工具栏点击不会抛错。
 *
 * @param event cropperjs 的方法名
 * @param arg 方法入参，scaleX / scaleY 为 -1 或 1
 */
function handlerToolbar(event: string, arg?: number) {
  if (event === 'scaleX') {
    scaleX = arg = scaleX === -1 ? 1 : -1;
  }
  if (event === 'scaleY') {
    scaleY = arg = scaleY === -1 ? 1 : -1;
  }
  /**
   * cropperjs 缩放方法的统一签名：接收目标比例，缺省表示由 cropperjs 沿用当前值。
   * @param value 目标缩放比例。
   */
  type CropperScaleMethod = (value?: number) => void;
  /** cropperjs 实例上按名调用的方法表，取值时才收窄，避免整体断言成 any。 */
  type CropperInstanceMethods = Record<string, CropperScaleMethod | undefined>;
  const instance = cropper.value as CropperInstanceMethods | undefined;
  instance?.[event]?.(arg);
}

/**
 * 确认裁剪：把预览的 base64 转成 Blob 交给 uploadApi 上传，成功后抛 uploadSuccess 并关闭弹窗。
 * 未选图时只提示并中止；上传失败不在本地吞掉，异常继续抛给调用方，弹窗保持打开以便重试。
 */
async function handleOk() {
  const uploadApi = props.uploadApi;
  if (uploadApi && isFunction(uploadApi)) {
    if (!previewSource.value) {
      showWarningMessage('未选择图片');
      return;
    }
    const blob = dataURLtoBlob(previewSource.value);
    try {
      modalLoading(true);
      const url = await uploadApi({ file: blob, filename, name: 'file' });
      emit('uploadSuccess', { data: url, source: previewSource.value });
      await modalApi.close();
    } finally {
      modalLoading(false);
    }
  }
}
</script>

<template>
  <Modal
    v-bind="$attrs"
    :confirm-text="$t('ui.cropper.okText')"
    :fullscreen-button="false"
    :title="$t('ui.cropper.modalTitle')"
    class="w-2/3"
  >
    <div class="flex h-96">
      <!-- 左侧区域 -->
      <div class="h-full w-3/5">
        <!-- 裁剪器容器 -->
        <div
          class="relative h-[300px] bg-gradient-to-b from-neutral-50 to-neutral-200"
        >
          <CropperImage
            v-if="src"
            :circled="circled"
            :src="src"
            height="300px"
            @cropend="handleCropend"
            @ready="handleReady"
          />
        </div>

        <!-- 工具栏 -->
        <div class="mt-4 flex items-center justify-between">
          <ElUpload
            :before-upload="handleBeforeUpload"
            :file-list="[]"
            accept="image/*"
          >
            <ElTooltip
              :content="$t('ui.cropper.selectImage')"
              placement="bottom"
            >
              <ElButton size="small" type="primary">
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="lucide:upload" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
          </ElUpload>
          <ElSpace>
            <ElTooltip :content="$t('ui.cropper.btn_reset')" placement="bottom">
              <ElButton
                :disabled="!src"
                size="small"
                type="primary"
                @click="handlerToolbar('reset')"
              >
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="lucide:rotate-ccw" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
            <ElTooltip
              :content="$t('ui.cropper.btn_rotate_left')"
              placement="bottom"
            >
              <ElButton
                :disabled="!src"
                size="small"
                type="primary"
                @click="handlerToolbar('rotate', -45)"
              >
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="ant-design:rotate-left-outlined" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
            <ElTooltip
              :content="$t('ui.cropper.btn_rotate_right')"
              placement="bottom"
            >
              <ElButton
                :disabled="!src"
                size="small"
                type="primary"
                @click="handlerToolbar('rotate', 45)"
              >
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="ant-design:rotate-right-outlined" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
            <ElTooltip
              :content="$t('ui.cropper.btn_scale_x')"
              placement="bottom"
            >
              <ElButton
                :disabled="!src"
                size="small"
                type="primary"
                @click="handlerToolbar('scaleX')"
              >
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="vaadin:arrows-long-h" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
            <ElTooltip
              :content="$t('ui.cropper.btn_scale_y')"
              placement="bottom"
            >
              <ElButton
                :disabled="!src"
                size="small"
                type="primary"
                @click="handlerToolbar('scaleY')"
              >
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="vaadin:arrows-long-v" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
            <ElTooltip
              :content="$t('ui.cropper.btn_zoom_in')"
              placement="bottom"
            >
              <ElButton
                :disabled="!src"
                size="small"
                type="primary"
                @click="handlerToolbar('zoom', 0.1)"
              >
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="lucide:zoom-in" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
            <ElTooltip
              :content="$t('ui.cropper.btn_zoom_out')"
              placement="bottom"
            >
              <ElButton
                :disabled="!src"
                size="small"
                type="primary"
                @click="handlerToolbar('zoom', -0.1)"
              >
                <template #icon>
                  <div class="flex items-center justify-center">
                    <IconifyIcon icon="lucide:zoom-out" />
                  </div>
                </template>
              </ElButton>
            </ElTooltip>
          </ElSpace>
        </div>
      </div>

      <!-- 右侧区域 -->
      <div class="h-full w-2/5">
        <!-- 预览区域 -->
        <div
          class="mx-auto h-56 w-56 overflow-hidden rounded-full border border-gray-200"
        >
          <img
            v-if="previewSource"
            :alt="$t('ui.cropper.preview')"
            :src="previewSource"
            class="h-full w-full object-cover"
          />
        </div>
        <!-- 头像组合预览 -->
        <template v-if="previewSource">
          <div
            class="mt-2 flex items-center justify-around border-t border-gray-200 pt-2"
          >
            <ElAvatar :src="previewSource" size="large" />
            <ElAvatar :size="48" :src="previewSource" />
            <ElAvatar :size="64" :src="previewSource" />
            <ElAvatar :size="80" :src="previewSource" />
          </div>
        </template>
      </div>
    </div>
  </Modal>
</template>
