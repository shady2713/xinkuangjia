<script setup lang="ts">
/**
 * 后台整体布局：装配顶栏、标签栏、侧边栏、内容区与页脚。
 * 负责滚动隐藏顶栏、悬停展开侧边栏与移动端遮罩等交互，
 * 宽度与排列规则交由 hooks/use-layout 及各子组件计算；
 * 不提供菜单数据与路由跳转，内容一律由插槽使用方给出。
 */
import type { CSSProperties } from 'vue';

import type { VbenLayoutProps } from './admin-layout';

import { computed, ref, watch } from 'vue';

import {
  SCROLL_FIXED_CLASS,
  useLayoutFooterStyle,
  useLayoutHeaderStyle,
} from '@vben-core/composables';
import { IconifyIcon } from '@vben-core/icons';
import { VbenIconButton } from '@vben-core/shadcn-ui';
import { ELEMENT_ID_MAIN_CONTENT } from '@vben-core/shared/constants';

import { useMouse, useScroll, useThrottleFn } from '@vueuse/core';

import {
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutSidebar,
  LayoutTabbar,
} from './components';
import { useLayout } from './hooks/use-layout';

/** 后台布局的属性契约别名：直接复用布局属性，不额外声明成员。 */
type Props = VbenLayoutProps;

defineOptions({
  name: 'VbenLayout',
});

const props = withDefaults(defineProps<Props>(), {
  contentCompact: 'wide',
  contentCompactWidth: 1200,
  contentPadding: 0,
  contentPaddingBottom: 0,
  contentPaddingLeft: 0,
  contentPaddingRight: 0,
  contentPaddingTop: 0,
  footerEnable: false,
  footerFixed: true,
  footerHeight: 32,
  headerHeight: 50,
  headerHidden: false,
  headerMode: 'fixed',
  headerToggleSidebarButton: true,
  headerVisible: true,
  isMobile: false,
  layout: 'sidebar-nav',
  sidebarCollapsedButton: true,
  sidebarCollapseShowTitle: false,
  sidebarExtraCollapsedWidth: 60,
  sidebarFixedButton: true,
  sidebarHidden: false,
  sidebarMixedWidth: 80,
  sidebarTheme: 'dark',
  sidebarWidth: 180,
  sideCollapseWidth: 60,
  tabbarEnable: true,
  tabbarHeight: 40,
  zIndex: 200,
});

const emit = defineEmits<{ sideMouseLeave: []; toggleSidebar: [] }>();
const sidebarCollapse = defineModel<boolean>('sidebarCollapse', {
  default: false,
});
const sidebarExtraVisible = defineModel<boolean>('sidebarExtraVisible');
const sidebarExtraCollapse = defineModel<boolean>('sidebarExtraCollapse', {
  default: false,
});
const sidebarExpandOnHover = defineModel<boolean>('sidebarExpandOnHover', {
  default: false,
});
const sidebarEnable = defineModel<boolean>('sidebarEnable', { default: true });

// side是否处于hover状态展开菜单中
const sidebarExpandOnHovering = ref(false);
const headerIsHidden = ref(false);
const contentRef = ref();

const {
  arrivedState,
  directions,
  isScrolling,
  y: scrollY,
} = useScroll(document);

const { setLayoutHeaderHeight } = useLayoutHeaderStyle();
const { setLayoutFooterHeight } = useLayoutFooterStyle();

const { y: mouseY } = useMouse({ target: contentRef, type: 'client' });

const {
  currentLayout,
  isFullContent,
  isHeaderMixedNav,
  isHeaderNav,
  isMixedNav,
  isSidebarMixedNav,
} = useLayout(props);

/**
 * 顶栏是否自动隐藏
 */
const isHeaderAutoMode = computed(() => props.headerMode === 'auto');

/**
 * 顶栏与标签栏合计占位的高度：仅当顶栏可见且未被显式隐藏时才计入顶栏高度，
 * 标签栏开启时再叠加其高度。两项都不成立时为 0，供内容区上边距与顶栏收起位移复用。
 * @returns 顶栏与标签栏的合计高度（像素）。
 */
const headerWrapperHeight = computed(() => {
  let height = 0;
  if (props.headerVisible && !props.headerHidden) {
    height += props.headerHeight;
  }
  if (props.tabbarEnable) {
    height += props.tabbarHeight;
  }
  return height;
});

/**
 * 侧栏折叠后的窄栏宽度：折叠后仍需显示标题，或处于侧边混合、头部混合导航时，
 * 窄栏还要容下一列混合菜单图标，因此取 sidebarMixedWidth；
 * 其余布局取 sideCollapseWidth，只留图标宽度。
 */
const getSideCollapseWidth = computed(() => {
  const { sidebarCollapseShowTitle, sidebarMixedWidth, sideCollapseWidth } =
    props;

  return sidebarCollapseShowTitle ||
    isSidebarMixedNav.value ||
    isHeaderMixedNav.value
    ? sidebarMixedWidth
    : sideCollapseWidth;
});

/**
 * 动态获取侧边区域是否可见
 */
const sidebarEnableState = computed(() => {
  return !isHeaderNav.value && sidebarEnable.value;
});

/**
 * 侧边区域离顶部高度
 */
const sidebarMarginTop = computed(() => {
  const { headerHeight, isMobile } = props;
  return isMixedNav.value && !isMobile ? headerHeight : 0;
});

/**
 * 动态获取侧边宽度
 *
 * 侧边区域不可见时宽度必须为 0，否则内容区会被压窄。两处判定都保留：
 * 先按"侧边区域被隐藏且当前布局没有其它侧边列"归零，再对剩余的隐藏场景兜底归零。
 * 两种顺序的返回值完全一致（隐藏时一律为 0），但把复合判定放在前面后，
 * 隐藏状态下的布局分支才真正参与求值，不再是永远不会被求值的冗余条件。
 */
const getSidebarWidth = computed(
  /**
   * 计算侧边区域的占位宽度。
   * @returns 侧边区域宽度（像素）；侧边被隐藏或当前布局不显示侧边时为 0。
   */
  () => {
    const { isMobile, sidebarHidden, sidebarMixedWidth, sidebarWidth } = props;
    let width = 0;

    if (
      !sidebarEnableState.value ||
      (sidebarHidden &&
        !isSidebarMixedNav.value &&
        !isMixedNav.value &&
        !isHeaderMixedNav.value)
    ) {
      return width;
    }

    if (sidebarHidden) {
      return width;
    }

    if ((isHeaderMixedNav.value || isSidebarMixedNav.value) && !isMobile) {
      width = sidebarMixedWidth;
    } else if (sidebarCollapse.value) {
      width = isMobile ? 0 : getSideCollapseWidth.value;
    } else {
      width = sidebarWidth;
    }
    return width;
  },
);

/**
 * 获取扩展区域宽度
 */
const sidebarExtraWidth = computed(() => {
  const { sidebarExtraCollapsedWidth, sidebarWidth } = props;

  return sidebarExtraCollapse.value ? sidebarExtraCollapsedWidth : sidebarWidth;
});

/**
 * 是否侧边栏模式，包含混合侧边
 */
const isSideMode = computed(
  () =>
    currentLayout.value === 'mixed-nav' ||
    currentLayout.value === 'sidebar-mixed-nav' ||
    currentLayout.value === 'sidebar-nav' ||
    currentLayout.value === 'header-mixed-nav' ||
    currentLayout.value === 'header-sidebar-nav',
);

/**
 * header fixed值
 */
const headerFixed = computed(() => {
  const { headerMode } = props;
  return (
    isMixedNav.value ||
    headerMode === 'fixed' ||
    headerMode === 'auto-scroll' ||
    headerMode === 'auto'
  );
});

/** 侧栏外壳是否需要渲染：仅侧边类布局且侧栏启用时为真，顶部导航布局下不占位。 */
const showSidebar = computed(() => {
  return isSideMode.value && sidebarEnable.value && !props.sidebarHidden;
});

/**
 * 遮罩可见性
 */
const maskVisible = computed(() => !sidebarCollapse.value && props.isMobile);

/**
 * 主内容列的宽度与左侧让位宽度。
 * 仅在顶栏固定、布局不是 header-nav、mixed-nav 与 header-sidebar-nav、侧栏可见且非移动端时才让出侧栏宽度，其余情况占满整行。
 * 让位时分两种侧栏：混合布局、已开启固定悬停展开且副菜单列当前可见时，同时让出窄栏与副菜单列的合计宽度；
 * 否则让出侧栏实际宽度，鼠标已悬停但未开启固定悬停展开时按窄栏宽度让位。
 * @returns sidebarAndExtraWidth 为侧栏与副菜单列的合计像素宽度（未参与计算时为 'unset'），
 * width 为主内容列宽度（'100%' 或 calc(100% - 侧栏宽度)）。
 */
const mainStyle = computed(() => {
  let width = '100%';
  let sidebarAndExtraWidth = 'unset';
  if (
    headerFixed.value &&
    currentLayout.value !== 'header-nav' &&
    currentLayout.value !== 'mixed-nav' &&
    currentLayout.value !== 'header-sidebar-nav' &&
    showSidebar.value &&
    !props.isMobile
  ) {
    // fixed模式下生效
    const isSideNavEffective =
      (isSidebarMixedNav.value || isHeaderMixedNav.value) &&
      sidebarExpandOnHover.value &&
      sidebarExtraVisible.value;

    if (isSideNavEffective) {
      const sideCollapseWidth = sidebarCollapse.value
        ? getSideCollapseWidth.value
        : props.sidebarMixedWidth;
      const sideWidth = sidebarExtraCollapse.value
        ? props.sidebarExtraCollapsedWidth
        : props.sidebarWidth;

      // 100% - 侧边菜单混合宽度 - 菜单宽度
      sidebarAndExtraWidth = `${sideCollapseWidth + sideWidth}px`;
      width = `calc(100% - ${sidebarAndExtraWidth})`;
    } else {
      sidebarAndExtraWidth =
        sidebarExpandOnHovering.value && !sidebarExpandOnHover.value
          ? `${getSideCollapseWidth.value}px`
          : `${getSidebarWidth.value}px`;
      width = `calc(100% - ${sidebarAndExtraWidth})`;
    }
  }
  return {
    sidebarAndExtraWidth,
    width,
  };
});

// 计算 tabbar 的样式
const tabbarStyle = computed((): CSSProperties => {
  let width = '';
  let marginLeft = 0;

  // 如果不是混合导航，tabbar 的宽度为 100%
  if (!isMixedNav.value || props.sidebarHidden) {
    width = '100%';
  } else if (sidebarEnable.value) {
    // 鼠标在侧边栏上时，且侧边栏展开时的宽度
    const onHoveringWidth = sidebarExpandOnHover.value
      ? props.sidebarWidth
      : getSideCollapseWidth.value;

    // 设置 marginLeft，根据侧边栏是否折叠来决定
    marginLeft = sidebarCollapse.value
      ? getSideCollapseWidth.value
      : onHoveringWidth;

    // 设置 tabbar 的宽度，计算方式为 100% 减去侧边栏的宽度
    width = `calc(100% - ${sidebarCollapse.value ? getSidebarWidth.value : onHoveringWidth}px)`;
  } else {
    // 默认情况下，tabbar 的宽度为 100%
    width = '100%';
  }

  return {
    marginLeft: `${marginLeft}px`,
    width,
  };
});

/**
 * 内容区的上边距与底部留白：顶栏固定、非全屏内容布局、顶栏未隐藏，
 * 且（非 auto 模式或页面尚未滚过顶栏与标签栏的合计高度）时，按该合计高度下压内容；
 * 否则上边距归零交还顶栏。底部仅在页脚开启且固定时按页脚高度预留，避免固定页脚盖住内容。
 * @returns 内容区的 marginTop 与 paddingBottom 内联样式（单位像素）。
 */
const contentStyle = computed((): CSSProperties => {
  const fixed = headerFixed.value;

  const { footerEnable, footerFixed, footerHeight } = props;
  return {
    marginTop:
      fixed &&
      !isFullContent.value &&
      !headerIsHidden.value &&
      (!isHeaderAutoMode.value || scrollY.value < headerWrapperHeight.value)
        ? `${headerWrapperHeight.value}px`
        : 0,
    paddingBottom: `${footerEnable && footerFixed ? footerHeight : 0}px`,
  };
});

/** 顶栏层级：以基线 zIndex 为起点，仅混合导航再加 1，其余布局直接取基线值；与侧栏层级各自独立计算。 */
const headerZIndex = computed(() => {
  const { zIndex } = props;
  const offset = isMixedNav.value ? 1 : 0;
  return zIndex + offset;
});

/**
 * 顶栏容器的定位样式：全屏内容布局下高度归零，顶栏隐藏或全屏内容布局时 top 取顶栏与标签栏合计高度的负值实现收起；
 * 混合导航贴左铺满，其余布局按主内容列宽度让出左侧。
 * 顶栏固定时用 fixed 脱离文档流，否则保持 static 随页面滚动。
 * @returns 顶栏容器的 height、left、position、top、width 与 z-index 内联样式。
 */
const headerWrapperStyle = computed((): CSSProperties => {
  const fixed = headerFixed.value;
  return {
    height: isFullContent.value ? '0' : `${headerWrapperHeight.value}px`,
    left: isMixedNav.value ? 0 : mainStyle.value.sidebarAndExtraWidth,
    position: fixed ? 'fixed' : 'static',
    top:
      headerIsHidden.value || isFullContent.value
        ? `-${headerWrapperHeight.value}px`
        : 0,
    width: mainStyle.value.width,
    'z-index': headerZIndex.value,
  };
});

/**
 * 侧边栏z-index
 */
const sidebarZIndex = computed(() => {
  const { isMobile, zIndex } = props;
  let offset = isMobile || isSideMode.value ? 1 : -1;

  if (isMixedNav.value) {
    offset += 1;
  }

  return zIndex + offset;
});

/** 页脚宽度：页脚不固定时随父容器占满整行；固定时与主内容列同宽，避免覆盖到侧栏区域。 */
const footerWidth = computed(() => {
  if (!props.footerFixed) {
    return '100%';
  }

  return mainStyle.value.width;
});

/** 移动端遮罩的层级：直接采用基线 zIndex，侧栏在移动端会额外加 1 从而仍浮在遮罩之上，遮罩则盖住没有层级的内容列。 */
const maskStyle = computed((): CSSProperties => {
  return { zIndex: props.zIndex };
});

/** 顶栏是否渲染侧栏切换按钮：移动端始终显示；桌面端需开启 headerToggleSidebarButton、处于侧边类布局，且不是侧边混合与混合导航。 */
const showHeaderToggleButton = computed(() => {
  return (
    props.isMobile ||
    (props.headerToggleSidebarButton &&
      isSideMode.value &&
      !isSidebarMixedNav.value &&
      !isMixedNav.value &&
      !props.isMobile)
  );
});

/** logo 槽位是否交由顶栏承载：非侧边类布局、混合导航或移动端下顶栏需要自己显示 logo。 */
const showHeaderLogo = computed(() => {
  return !isSideMode.value || isMixedNav.value || props.isMobile;
});

watch(
  () => props.isMobile,
  (val) => {
    if (val) {
      sidebarCollapse.value = true;
    }
  },
  {
    immediate: true,
  },
);

watch(
  [() => headerWrapperHeight.value, () => isFullContent.value],
  ([height]) => {
    setLayoutHeaderHeight(isFullContent.value ? 0 : height);
  },
  {
    immediate: true,
  },
);

watch(
  () => props.footerHeight,
  (height: number) => {
    setLayoutFooterHeight(height);
  },
  {
    immediate: true,
  },
);

{
  const HEADER_TRIGGER_DISTANCE = 12;

  watch(
    [() => props.headerMode, () => mouseY.value, () => headerIsHidden.value],
    () => {
      if (!isHeaderAutoMode.value || isMixedNav.value || isFullContent.value) {
        if (props.headerMode !== 'auto-scroll') {
          headerIsHidden.value = false;
        }
        return;
      }

      const isInTriggerZone = mouseY.value <= HEADER_TRIGGER_DISTANCE;
      const isInHeaderZone =
        !headerIsHidden.value && mouseY.value <= headerWrapperHeight.value;

      headerIsHidden.value = !(isInTriggerZone || isInHeaderZone);
    },
    {
      immediate: true,
    },
  );
}

{
  /**
   * auto-scroll 模式下按滚动方向决定顶栏收起的节流判定，300ms 内最多执行一次。
   * 尚未滚过顶栏与标签栏的合计高度、或滚动已回到容器顶部时展开顶栏；
   * 否则只有继续向下滚才收起，向上滚时保持当前状态不变。
   * @param top 本次滚动方向是否为向上。
   * @param bottom 本次滚动方向是否为向下。
   * @param topArrived 滚动容器是否已到达顶部。
   */
  const checkHeaderIsHidden = useThrottleFn((top, bottom, topArrived) => {
    if (scrollY.value < headerWrapperHeight.value) {
      headerIsHidden.value = false;
      return;
    }
    if (topArrived) {
      headerIsHidden.value = false;
      return;
    }

    if (top) {
      headerIsHidden.value = false;
    } else if (bottom) {
      headerIsHidden.value = true;
    }
  }, 300);

  watch(
    () => scrollY.value,
    () => {
      if (
        props.headerMode !== 'auto-scroll' ||
        isMixedNav.value ||
        isFullContent.value
      ) {
        return;
      }
      if (isScrolling.value) {
        checkHeaderIsHidden(
          directions.top,
          directions.bottom,
          arrivedState.top,
        );
      }
    },
  );
}

/** 点击移动端遮罩：直接折叠侧栏让内容区重新可见，不向外派发 toggleSidebar。 */
function handleClickMask() {
  sidebarCollapse.value = true;
}

/** 顶栏切换按钮的点击处理：移动端直接展开侧栏；桌面端不自行改状态，改为向外派发 toggleSidebar 由使用方决定。 */
function handleHeaderToggle() {
  if (props.isMobile) {
    sidebarCollapse.value = false;
  } else {
    emit('toggleSidebar');
  }
}

const idMainContent = ELEMENT_ID_MAIN_CONTENT;
</script>

<template>
  <div class="relative flex min-h-full w-full">
    <LayoutSidebar
      v-if="sidebarEnableState"
      v-model:collapse="sidebarCollapse"
      v-model:expand-on-hover="sidebarExpandOnHover"
      v-model:expand-on-hovering="sidebarExpandOnHovering"
      v-model:extra-collapse="sidebarExtraCollapse"
      v-model:extra-visible="sidebarExtraVisible"
      :show-collapse-button="sidebarCollapsedButton"
      :show-fixed-button="sidebarFixedButton"
      :collapse-width="getSideCollapseWidth"
      :dom-visible="!isMobile"
      :extra-width="sidebarExtraWidth"
      :fixed-extra="sidebarExpandOnHover"
      :header-height="isMixedNav ? 0 : headerHeight"
      :is-sidebar-mixed="isSidebarMixedNav || isHeaderMixedNav"
      :margin-top="sidebarMarginTop"
      :mixed-width="sidebarMixedWidth"
      :show="showSidebar"
      :theme="sidebarTheme"
      :width="getSidebarWidth"
      :z-index="sidebarZIndex"
      @leave="() => emit('sideMouseLeave')"
    >
      <template v-if="isSideMode && !isMixedNav" #logo>
        <slot name="logo"></slot>
      </template>

      <template v-if="isSidebarMixedNav || isHeaderMixedNav">
        <slot name="mixed-menu"></slot>
      </template>
      <template v-else>
        <slot name="menu"></slot>
      </template>

      <template #extra>
        <slot name="side-extra"></slot>
      </template>
      <template #extra-title>
        <slot name="side-extra-title"></slot>
      </template>
    </LayoutSidebar>

    <div
      ref="contentRef"
      class="flex flex-1 flex-col overflow-hidden transition-all duration-300 ease-in"
    >
      <div
        :class="[
          {
            'shadow-[0_16px_24px_hsl(var(--background))]': scrollY > 20,
          },
          SCROLL_FIXED_CLASS,
        ]"
        :style="headerWrapperStyle"
        class="overflow-hidden transition-all duration-200"
      >
        <LayoutHeader
          v-if="headerVisible"
          :full-width="!isSideMode"
          :height="headerHeight"
          :is-mobile="isMobile"
          :show="!isFullContent && !headerHidden"
          :sidebar-width="sidebarWidth"
          :theme="headerTheme"
          :width="mainStyle.width"
          :z-index="headerZIndex"
        >
          <template v-if="showHeaderLogo" #logo>
            <slot name="logo"></slot>
          </template>

          <template #toggle-button>
            <VbenIconButton
              v-if="showHeaderToggleButton"
              class="my-0 mr-1 rounded-md"
              @click="handleHeaderToggle"
            >
              <IconifyIcon v-if="showSidebar" icon="ep:fold" />
              <IconifyIcon v-else icon="ep:expand" />
            </VbenIconButton>
          </template>
          <slot name="header"></slot>
        </LayoutHeader>

        <LayoutTabbar
          v-if="tabbarEnable"
          :height="tabbarHeight"
          :style="tabbarStyle"
        >
          <slot name="tabbar"></slot>
        </LayoutTabbar>
      </div>

      <!-- </div> -->
      <LayoutContent
        :id="idMainContent"
        :content-compact="contentCompact"
        :content-compact-width="contentCompactWidth"
        :padding="contentPadding"
        :padding-bottom="contentPaddingBottom"
        :padding-left="contentPaddingLeft"
        :padding-right="contentPaddingRight"
        :padding-top="contentPaddingTop"
        :style="contentStyle"
        class="transition-[margin-top] duration-200"
      >
        <slot name="content"></slot>

        <template #overlay>
          <slot name="content-overlay"></slot>
        </template>
      </LayoutContent>

      <LayoutFooter
        v-if="footerEnable"
        :fixed="footerFixed"
        :height="footerHeight"
        :show="!isFullContent"
        :width="footerWidth"
        :z-index="zIndex"
      >
        <slot name="footer"></slot>
      </LayoutFooter>
    </div>
    <slot name="extra"></slot>
    <div
      v-if="maskVisible"
      :style="maskStyle"
      class="fixed left-0 top-0 h-full w-full bg-overlay transition-[background-color] duration-200"
      @click="handleClickMask"
    ></div>
  </div>
</template>
