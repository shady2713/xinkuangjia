<script setup lang="ts">
/**
 * 页面骨架组件：按文档提示、标题描述、内容、页脚四段组织页面，
 * 标题与描述可由属性或同名插槽填充，extra 插槽放头部操作区。
 * 开启 autoContentHeight 后，按布局内容高度减去头尾与文档区
 * 实高撑满剩余空间；只做布局与尺寸计算，不含数据请求与权限。
 */
import type { StyleValue } from 'vue';

import type { PageProps } from './types';

import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';

import { isDocAlertEnable } from '@vben/hooks';

import { CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT } from '@vben-core/shared/constants';
import { cn } from '@vben-core/shared/utils';

defineOptions({
  name: 'Page',
});

const { autoContentHeight = false, heightOffset = 0 } =
  defineProps<PageProps>();

const headerHeight = ref(0);
const footerHeight = ref(0);
const docHeight = ref(0);
const shouldAutoHeight = ref(false);

const headerRef = useTemplateRef<HTMLDivElement>('headerRef');
const footerRef = useTemplateRef<HTMLDivElement>('footerRef');
const docRef = useTemplateRef<HTMLDivElement>('docRef');

/** 内容区样式：开启自动高度时按布局内容高度减去头、尾、文档区与自定义偏移，否则不附加样式。 */
const contentStyle = computed<StyleValue>(() => {
  if (autoContentHeight) {
    return {
      height: `calc(var(${CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT}) - ${headerHeight.value}px - ${footerHeight.value}px - ${docHeight.value}px - ${typeof heightOffset === 'number' ? `${heightOffset}px` : heightOffset})`,
      overflowY: shouldAutoHeight.value ? 'auto' : 'unset',
    };
  }
  return {};
});

/** 计算内容区可用高度：渲染完成后读取头、尾与文档区实高；未开启自动高度时直接返回。 */
async function calcContentHeight() {
  if (!autoContentHeight) {
    return;
  }
  await nextTick();
  headerHeight.value = headerRef.value?.offsetHeight || 0;
  footerHeight.value = footerRef.value?.offsetHeight || 0;
  docHeight.value = docRef.value?.offsetHeight || 0;
  setTimeout(() => {
    shouldAutoHeight.value = true;
  }, 30);
}

onMounted(() => {
  calcContentHeight();
});
</script>

<template>
  <div class="relative flex min-h-full flex-col">
    <div
      v-if="$slots.doc && isDocAlertEnable()"
      ref="docRef"
      :class="
        cn(
          'bg-card border-border relative mx-4 flex items-start rounded-md border-b',
        )
      "
    >
      <div class="flex-auto">
        <slot name="doc"></slot>
      </div>
    </div>

    <div
      v-if="
        description ||
        $slots.description ||
        title ||
        $slots.title ||
        $slots.extra
      "
      ref="headerRef"
      :class="
        cn(
          'bg-card border-border relative flex items-end border-b px-6 py-4',
          headerClass,
        )
      "
    >
      <div class="flex-auto">
        <slot name="title">
          <div v-if="title" class="mb-2 flex text-lg font-semibold">
            {{ title }}
          </div>
        </slot>

        <slot name="description">
          <p v-if="description" class="text-muted-foreground">
            {{ description }}
          </p>
        </slot>
      </div>

      <div v-if="$slots.extra">
        <slot name="extra"></slot>
      </div>
    </div>

    <div :class="cn('h-full p-4', contentClass)" :style="contentStyle">
      <slot></slot>
    </div>
    <div
      v-if="$slots.footer"
      ref="footerRef"
      :class="cn('bg-card align-center flex px-6 py-4', footerClass)"
    >
      <slot name="footer"></slot>
    </div>
  </div>
</template>
