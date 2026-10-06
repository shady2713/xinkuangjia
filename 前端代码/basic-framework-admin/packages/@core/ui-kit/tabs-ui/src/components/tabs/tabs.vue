<script lang="ts" setup>
/**
 * 普通标签栏：按 styleType 切换标签项外观。
 * 样式可选 plain、card、brisk，与 Chrome 风格共用属性契约；
 * active 双向绑定选中项，只渲染并抛出 close/unpin 事件，
 * 滚动、拖拽与路由跳转不在本组件内实现。
 */
import type { TabDefinition } from '@vben-core/typings';

import type { TabConfig, TabsProps } from '../../types';

import { computed } from 'vue';

import { Pin, X } from '@vben-core/icons';
import { VbenContextMenu, VbenIcon } from '@vben-core/shadcn-ui';

/** 标签页容器的属性契约别名：直接复用标签页属性，不额外声明成员。 */
type Props = TabsProps;

defineOptions({
  name: 'VbenTabs',

  inheritAttrs: false,
});
const props = withDefaults(defineProps<Props>(), {
  contentClass: 'vben-tabs-content',
  /** 右键菜单的缺省实现：返回空数组，即任何标签都不弹菜单；需要菜单的标签由使用方传入同名 prop 提供。 */
  contextMenus: () => [],
  /** 标签数据缺省为空数组：让 tabsView 的遍历不必判空，组件在没有任何标签时也能正常渲染。 */
  tabs: () => [],
});

const emit = defineEmits<{
  close: [string];
  unpin: [TabDefinition];
}>();
const active = defineModel<string>('active');

/** 按 styleType 取出标签项的类名：brisk、card、plain 各一套；未识别的取值回退为空类名，不会报错。 */
const typeWithClass = computed(() => {
  const typeClasses: Record<string, { content: string }> = {
    brisk: {
      content: `h-full after:content-['']  after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-primary after:scale-x-0 after:transition-[transform] after:ease-out after:duration-300 hover:after:scale-x-100 after:origin-left [&.is-active]:after:scale-x-100 [&:not(:first-child)]:border-l last:border-r last:border-r border-border`,
    },
    card: {
      content:
        'h-[calc(100%-6px)] rounded-md ml-2 border border-border  transition-all',
    },
    plain: {
      content:
        'h-full [&:not(:first-child)]:border-l last:border-r border-border',
    },
  };

  return typeClasses[props.styleType || 'plain'] || { content: '' };
});

/** 把路由标签定义摊平成普通标签项的渲染数据：同样补出关闭与固定标记，供模板按 styleType 换好外观后直接渲染。 */
const tabsView = computed(() => {
  return props.tabs.map((tab) => {
    const { fullPath, meta, name, path, key } = tab || {};
    const { affixTab, icon, newTabTitle, tabClosable, title } = meta || {};
    return {
      affixTab: !!affixTab,
      closable: Reflect.has(meta, 'tabClosable') ? !!tabClosable : true,
      fullPath,
      icon: icon as string,
      key,
      meta,
      name,
      path,
      title: (newTabTitle || title || name) as string,
    } as TabConfig;
  });
});

/** 普通标签的中键关闭：判据与 Chrome 风格一致，满足时先 preventDefault 再向上抛出该标签的 key，不满足时连默认行为都不拦。 */
function onMouseDown(e: MouseEvent, tab: TabConfig) {
  if (
    e.button === 1 &&
    tab.closable &&
    !tab.affixTab &&
    tabsView.value.length > 1 &&
    props.middleClickToClose
  ) {
    e.preventDefault();
    e.stopPropagation();
    emit('close', tab.key);
  }
}
</script>

<template>
  <div
    :class="contentClass"
    class="relative !flex h-full w-max items-center overflow-hidden pr-6"
  >
    <TransitionGroup name="slide-left">
      <div
        v-for="(tab, i) in tabsView"
        :key="tab.key"
        :class="[
          {
            'is-active bg-primary/15 dark:bg-accent': tab.key === active,
            draggable: !tab.affixTab,
            'affix-tab': tab.affixTab,
          },
          typeWithClass.content,
        ]"
        :data-index="i"
        class="tab-item translate-all group relative flex cursor-pointer select-none [&:not(.is-active)]:hover:bg-accent"
        data-tab-item="true"
        @click="active = tab.key"
        @mousedown="onMouseDown($event, tab)"
      >
        <VbenContextMenu
          :handler-data="tab"
          :menus="contextMenus"
          :modal="false"
          item-class="pr-6"
        >
          <div class="relative flex size-full items-center">
            <!-- extra -->
            <div
              class="absolute right-1.5 top-1/2 z-[3] translate-y-[-50%] overflow-hidden"
            >
              <!-- close-icon -->
              <X
                v-show="!tab.affixTab && tabsView.length > 1 && tab.closable"
                class="size-3 cursor-pointer rounded-full stroke-accent-foreground/80 transition-all hover:bg-accent hover:stroke-accent-foreground group-[.is-active]:text-primary dark:group-[.is-active]:text-accent-foreground"
                @click.stop="() => emit('close', tab.key)"
              />
              <Pin
                v-show="tab.affixTab && tabsView.length > 1 && tab.closable"
                class="mt-[1px] size-3.5 cursor-pointer rounded-full transition-all hover:bg-accent hover:stroke-accent-foreground group-[.is-active]:text-primary dark:group-[.is-active]:text-accent-foreground"
                @click.stop="() => emit('unpin', tab)"
              />
            </div>

            <!-- tab-item-main -->
            <div
              class="mx-3 mr-4 flex h-full items-center overflow-hidden rounded-tl-[5px] rounded-tr-[5px] pr-3 text-accent-foreground transition-all duration-300 group-[.is-active]:text-primary dark:group-[.is-active]:text-accent-foreground"
            >
              <VbenIcon
                v-if="showIcon"
                :icon="tab.icon"
                class="mr-2 flex size-4 items-center overflow-hidden group-hover:animate-[shrink_0.3s_ease-in-out]"
                fallback
              />

              <span class="flex-1 overflow-hidden whitespace-nowrap text-sm">
                {{ tab.title }}
              </span>
            </div>
          </div>
        </VbenContextMenu>
      </div>
    </TransitionGroup>
  </div>
</template>
