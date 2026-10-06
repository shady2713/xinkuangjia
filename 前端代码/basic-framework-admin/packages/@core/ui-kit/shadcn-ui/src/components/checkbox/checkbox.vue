<script setup lang="ts">
/**
 * 带文字标签的复选框：label 与复选框共用同一 id，勾选结果经 v-model 抛出。
 * form-ui 把它注册为表单组件 VbenCheckbox，绑定事件为 checked；
 * 半选态由 indeterminate 透传，选项编排与校验交给表单层。
 */
import type { CheckboxRootEmits, CheckboxRootProps } from 'reka-ui';

import { useId } from 'vue';

import { useForwardPropsEmits } from 'reka-ui';

import { Checkbox } from '../../ui/checkbox';

const props = defineProps<CheckboxRootProps & { indeterminate?: boolean }>();

const emits = defineEmits<CheckboxRootEmits>();

const checked = defineModel<boolean>();

const forwarded = useForwardPropsEmits(props, emits);

const id = useId();
</script>

<template>
  <div class="flex items-center">
    <Checkbox v-bind="forwarded" :id="id" v-model="checked" />
    <label :for="id" class="ml-2 cursor-pointer text-sm"> <slot></slot> </label>
  </div>
</template>
