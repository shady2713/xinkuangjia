<script lang="ts" setup>
/**
 * 面包屑挂件：把当前路由的匹配链转成面包屑项，点击后跳转对应路径。
 * 按 meta 标记过滤隐藏项并翻译标题，首页项等策略由父级传入；
 * 只负责展示与跳转，不改写路由结构。
 */
import type { BreadcrumbStyleType } from '@vben/types';

import type { IBreadcrumb } from '@vben-core/shadcn-ui';

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { $t } from '@vben/locales';

import { VbenBreadcrumbView } from '@vben-core/shadcn-ui';

/** 面包屑属性：控制只剩一项时是否隐藏、是否补充首页项、是否显示图标以及分隔样式。 */
interface Props {
  hideWhenOnlyOne?: boolean;
  showHome?: boolean;
  showIcon?: boolean;
  type?: BreadcrumbStyleType;
}

const props = withDefaults(defineProps<Props>(), {
  showHome: false,
  showIcon: false,
  type: 'normal',
});

const route = useRoute();
const router = useRouter();

/** 面包屑项：由当前路由匹配链剔除隐藏项后生成，标题按当前语言翻译；可按需在最前面补首页项。 */
const breadcrumbs = computed((): IBreadcrumb[] => {
  const matched = route.matched;

  const resultBreadcrumb: IBreadcrumb[] = [];

  for (const match of matched) {
    const { meta, path } = match;
    const { hideChildrenInMenu, hideInBreadcrumb, icon, name, title } =
      meta || {};
    if (hideInBreadcrumb || hideChildrenInMenu || !path) {
      continue;
    }

    resultBreadcrumb.push({
      icon,
      path: path || route.path,
      title: title ? $t((title || name) as string) : '',
    });
  }
  if (props.showHome) {
    resultBreadcrumb.unshift({
      icon: 'mdi:home-outline',
      isHome: true,
      path: '/',
    });
  }
  if (props.hideWhenOnlyOne && resultBreadcrumb.length === 1) {
    return [];
  }

  return resultBreadcrumb;
});

/** 点击面包屑项时跳转到对应路径。 */
function handleSelect(path: string) {
  router.push(path);
}
</script>
<template>
  <VbenBreadcrumbView
    :breadcrumbs="breadcrumbs"
    :show-icon="showIcon"
    :style-type="type"
    class="ml-2"
    @select="handleSelect"
  />
</template>
