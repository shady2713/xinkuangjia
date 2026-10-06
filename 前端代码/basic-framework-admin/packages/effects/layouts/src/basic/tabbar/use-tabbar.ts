/**
 * 标签栏的视图层状态：跟随路由与标签库同步当前标签，并生成右键菜单项。
 * 固定标签在菜单就绪时初始化，菜单项按偏好裁剪，点击与关闭复用 useTabs；
 * 标签的存储、持久化与排序由标签库 store 负责，本模块不持有标签数据。
 */
import type { RouteLocationNormalizedGeneric } from 'vue-router';

import type { TabDefinition } from '@vben/types';

import type { IContextMenuItem } from '@vben-core/tabs-ui';

import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useContentMaximize, useTabs } from '@vben/hooks';
import {
  ArrowLeftToLine,
  ArrowRightLeft,
  ArrowRightToLine,
  ExternalLink,
  FoldHorizontal,
  Fullscreen,
  Minimize2,
  Pin,
  PinOff,
  RotateCw,
  X,
} from '@vben/icons';
import { $t, useI18n } from '@vben/locales';
import { getTabKey, useAccessStore, useTabbarStore } from '@vben/stores';
import { filterTree } from '@vben/utils';

/**
 * 提供标签栏所需的当前标签、标签列表与交互方法，并生成右键菜单项。
 * 固定标签在权限菜单就绪时初始化，标签数据本身仍由标签库 store 持有。
 * @returns currentActive 当前标签键、currentTabs 本地化后的标签列表，以及点击、关闭与右键菜单生成方法。
 */
export function useTabbar() {
  const router = useRouter();
  const route = useRoute();
  const accessStore = useAccessStore();
  const tabbarStore = useTabbarStore();
  const { contentIsMaximize, toggleMaximize } = useContentMaximize();
  const {
    closeAllTabs,
    closeCurrentTab,
    closeLeftTabs,
    closeOtherTabs,
    closeRightTabs,
    closeTabByKey,
    getTabDisableState,
    openTabInNewWindow,
    refreshTab,
    toggleTabPin,
  } = useTabs();

  /**
   * 当前路径对应的tab的key
   */
  const currentActive = computed(() => {
    return getTabKey(route);
  });

  const { locale } = useI18n();
  const currentTabs = ref<RouteLocationNormalizedGeneric[]>();
  watch(
    [
      () => tabbarStore.getTabs,
      () => tabbarStore.updateTime,
      () => locale.value,
    ],
    ([tabs]) => {
      currentTabs.value = tabs.map((item) => wrapperTabLocale(item));
    },
  );

  /**
   * 初始化固定标签页
   */
  const initAffixTabs = () => {
    /** 从路由表中筛出全部固定标签路由；重复调用会整批覆盖标签库中的固定标签集合。 */
    const affixTabs = filterTree(router.getRoutes(), (route) => {
      return !!route.meta?.affixTab;
    });
    tabbarStore.setAffixTabs(affixTabs);
  };

  // 点击tab,跳转路由
  const handleClick = (key: string) => {
    const { fullPath, path } = tabbarStore.getTabByKey(key);
    router.push(fullPath || path);
  };

  // 关闭tab
  const handleClose = async (key: string) => {
    await closeTabByKey(key);
  };

  /** 复制标签对象并把标题按当前语言翻译；不修改传入的原始标签对象。 */
  function wrapperTabLocale(tab: RouteLocationNormalizedGeneric) {
    return {
      ...tab,
      meta: {
        ...tab?.meta,
        title: $t(tab?.meta?.title as string),
      },
    };
  }

  watch(
    () => accessStore.accessMenus,
    () => {
      initAffixTabs();
    },
    { immediate: true },
  );

  watch(
    () => route.fullPath,
    () => {
      const meta = route.matched?.[route.matched.length - 1]?.meta;
      tabbarStore.addTab({
        ...route,
        meta: meta || route.meta,
      });
    },
    { immediate: true },
  );

  /**
   * 生成标签的右键菜单项：按固定状态、最大化状态与各操作的禁用态组装，并按标签栏偏好裁剪。
   * @param tab 右键点击的标签，决定固定/取消固定文案与各操作是否可用。
   * @returns 可显示的菜单项列表；未在标签栏偏好中启用的项会被过滤掉。
   */
  const createContextMenus = (tab: TabDefinition) => {
    const {
      disabledCloseAll,
      disabledCloseCurrent,
      disabledCloseLeft,
      disabledCloseOther,
      disabledCloseRight,
      disabledRefresh,
    } = getTabDisableState(tab);

    const affixTab = tab?.meta?.affixTab ?? false;

    const menus: IContextMenuItem[] = [
      {
        disabled: disabledCloseCurrent,
        /** 关闭该标签并跳转到相邻标签。 */
        handler: async () => {
          await closeCurrentTab(tab);
        },
        icon: X,
        key: 'close',
        text: $t('preferences.tabbar.contextMenu.close'),
      },
      {
        /** 在固定与取消固定之间切换该标签。 */
        handler: async () => {
          await toggleTabPin(tab);
        },
        icon: affixTab ? PinOff : Pin,
        key: 'affix',
        text: affixTab
          ? $t('preferences.tabbar.contextMenu.unpin')
          : $t('preferences.tabbar.contextMenu.pin'),
      },
      {
        /** 进入最大化前先跳转到该标签；已在最大化时只切换状态，避免多余跳转。 */
        handler: async () => {
          if (!contentIsMaximize.value) {
            await router.push(tab.fullPath);
          }
          toggleMaximize();
        },
        icon: contentIsMaximize.value ? Minimize2 : Fullscreen,
        key: contentIsMaximize.value ? 'restore-maximize' : 'maximize',
        text: contentIsMaximize.value
          ? $t('preferences.tabbar.contextMenu.restoreMaximize')
          : $t('preferences.tabbar.contextMenu.maximize'),
      },
      {
        disabled: disabledRefresh,
        /** 刷新当前标签页视图。 */
        handler: () => refreshTab(),
        icon: RotateCw,
        key: 'reload',
        text: $t('preferences.tabbar.contextMenu.reload'),
      },
      {
        /** 在浏览器新窗口中打开该标签的路由。 */
        handler: async () => {
          await openTabInNewWindow(tab);
        },
        icon: ExternalLink,
        key: 'open-in-new-window',
        separator: true,
        text: $t('preferences.tabbar.contextMenu.openInNewWindow'),
      },

      {
        disabled: disabledCloseLeft,
        /** 关闭该标签左侧的全部标签。 */
        handler: async () => {
          await closeLeftTabs(tab);
        },
        icon: ArrowLeftToLine,
        key: 'close-left',
        text: $t('preferences.tabbar.contextMenu.closeLeft'),
      },
      {
        disabled: disabledCloseRight,
        /** 关闭该标签右侧的全部标签。 */
        handler: async () => {
          await closeRightTabs(tab);
        },
        icon: ArrowRightToLine,
        key: 'close-right',
        separator: true,
        text: $t('preferences.tabbar.contextMenu.closeRight'),
      },
      {
        disabled: disabledCloseOther,
        /** 关闭除该标签以外的其他标签。 */
        handler: async () => {
          await closeOtherTabs(tab);
        },
        icon: FoldHorizontal,
        key: 'close-other',
        text: $t('preferences.tabbar.contextMenu.closeOther'),
      },
      {
        disabled: disabledCloseAll,
        handler: closeAllTabs,
        icon: ArrowRightLeft,
        key: 'close-all',
        text: $t('preferences.tabbar.contextMenu.closeAll'),
      },
    ];

    return menus.filter((item) => tabbarStore.getMenuList.includes(item.key));
  };

  return {
    createContextMenus,
    currentActive,
    currentTabs,
    handleClick,
    handleClose,
  };
}
