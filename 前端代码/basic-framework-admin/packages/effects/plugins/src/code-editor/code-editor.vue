<script lang="ts" setup>
/**
 * 代码编辑器入口：在 CodeMirror 内核之上补 JSON 自动格式化与对外事件。
 * autoFormat 且 mode 为 JSON 时把 value 解析后按两格缩进回填，解析失败原样保留
 * 并抛出 formatError；html、js、vue 模式不做格式化。
 * 编辑结果以 update:value 与 change 事件对外抛出，不承担内容校验与提交。
 */
import type { CodeEditorProps } from './types';

import { computed } from 'vue';

import { isString } from '@vben/utils';

import CodeMirrorEditor from './code-mirror.vue';
import { MODE } from './types';

const props = withDefaults(defineProps<CodeEditorProps>(), {
  value: '',
  mode: MODE.JSON,
  readonly: false,
  autoFormat: true,
  bordered: false,
});

const emit = defineEmits(['change', 'update:value', 'formatError']);

const getValue = computed(() => {
  const { value, mode, autoFormat } = props;
  if (!autoFormat || mode !== MODE.JSON) return value as string;

  let result = value;
  if (isString(value)) {
    try {
      result = JSON.parse(value);
    } catch {
      emit('formatError', value);
      return value as string;
    }
  }
  return JSON.stringify(result, null, 2);
});

function handleValueChange(v: string) {
  emit('update:value', v);
  emit('change', v);
}
</script>

<template>
  <div class="h-full">
    <CodeMirrorEditor
      :value="getValue"
      :mode="mode"
      :readonly="readonly"
      :bordered="bordered"
      :auto-format="autoFormat"
      @change="handleValueChange"
    />
  </div>
</template>
