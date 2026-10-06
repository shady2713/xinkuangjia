<script lang="ts" setup>
/**
 * 表单项标签：把 Label 的 for 绑定到 FormItem 生成的字段 id，
 * 点击标签即可聚焦对应控件，class 继续透传给底层 Label。
 * 校验错误提示由 FormMessage 输出，本组件不做错误态渲染。
 */
import type { LabelProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { Label } from '../label';
import { useFormField } from './useFormField';

const props = defineProps<LabelProps & { class?: ClassValue }>();

const { formItemId } = useFormField();
</script>

<template>
  <Label :class="cn(props.class)" :for="formItemId">
    <slot></slot>
  </Label>
</template>
