<script lang="ts" setup>
/**
 * 头像裁剪上传控件：展示圆形头像，点击后打开裁剪弹窗，上传成功回写头像地址。
 * 由个人中心等资料页使用，v-model:value 同步地址，change 抛出上传结果；
 * 裁剪交互与体积校验在 cropper-modal.vue，真实上传由调用方注入的 uploadApi 完成。
 */
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
  /** 按钮属性的默认值必须是工厂函数，返回每次渲染都独立的新对象。 */
  btnProps: () => ({}),
  btnText: '',
  // 未传 uploadApi 时不做真实上传，返回空串让组件保持可渲染的空态。
  uploadApi: () => Promise.resolve(''),
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

/** 头像展示宽度：剥掉可能存在的 px 后缀再补回，兼容 200 与 '200px' 两种入参。 */
const getWidth = computed(() => `${`${props.width}`.replace(/px/, '')}px`);

/** 遮罩图标宽度取头像宽度的一半，使编辑提示在圆内居中。 */
const getIconWidth = computed(
  () => `${Number.parseInt(`${props.width}`.replace(/px/, '')) / 2}px`,
);

/** 外层容器只约束宽度，让头像与下方按钮在行内保持居中。 */
const getStyle = computed((): CSSProperties => ({ width: unref(getWidth) }));

/** 图片与遮罩层共用正方形尺寸，保证遮罩完整覆盖圆形头像。 */
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

/**
 * 弹窗上传成功后的回调：先写入本地裁剪结果再通知外部。
 * 顺序不能颠倒——先 emit 会让外部用空地址覆盖本地值，上传异常时头像将无法回退。
 * @param data uploadApi 的返回值，原样透传给 change 事件。
 * @param source 裁剪结果的 base64，作为头像展示地址。
 */
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

/** 关闭裁剪弹窗，供父组件通过 ref 直接调用。 */
const closeModal = () => modalApi.close();
/** 打开裁剪弹窗，头像点击与外部编程式打开都走这里。 */
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
