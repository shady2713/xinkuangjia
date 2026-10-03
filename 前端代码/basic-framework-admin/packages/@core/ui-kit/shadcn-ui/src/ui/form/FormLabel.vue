<script lang="ts" setup>
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
