<script setup lang="ts">
/**
 * 内容容器：把标题/描述/额外操作、正文与页脚收进同一张卡片，各区块插槽可替换默认渲染。
 * 开启 autoContentHeight 后，正文高度按布局内容高度减去实测页眉页脚高度计算，
 * 并延迟 30ms 再放开滚动以避免首帧抖动；heightOffset 可再扣掉一段额外高度。
 * 只负责布局与高度，不做数据加载与空状态处理。
 */
import type { StyleValue } from 'vue';

import type { ContentWrapProps } from './types';

import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';

import { CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT } from '@vben-core/shared/constants';
import { cn } from '@vben-core/shared/utils';

defineOptions({
  name: 'ContentWrap',
});

const { autoContentHeight = false, heightOffset = 0 } =
  defineProps<ContentWrapProps>();

const headerHeight = ref(0);
const footerHeight = ref(0);
const shouldAutoHeight = ref(false);

const headerRef = useTemplateRef<HTMLDivElement>('headerRef');
const footerRef = useTemplateRef<HTMLDivElement>('footerRef');

/** 正文区样式：开启自动高度时按布局内容高度减去实测页眉页脚与自定义偏移，否则不附加样式。 */
const contentStyle = computed<StyleValue>(() => {
  if (autoContentHeight) {
    return {
      height: `calc(var(${CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT}) - ${headerHeight.value}px - ${footerHeight.value}px - ${typeof heightOffset === 'number' ? `${heightOffset}px` : heightOffset})`,
      overflowY: shouldAutoHeight.value ? 'auto' : 'unset',
    };
  }
  return {};
});

/** 计算正文区可用高度：渲染完成后读取页眉页脚实高；未开启自动高度时直接返回。 */
async function calcContentHeight() {
  if (!autoContentHeight) {
    return;
  }
  await nextTick();
  headerHeight.value = headerRef.value?.offsetHeight || 0;
  footerHeight.value = footerRef.value?.offsetHeight || 0;
  setTimeout(() => {
    shouldAutoHeight.value = true;
  }, 30);
}

onMounted(() => {
  calcContentHeight();
});
</script>

<template>
  <div
    class="bg-card text-card-foreground border-border relative flex min-h-full flex-col rounded-xl border"
  >
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
          'border-border relative flex items-end border-b px-6 py-4',
          headerClass,
        )
      "
    >
      <div class="flex-auto">
        <slot name="title">
          <div v-if="title" class="mb-2 flex text-lg font-semibold">
            {{ title }}
          </div>
          <div v-if="$slots.extra" class="flex justify-end">
            <slot name="extra"></slot>
          </div>
        </slot>

        <slot name="description">
          <p v-if="description" class="text-muted-foreground">
            {{ description }}
          </p>
        </slot>
      </div>
    </div>

    <div :class="cn('h-full p-4', contentClass)" :style="contentStyle">
      <slot></slot>
    </div>
    <div
      v-if="$slots.footer"
      ref="footerRef"
      :class="cn('align-center flex px-6 py-4', footerClass)"
    >
      <slot name="footer"></slot>
    </div>
  </div>
</template>
