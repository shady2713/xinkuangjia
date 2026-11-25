<script setup lang="ts">
/**
 * 统一文件与图片上传组件：
 * - 支持普通文件与图片上传（默认单文件 50MB 上限，与后端对齐）；
 * - 通过 `cropper` 布尔开关开启内置 CropperJS 图片裁剪弹窗（头像/封面场景一键开启）。
 */
import { Delete, Plus, UploadFilled } from '@element-plus/icons-vue';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { ElMessage } from 'element-plus';
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

import { uploadFileApi } from '@/api/file';
import { resolveSafeHttpUrl } from '@/utils/format';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    mode?: 'image' | 'file';
    cropper?: boolean;
    aspectRatio?: number;
    directory?: string;
    maxSizeMb?: number;
    accept?: string;
    tip?: string;
    requirePublicUrl?: boolean;
  }>(),
  {
    modelValue: '',
    mode: 'file',
    cropper: false,
    aspectRatio: 1,
    directory: '',
    maxSizeMb: 50,
    accept: '',
    tip: '',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', url: string): void;
  (e: 'uploaded', url: string): void;
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const safeFileHref = computed(() => resolveSafeHttpUrl(props.modelValue));
const cropVisible = ref(false);
const cropImageSrc = ref('');
const cropImgEl = ref<HTMLImageElement | null>(null);
const pendingFileName = ref('cropped.png');
let cropperInstance: Cropper | null = null;

function openPicker() {
  fileInputRef.value?.click();
}

function destroyCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  if (cropImageSrc.value.startsWith('blob:')) {
    URL.revokeObjectURL(cropImageSrc.value);
  }
  cropImageSrc.value = '';
}

async function doUpload(file: File) {
  uploading.value = true;
  try {
    const url = await uploadFileApi(file, props.directory || undefined);
    // Private objects return no public URL; keep the current value and do not report it as usable.
    if (!url && props.requirePublicUrl) {
      ElMessage.warning('文件已上传，但未返回可公开访问的地址');
      return;
    }
    emit('update:modelValue', url);
    emit('uploaded', url);
    ElMessage.success('上传成功');
  } finally {
    uploading.value = false;
  }
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (file.size > props.maxSizeMb * 1024 * 1024) {
    ElMessage.warning(`文件大小不能超过 ${props.maxSizeMb}MB`);
    return;
  }

  if (props.cropper && file.type.startsWith('image/')) {
    destroyCropper();
    pendingFileName.value = file.name.replace(/\.[^.]+$/, '') + '.png';
    cropImageSrc.value = URL.createObjectURL(file);
    cropVisible.value = true;
    await nextTick();
    if (cropImgEl.value) {
      cropperInstance = new Cropper(cropImgEl.value, {
        aspectRatio: props.aspectRatio,
        viewMode: 1,
        autoCropArea: 0.9,
      });
    }
    return;
  }

  await doUpload(file);
}

function confirmCrop() {
  if (!cropperInstance) return;
  const canvas = cropperInstance.getCroppedCanvas({
    width: 400,
    height: Math.round(400 / (props.aspectRatio || 1)),
  });
  canvas.toBlob(async (blob) => {
    if (!blob) {
      ElMessage.error('图片裁剪失败');
      return;
    }
    const croppedFile = new File([blob], pendingFileName.value, {
      type: 'image/png',
    });
    cropVisible.value = false;
    destroyCropper();
    await doUpload(croppedFile);
  }, 'image/png');
}

function clearValue() {
  emit('update:modelValue', '');
}

onBeforeUnmount(() => {
  destroyCropper();
});
</script>

<template>
  <div class="inline-block">
    <input
      ref="fileInputRef"
      type="file"
      class="hidden"
      :accept="accept || (mode === 'image' ? 'image/*' : undefined)"
      @change="onFileSelected"
    />

    <template v-if="mode === 'image'">
      <div class="flex items-center gap-3">
        <div
          v-if="modelValue"
          class="group relative h-24 w-24 overflow-hidden rounded-lg border border-[#e4e4e7]"
        >
          <el-image
            :src="modelValue"
            :preview-src-list="[modelValue]"
            fit="cover"
            class="h-full w-full"
          />
          <button
            type="button"
            class="absolute top-1 right-1 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white group-hover:flex"
            @click="clearValue"
          >
            <el-icon :size="12"><Delete /></el-icon>
          </button>
        </div>
        <button
          type="button"
          class="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#d4d4d8] bg-[#fafafa] text-xs text-[#64748b] transition hover:border-[#006be6] hover:text-[#006be6]"
          :disabled="uploading"
          @click="openPicker"
        >
          <el-icon :size="20"><Plus /></el-icon>
          <span>{{ uploading ? '上传中...' : cropper ? '选择并裁剪' : '上传图片' }}</span>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center gap-2">
        <el-button
          type="primary"
          plain
          :icon="UploadFilled"
          :loading="uploading"
          @click="openPicker"
        >
          {{ uploading ? '上传中...' : '选择文件上传' }}
        </el-button>
        <a
          v-if="safeFileHref"
          :href="safeFileHref"
          target="_blank"
          rel="noopener noreferrer"
          class="max-w-xs truncate text-xs text-[#006be6] hover:underline"
        >
          {{ modelValue }}
        </a>
        <span
          v-else-if="modelValue"
          class="max-w-xs truncate text-xs text-[#64748b]"
          title="非 HTTP/HTTPS 协议地址已禁用直接跳转"
        >
          {{ modelValue }}
        </span>
        <el-button
          v-if="modelValue"
          link
          type="danger"
          size="small"
          @click="clearValue"
        >
          清除
        </el-button>
      </div>
    </template>

    <div v-if="tip" class="mt-1 text-xs text-[#94a3b8]">{{ tip }}</div>

    <el-dialog
      v-model="cropVisible"
      title="裁剪图片"
      width="520px"
      align-center
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
      class="bf-dialog"
      @closed="destroyCropper"
    >
      <div class="h-[340px] w-full overflow-hidden rounded bg-[#f4f4f5]">
        <img
          v-if="cropImageSrc"
          ref="cropImgEl"
          :src="cropImageSrc"
          alt="待裁剪图片"
          class="block max-w-full"
        />
      </div>
      <template #footer>
        <el-button @click="cropVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="confirmCrop">
          确认裁剪并上传
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
