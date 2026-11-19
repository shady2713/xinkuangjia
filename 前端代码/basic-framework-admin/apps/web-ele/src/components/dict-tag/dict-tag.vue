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

/** 受 Element Plus ElTag 支持的标签配色类型。 */
type ElTagType = 'danger' | 'info' | 'primary' | 'success' | 'warning';

const COLOR_TYPE_MAP = new Map<string, ElTagType>([
  ['danger', 'danger'],
  ['default', 'info'],
  ['error', 'danger'],
  ['info', 'info'],
  ['primary', 'primary'],
  ['processing', 'primary'],
  ['success', 'success'],
  ['warning', 'warning'],
]);

/**
 * 解析并映射字典标签的展示文案及受 Element Plus 支持的标签配色。
 *
 * @param dictType 字典类型编码
 * @param dictValue 字典键值
 * @returns 规范化后的标签文案与 ElTag 颜色类型
 */
function resolveDictTag(
  dictType: string,
  dictValue: boolean | number | string,
): { colorType: ElTagType; label: string } {
  const defaultDict: { colorType: ElTagType; label: string } = {
    colorType: 'primary',
    label: '',
  };
  if (!dictType || dictValue === undefined || dictValue === null) {
    return defaultDict;
  }

  const dict = getDictObj(dictType, String(dictValue));
  if (!dict) {
    return defaultDict;
  }

  // 字典配置的颜色只认 ElTag 支持的五种 type，兼容历史 default/processing/error 后其余未知值统一回退为 primary
  const colorType = COLOR_TYPE_MAP.get(dict.colorType ?? '') ?? 'primary';

  return {
    colorType,
    label: dict.label || '',
  };
}

/** 根据当前字典类型与键值计算安全的标签配置。 */
const dictTag = computed(() => resolveDictTag(props.type, props.value));
</script>

<template>
  <ElTag v-if="dictTag.label" :type="dictTag.colorType">
    {{ dictTag.label }}
  </ElTag>
</template>
