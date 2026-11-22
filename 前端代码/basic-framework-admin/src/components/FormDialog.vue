<script setup lang="ts">
/**
 * 全站统一表单弹窗（1:1 复刻 Vben 5 Modal 样式与交互）：
 * - 默认强制禁止误点遮罩关闭（close-on-click-modal=false）与关闭销毁内部表单状态（destroy-on-close）
 * - 统一头部（标题 + 可选全屏切换 + 关闭）与底部（取消 + 确定带 loading）按钮位置
 */
import { Close, FullScreen } from '@element-plus/icons-vue';
import { ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    width?: string | number;
    confirmText?: string;
    cancelText?: string;
    confirmLoading?: boolean;
    showFooter?: boolean;
    showFullscreen?: boolean;
    destroyOnClose?: boolean;
  }>(),
  {
    width: '560px',
    confirmText: '确定',
    cancelText: '取消',
    confirmLoading: false,
    showFooter: true,
    showFullscreen: true,
    destroyOnClose: true,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
  (e: 'closed'): void;
}>();

const isFullscreen = ref(false);

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      isFullscreen.value = false;
    }
  },
);

function handleClose() {
  emit('update:modelValue', false);
  emit('cancel');
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :width="width"
    :fullscreen="isFullscreen"
    :close-on-click-modal="false"
    :destroy-on-close="destroyOnClose"
    :show-close="false"
    align-center
    append-to-body
    class="bf-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-[16px] font-semibold text-[#1f2937]">
          {{ title }}
        </span>
        <div class="flex items-center gap-1">
          <button
            v-if="showFullscreen"
            type="button"
            class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#1f2937]"
            :title="isFullscreen ? '还原窗口' : '全屏显示'"
            @click="isFullscreen = !isFullscreen"
          >
            <el-icon :size="15"><FullScreen /></el-icon>
          </button>
          <button
            type="button"
            class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#1f2937]"
            title="关闭"
            @click="handleClose"
          >
            <el-icon :size="16"><Close /></el-icon>
          </button>
        </div>
      </div>
    </template>

    <slot />

    <template v-if="showFooter" #footer>
      <slot name="footer">
        <div class="flex items-center justify-end gap-2">
          <el-button @click="handleClose">{{ cancelText }}</el-button>
          <el-button
            type="primary"
            :loading="confirmLoading"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </el-button>
        </div>
      </slot>
    </template>
  </el-dialog>
</template>
