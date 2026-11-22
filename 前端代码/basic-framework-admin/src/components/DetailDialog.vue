<script setup lang="ts">
/**
 * 全站统一只读详情弹窗：复用 FormDialog 视觉外壳，隐藏确认按钮仅保留「关闭」。
 */
import FormDialog from '@/components/FormDialog.vue';

withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    width?: string | number;
  }>(),
  {
    width: '680px',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();
</script>

<template>
  <FormDialog
    :model-value="modelValue"
    :title="title"
    :width="width"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="bf-break-text">
      <slot />
    </div>
    <template #footer>
      <div class="flex items-center justify-end">
        <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      </div>
    </template>
  </FormDialog>
</template>
