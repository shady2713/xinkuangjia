<script lang="ts" setup>
/**
 * 文档提示条：展示文档标题与可点击地址，点击后在新窗口打开该 URL 并可关闭。
 * 显隐同时受运行时开关 isDocAlertEnable() 与本地关闭状态控制，关闭只在本次挂载内有效。
 * 标题与地址均由 props 传入，组件不拼装地址，也不校验链接可达性。
 */
import type { DocAlertProps } from './types';

import { ref } from 'vue';

import { isDocAlertEnable } from '@vben/hooks';

import { VbenIcon } from '@vben-core/shadcn-ui';
import { openWindow } from '@vben-core/shared/utils';

defineOptions({
  name: 'DocAlert',
});

const props = defineProps<DocAlertProps>();

/** 控制组件显示状态 */
const isVisible = ref(true);

/** 在新窗口打开传入的文档地址；地址由调用方保证有效。 */
function goToUrl() {
  openWindow(props.url);
}

/** 关闭提示条；只在本次挂载内生效，刷新后按运行时开关重新显示。 */
function close() {
  isVisible.value = false;
}
</script>
<template>
  <div
    role="alert"
    v-if="isDocAlertEnable() && isVisible"
    class="border-primary bg-primary/10 relative m-3 my-2 flex h-8 items-center gap-2 rounded-md border p-2"
  >
    <span class="grid shrink-0 place-items-center">
      <VbenIcon icon="mdi:information-outline" class="text-primary size-5" />
    </span>
    <div class="text-primary min-w-0 flex-1 font-sans text-sm leading-none">
      <span class="inline-block">【{{ title }}】</span>
      <a
        class="hover:text-success cursor-pointer break-all"
        @click="goToUrl"
        :title="url"
      >
        文档地址：{{ url }}
      </a>
    </div>
    <span class="grid shrink-0 cursor-pointer place-items-center">
      <VbenIcon
        icon="mdi:close"
        class="text-primary size-5 hover:text-red-500"
        @click="close"
      />
    </span>
  </div>
</template>
