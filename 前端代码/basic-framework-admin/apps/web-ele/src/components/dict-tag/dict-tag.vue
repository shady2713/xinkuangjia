<script setup lang="ts">
/**
 * 字典标签组件：按字典类型和字典值从字典缓存中取出标签文本与颜色，渲染为 ElTag。
 * 字典未命中或入参为空时渲染空标签，不抛错，避免列表页因单条脏数据整体失败。
 */
import { computed } from 'vue';

import { getDictObj } from '@vben/hooks';

import { ElTag } from 'element-plus';

interface DictTagProps {
  type: string; // 字典类型
  value: boolean | number | string; // 字典值
  icon?: string; // 图标
}

const props = defineProps<DictTagProps>();

/** 获取字典标签 */
const dictTag = computed(() => {
  const defaultDict = {
    label: '',
    colorType: 'primary',
  };
  if (!props.type || props.value === undefined || props.value === null) {
    return defaultDict;
  }

  const dict = getDictObj(props.type, String(props.value));
  if (!dict) {
    return defaultDict;
  }

  // 字典配置的颜色只认 ElTag 支持的五种 type，其余值（含空值）统一回退为 primary，防止非法 type 导致标签无样式
  let colorType = dict.colorType;
  switch (colorType) {
    case 'danger': {
      colorType = 'danger';
      break;
    }
    case 'info': {
      colorType = 'info';
      break;
    }
    case 'primary': {
      colorType = 'primary';
      break;
    }
    case 'success': {
      colorType = 'success';
      break;
    }
    case 'warning': {
      colorType = 'warning';
      break;
    }
    default: {
      if (!colorType) {
        colorType = 'primary';
      }
    }
  }

  return {
    label: dict.label || '',
    colorType,
  };
});
</script>

<template>
  <ElTag v-if="dictTag.label" :type="dictTag.colorType as any">
    {{ dictTag.label }}
  </ElTag>
</template>
