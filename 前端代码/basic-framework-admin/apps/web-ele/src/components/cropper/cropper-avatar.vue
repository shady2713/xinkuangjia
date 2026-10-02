<script lang="ts" setup>
import type { CSSProperties } from 'vue';

import type { CropperAvatarProps } from './typing';

import { computed, ref, unref, watch, watchEffect } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';
import { $t } from '@vben/locales';

import { ElButton, ElMessage } from 'element-plus';

import cropperModal from './cropper-modal.vue';

defineOptions({ name: 'CropperAvatar' });

/**
 * 头像裁剪上传组件：展示圆形头像，点击后打开裁剪弹窗，确认后调用 uploadApi 上传裁剪结果。
 * 通过 v-model:value 同步头像地址，上传成功后通过 change 事件抛出上传接口返回值。
 */
const props = withDefaults(defineProps<CropperAvatarProps>(), {
  width: 200,
  value: '',
  showBtn: true,
  btnProps: () => ({}) as any,
  btnText: '',
  uploadApi: () => Promise.resolve(),
  size: 5,
});

/**
 * update:value：头像地址变化时触发，载荷为最新地址，支持 v-model:value。
 * change：上传成功时触发，载荷为 { data: 上传接口返回值, source: 裁剪结果 base64 }。
 */
const emit = defineEmits(['update:value', 'change']);

const sourceValue = ref(props.value || '');
const [CropperModal, modalApi] = useVbenModal({
  connectedComponent: cropperModal,
});

const getWidth = computed(() => `${`${props.width}`.replace(/px/, '')}px`);

const getIconWidth = computed(
  () => `${Number.parseInt(`${props.width}`.replace(/px/, '')) / 2}px`,
);

const getStyle = computed((): CSSProperties => ({ width: unref(getWidth) }));

const getImageWrapperStyle = computed(
  (): CSSProperties => ({ height: unref(getWidth), width: unref(getWidth) }),
);

watchEffect(() => {
  sourceValue.value = props.value || '';
});

watch(
  () => sourceValue.value,
  (v: string) => {
    emit('update:value', v);
  },
);

function handleUploadSuccess({
  data,
  source,
}: {
  data: string;
  source: string;
}) {
  sourceValue.value = source;
  emit('change', { data, source });
  ElMessage.success($t('ui.cropper.uploadSuccess'));
}

const closeModal = () => modalApi.close();
const openModal = () => modalApi.open();

/**
 * 向父组件暴露裁剪弹窗的开关控制，配合 vben Modal 使用。
 */
defineExpose({
  closeModal,
  openModal,
});
</script>

<template>
  <!-- 头像容器 -->
  <div class="inline-block text-center" :style="getStyle">
    <!-- 图片包装器 -->
    <div
      class="group relative cursor-pointer overflow-hidden rounded-full border border-gray-200 bg-white"
      :style="getImageWrapperStyle"
      @click="openModal"
    >
      <!-- 遮罩层 -->
      <div
        class="duration-400 absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black bg-opacity-40 opacity-0 transition-opacity group-hover:opacity-100"
        :style="getImageWrapperStyle"
      >
        <IconifyIcon
          icon="lucide:cloud-upload"
          class="m-auto text-gray-400"
          :style="{
            ...getImageWrapperStyle,
            width: getIconWidth,
            height: getIconWidth,
            lineHeight: getIconWidth,
          }"
        />
      </div>
      <!-- 头像图片 -->
      <img
        v-if="sourceValue"
        :src="sourceValue"
        alt="avatar"
        class="h-full w-full object-cover"
      />
    </div>
    <!-- 上传按钮 -->
    <ElButton
      v-if="showBtn"
      class="mx-auto mt-2"
      @click="openModal"
      v-bind="btnProps"
    >
      {{ btnText ? btnText : $t('ui.cropper.selectImage') }}
    </ElButton>

    <CropperModal
      :size="size"
      :src="sourceValue"
      :upload-api="uploadApi"
      @upload-success="handleUploadSuccess"
    />
  </div>
</template>
