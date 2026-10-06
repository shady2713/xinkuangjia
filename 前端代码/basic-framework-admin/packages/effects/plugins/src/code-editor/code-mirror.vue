<script lang="ts" setup>
/**
 * CodeMirror 编辑器内核：挂载后在容器上创建实例，并同步内容、模式、只读与主题。
 * 窗口尺寸变化时防抖 refresh，深浅色切换在 idea 与 material-palenight 之间换肤。
 * 只把编辑器 change 事件抛给父级；JSON 格式化与 update:value 由 code-editor.vue 负责。
 */
import type { Nullable } from '@vben/types';

import type { CodeEditorProps } from './types';

import {
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  unref,
  watch,
  watchEffect,
} from 'vue';

import { usePreferences } from '@vben/preferences';

import { useDebounceFn, useWindowSize } from '@vueuse/core';
import CodeMirror from 'codemirror';

import { MODE } from './types';

// modes
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/css/css';
import 'codemirror/mode/htmlmixed/htmlmixed';

// css
import './codemirror.css';
import 'codemirror/theme/idea.css';
import 'codemirror/theme/material-palenight.css';

const props = withDefaults(defineProps<CodeEditorProps>(), {
  mode: MODE.JSON,
  value: '',
  readonly: false,
  bordered: false,
  autoFormat: true,
});

const emit = defineEmits(['change']);

const { isDark } = usePreferences();
const { width, height } = useWindowSize();

const el = ref<HTMLDivElement>();
let editor: Nullable<CodeMirror.Editor>;

const debounceRefresh = useDebounceFn(refresh, 100);

watch(
  () => props.value,
  async (value) => {
    await nextTick();
    const oldValue = editor?.getValue();
    if (value !== oldValue) editor?.setValue(value || '');
  },
  { flush: 'post' },
);

watchEffect(() => {
  editor?.setOption('mode', props.mode);
});

watch(
  () => isDark.value,
  async () => {
    setTheme();
  },
  {
    immediate: true,
  },
);

watch(
  () => [width.value, height.value],
  async () => {
    debounceRefresh();
  },
);

function setTheme() {
  unref(editor)?.setOption(
    'theme',
    isDark.value ? 'material-palenight' : 'idea',
  );
}

function refresh() {
  editor?.refresh();
}

/**
 * 在模板根节点上创建 CodeMirror 实例并挂上主题、快捷键等配置。
 * @returns 无返回值；实例写入模块级 editor，供后续 watch 与 defineExpose 使用。
 */
async function init() {
  // 模板根节点在 onMounted + nextTick 后必然存在；缺失说明组件已被异常卸载，
  // 此时放弃初始化，避免把 undefined 交给 CodeMirror 产生难以定位的内部报错
  const container = el.value;
  if (!container) {
    return;
  }

  const addonOptions = {
    autoCloseBrackets: true,
    autoCloseTags: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers'],
  };

  editor = CodeMirror(container, {
    value: '',
    mode: props.mode,
    readOnly: props.readonly,
    tabSize: 2,
    theme: 'material-palenight',
    lineWrapping: true,
    lineNumbers: true,
    ...addonOptions,
  });
  editor?.setValue(props.value);
  setTheme();
  editor?.on('change', () => {
    emit('change', editor?.getValue());
  });
}

onMounted(async () => {
  await nextTick();
  init();
});

onUnmounted(() => {
  editor = null;
});
</script>

<template>
  <div
    ref="el"
    class="relative !h-full w-full overflow-hidden"
    :class="{
      'ant-input': props.bordered,
      'css-dev-only-do-not-override-kqecok': props.bordered,
    }"
  ></div>
</template>
