<script lang="ts" setup>
/** 表单项说明：展示字段下方的补充或校验提示。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { useFormField } from './useFormField';

const props = defineProps<{
  class?: ClassValue;
}>();

const { formDescriptionId } = useFormField();
</script>

<template>
  <p
    :id="formDescriptionId"
    :class="cn('text-sm text-muted-foreground', props.class)"
  >
    <slot></slot>
  </p>
</template>
