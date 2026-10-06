<script setup lang="ts">
/**
 * 通用兜底页组件：按 status 选配内置图标与国际化文案，支持自定义插槽。
 * 403/404 显示返回首页按钮，500/离线显示刷新按钮；不改动路由与权限判定。
 */
import type { FallbackProps } from './fallback';

import { computed, defineAsyncComponent } from 'vue';
import { useRouter } from 'vue-router';

import { ArrowLeft, RotateCw } from '@vben/icons';
import { $t } from '@vben/locales';

import { VbenButton } from '@vben-core/shadcn-ui';

/** 兜底页的属性契约别名：直接复用兜底页属性，不额外声明成员。 */
type Props = FallbackProps;

defineOptions({
  name: 'Fallback',
});

const props = withDefaults(defineProps<Props>(), {
  description: '',
  homePath: '/',
  image: '',
  showBack: true,
  status: 'coming-soon',
  title: '',
});

/** 403 无权限页的异步图标组件，仅在状态为 403 时加载。 */
const Icon403 = defineAsyncComponent(() => import('./icons/icon-403.vue'));
/** 404 未找到页的异步图标组件，仅在状态为 404 时加载。 */
const Icon404 = defineAsyncComponent(() => import('./icons/icon-404.vue'));
/** 500 服务异常页的异步图标组件，仅在状态为 500 时加载。 */
const Icon500 = defineAsyncComponent(() => import('./icons/icon-500.vue'));
/** 即将上线页的异步图标组件，仅在状态为 coming-soon 时加载。 */
const IconHello = defineAsyncComponent(
  () => import('./icons/icon-coming-soon.vue'),
);
/** 离线页的异步图标组件，仅在状态为 offline 时加载。 */
const IconOffline = defineAsyncComponent(
  () => import('./icons/icon-offline.vue'),
);

/** 标题文案：优先用传入的 title，否则按 status 取国际化文案；未知状态返回空串。 */
const titleText = computed(() => {
  if (props.title) {
    return props.title;
  }

  switch (props.status) {
    case '403': {
      return $t('ui.fallback.forbidden');
    }
    case '404': {
      return $t('ui.fallback.pageNotFound');
    }
    case '500': {
      return $t('ui.fallback.internalError');
    }
    case 'coming-soon': {
      return $t('ui.fallback.comingSoon');
    }
    case 'offline': {
      return $t('ui.fallback.offlineError');
    }
    default: {
      return '';
    }
  }
});

/** 描述文案：优先用传入的 description，否则按 status 取国际化文案；未知状态返回空串。 */
const descText = computed(() => {
  if (props.description) {
    return props.description;
  }
  switch (props.status) {
    case '403': {
      return $t('ui.fallback.forbiddenDesc');
    }
    case '404': {
      return $t('ui.fallback.pageNotFoundDesc');
    }
    case '500': {
      return $t('ui.fallback.internalErrorDesc');
    }
    case 'offline': {
      return $t('ui.fallback.offlineErrorDesc');
    }
    default: {
      return '';
    }
  }
});

/** 图标组件：按 status 选择内置图标；未知状态返回 null，模板据此不渲染图标。 */
const fallbackIcon = computed(() => {
  switch (props.status) {
    case '403': {
      return Icon403;
    }
    case '404': {
      return Icon404;
    }
    case '500': {
      return Icon500;
    }
    case 'coming-soon': {
      return IconHello;
    }
    case 'offline': {
      return IconOffline;
    }
    default: {
      return null;
    }
  }
});

/** 是否显示返回首页按钮：仅 403 与 404 两种状态显示。 */
const showBack = computed(() => {
  return props.status === '403' || props.status === '404';
});

/** 是否显示刷新按钮：仅 500 与离线两种状态显示。 */
const showRefresh = computed(() => {
  return props.status === '500' || props.status === 'offline';
});

const { push } = useRouter();

// 返回首页
function back() {
  push(props.homePath);
}

/** 重新加载当前页面；用于服务异常与离线场景下重试。 */
function refresh() {
  location.reload();
}
</script>

<template>
  <div class="flex size-full flex-col items-center justify-center duration-300">
    <img v-if="image" :src="image" class="md:1/3 w-1/2 lg:w-1/4" />
    <component
      :is="fallbackIcon"
      v-else-if="fallbackIcon"
      class="md:1/3 h-1/3 w-1/2 lg:w-1/4"
    />
    <div class="flex-col-center">
      <slot v-if="$slots.title" name="title"></slot>
      <p
        v-else-if="titleText"
        class="text-foreground mt-8 text-2xl md:text-3xl lg:text-4xl"
      >
        {{ titleText }}
      </p>
      <slot v-if="$slots.describe" name="describe"></slot>
      <p
        v-else-if="descText"
        class="text-muted-foreground md:text-md my-4 lg:text-lg"
      >
        {{ descText }}
      </p>
      <slot v-if="$slots.action" name="action"></slot>
      <VbenButton v-else-if="showBack" size="lg" @click="back">
        <ArrowLeft class="mr-2 size-4" />
        {{ $t('common.backToHome') }}
      </VbenButton>
      <VbenButton v-else-if="showRefresh" size="lg" @click="refresh">
        <RotateCw class="mr-2 size-4" />
        {{ $t('common.refresh') }}
      </VbenButton>
    </div>
  </div>
</template>
