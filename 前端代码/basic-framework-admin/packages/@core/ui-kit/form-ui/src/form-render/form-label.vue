<script setup lang="ts">
/** 表单项标签：渲染必填星号、标签文本、帮助提示与冒号，不参与校验。 */
import type { CustomRenderType } from '../types';

import {
  FormLabel,
  VbenHelpTooltip,
  VbenRenderContent,
} from '@vben-core/shadcn-ui';
import { cn } from '@vben-core/shared/utils';

/** 标签组件的属性契约：必填星号、标签文本、帮助提示与冒号都由上层字段传入。 */
interface Props {
  class?: string;
  colon?: boolean;
  help?: CustomRenderType;
  label?: CustomRenderType;
  required?: boolean;
}

const props = defineProps<Props>();
</script>

<template>
  <FormLabel :class="cn('flex items-center', props.class)">
    <span v-if="required" class="mr-[2px] text-destructive">*</span>
    <slot></slot>
    <VbenHelpTooltip v-if="help" trigger-class="size-3.5 ml-1">
      <VbenRenderContent :content="help" />
    </VbenHelpTooltip>
    <span v-if="colon && label" class="ml-[2px]">:</span>
  </FormLabel>
</template>
