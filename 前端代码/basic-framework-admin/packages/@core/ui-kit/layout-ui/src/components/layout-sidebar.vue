<script setup lang="ts">
/**
 * 布局侧边栏：承载纵向菜单，支持折叠、悬停展开与侧边混合模式的副菜单列。
 *
 * 宽度由 props 与各双向绑定状态算出，折叠/固定按钮取自 widgets；
 * 菜单数据、路由高亮与权限过滤由插槽注入的菜单组件负责。
 */
import type { CSSProperties } from 'vue';

import { computed, shallowRef, useSlots, watchEffect } from 'vue';

import { VbenScrollbar } from '@vben-core/shadcn-ui';

import { useScrollLock } from '@vueuse/core';

import { SidebarCollapseButton, SidebarFixedButton } from './widgets';

/**
 * 侧边栏的属性契约：宽度不由本组件决定，全部由外壳算好后传入——
 * width 是侧栏实际占位宽度，collapseWidth 是折叠后的窄栏宽度，mixedWidth 是混合布局的窄栏宽度，
 * extraWidth 是副菜单列宽度；collapseHeight、headerHeight、marginTop、paddingTop 决定各区域的留白；
 * show 控制显隐，fixedExtra 与 isSidebarMixed 决定副菜单列是否参与排布，domVisible 控制是否渲染占位层，
 * theme 与 zIndex 仅用于外观与层级。
 */
interface Props {
  /**
   * 折叠区域高度
   * @default 42
   */
  collapseHeight?: number;
  /**
   * 折叠宽度
   * @default 48
   */
  collapseWidth?: number;
  /**
   * 隐藏的dom是否可见
   * @default true
   */
  domVisible?: boolean;
  /**
   * 扩展区域宽度
   */
  extraWidth: number;
  /**
   * 固定扩展区域
   * @default false
   */
  fixedExtra?: boolean;
  /**
   * 头部高度
   */
  headerHeight: number;
  /**
   * 是否侧边混合模式
   * @default false
   */
  isSidebarMixed?: boolean;
  /**
   * 顶部margin
   * @default 60
   */
  marginTop?: number;
  /**
   * 混合菜单宽度
   * @default 80
   */
  mixedWidth?: number;
  /**
   * 顶部padding
   * @default 60
   */
  paddingTop?: number;
  /**
   * 是否显示
   * @default true
   */
  show?: boolean;
  /**
   * 显示折叠按钮
   * @default true
   */
  showCollapseButton?: boolean;
  /**
   * 显示固定按钮
   * @default true
   */
  showFixedButton?: boolean;
  /**
   * 主题
   */
  theme: string;

  /**
   * 宽度
   */
  width: number;
  /**
   * zIndex
   * @default 0
   */
  zIndex?: number;
}

const props = withDefaults(defineProps<Props>(), {
  collapseHeight: 42,
  collapseWidth: 48,
  domVisible: true,
  fixedExtra: false,
  isSidebarMixed: false,
  marginTop: 0,
  mixedWidth: 70,
  paddingTop: 0,
  show: true,
  showCollapseButton: true,
  showFixedButton: true,
  zIndex: 0,
});

const emit = defineEmits<{ leave: [] }>();
const collapse = defineModel<boolean>('collapse');
const extraCollapse = defineModel<boolean>('extraCollapse');
const expandOnHovering = defineModel<boolean>('expandOnHovering');
const expandOnHover = defineModel<boolean>('expandOnHover');
const extraVisible = defineModel<boolean>('extraVisible');

const isLocked = useScrollLock(document.body);
const slots = useSlots();

// @ts-expect-error unused
const asideRef = shallowRef<HTMLDivElement | null>();

/**
 * 占位层的宽度样式：domVisible 为真时先渲染一个同宽的透明 div 占住侧栏在文档流里的位置，
 * 真正的侧栏是 fixed 定位会浮在它之上。此处按“隐藏侧栏”口径计算，
 * 鼠标悬停且未开启固定悬停展开时占位层收缩到折叠宽度，把让位空间腾给展开后的侧栏去覆盖。
 */
const hiddenSideStyle = computed((): CSSProperties => calcMenuWidthStyle(true));

/**
 * 侧栏本体的宽度与定位样式：宽度按“实际侧栏”口径计算，与占位层相差一个悬停分支；
 * 高度扣掉 marginTop 预留出顶栏空间，paddingTop 由外壳注入。
 * 侧边混合且副菜单列可见时关闭宽度过渡，避免两列同时动画时出现错位。
 */
const style = computed((): CSSProperties => {
  const { isSidebarMixed, marginTop, paddingTop, zIndex } = props;

  return {
    '--scroll-shadow': 'var(--sidebar)',
    ...calcMenuWidthStyle(false),
    height: `calc(100% - ${marginTop}px)`,
    marginTop: `${marginTop}px`,
    paddingTop: `${paddingTop}px`,
    zIndex,
    ...(isSidebarMixed && extraVisible.value ? { transition: 'none' } : {}),
  };
});

/**
 * 副菜单列的定位样式：列的左边缘固定贴主侧栏右缘（left 取主侧栏宽度），
 * 宽度只有在该列可见且 show 为真时才取 extraWidth，否则为 0，即不占位也不遮挡。
 */
const extraStyle = computed((): CSSProperties => {
  const { extraWidth, show, width, zIndex } = props;

  return {
    left: `${width}px`,
    width: extraVisible.value && show ? `${extraWidth}px` : 0,
    zIndex,
  };
});

/** 副菜单列标题区的高度：与主侧栏 logo 区对齐，并扣掉 1px 抵消 header 的下边框。 */
const extraTitleStyle = computed((): CSSProperties => {
  const { headerHeight } = props;

  return {
    height: `${headerHeight - 1}px`,
  };
});

/**
 * 菜单与 logo 区的宽度约束：仅在侧边混合且副菜单列被固定（fixedExtra）时才生效，
 * 折叠时取折叠宽度 collapseWidth、展开时取混合宽度 mixedWidth。
 * 其余布局返回空对象，宽度完全沿用 calcMenuWidthStyle 算出的结果，不在此处再收窄。
 */
const contentWidthStyle = computed((): CSSProperties => {
  const { collapseWidth, fixedExtra, isSidebarMixed, mixedWidth } = props;
  if (isSidebarMixed && fixedExtra) {
    return { width: `${collapse.value ? collapseWidth : mixedWidth}px` };
  }
  return {};
});

/** 主菜单滚动区的样式：高度扣掉顶栏与折叠按钮占位，内边距固定 8px，并复用混合布局下的宽度约束。 */
const contentStyle = computed((): CSSProperties => {
  const { collapseHeight, headerHeight } = props;

  return {
    height: `calc(100% - ${headerHeight + collapseHeight}px)`,
    paddingTop: '8px',
    ...contentWidthStyle.value,
  };
});

/**
 * logo 区的样式：高度与顶栏对齐并扣掉 1px 边框；仅侧边混合时才改为 flex 居中，
 * 让图标在混合导航的窄列里水平居中，其余布局保持左对齐。同样复用混合布局下的宽度约束。
 */
const headerStyle = computed((): CSSProperties => {
  const { headerHeight, isSidebarMixed } = props;

  return {
    ...(isSidebarMixed ? { display: 'flex', justifyContent: 'center' } : {}),
    height: `${headerHeight - 1}px`,
    ...contentWidthStyle.value,
  };
});

/** 副菜单列滚动区的高度：与主菜单区一样扣掉顶栏与折叠按钮占位，使两列底部对齐。 */
const extraContentStyle = computed((): CSSProperties => {
  const { collapseHeight, headerHeight } = props;
  return {
    height: `calc(100% - ${headerHeight + collapseHeight}px)`,
  };
});

/** 菜单区底部的占位块：撑出折叠按钮所在的高度，避免滚动区把按钮压住或盖住。 */
const collapseStyle = computed((): CSSProperties => {
  return {
    height: `${props.collapseHeight}px`,
  };
});

watchEffect(() => {
  extraVisible.value = props.fixedExtra ? true : extraVisible.value;
});

/**
 * 算出侧栏（含副菜单列）的横向占位宽度与显隐方式，侧栏本体与占位层共用这一份口径。
 *
 * 依赖的属性为 width、extraWidth、fixedExtra、isSidebarMixed、show、collapseWidth，
 * 依赖的双向状态为 extraVisible、expandOnHovering、expandOnHover。
 * width 为 0 表示完全不占位（侧栏被隐藏或移动端已折叠），此时宽度直接取 0px，
 * 并额外补 overflow: hidden 避免收起后仍溢出内容；width 非 0 时，
 * 只有“侧边混合、副菜单列被固定、该列当前可见”三个条件同时成立，才把 extraWidth 叠加到 width 上。
 * 宽度全程不做上下限钳制，完全采用外壳传入的数值；返回的 minWidth、maxWidth、width 与 flex-basis 取同一个值，
 * 因此侧栏既不会被 flex 压缩也不会被拉伸，实际宽度只由上述两步决定。
 * show 为假时保持宽度不变，改用等宽的负左边距把侧栏整体移出视口。
 * @param isHiddenDom 是否为占位层计算。占位层在“鼠标正在悬停且未开启固定悬停展开”时改用 collapseWidth，
 * 把让位空间腾给展开后的侧栏去覆盖内容区；侧栏本体传 false，宽度不随悬停收缩。
 * @returns 宽度、flex-basis 与负左边距组成的 CSSProperties；宽度为 0 时附带 overflow: hidden。
 */
function calcMenuWidthStyle(isHiddenDom: boolean): CSSProperties {
  const { extraWidth, fixedExtra, isSidebarMixed, show, width } = props;

  let widthValue =
    width === 0
      ? '0px'
      : `${width + (isSidebarMixed && fixedExtra && extraVisible.value ? extraWidth : 0)}px`;

  const { collapseWidth } = props;

  if (isHiddenDom && expandOnHovering.value && !expandOnHover.value) {
    widthValue = `${collapseWidth}px`;
  }

  return {
    ...(widthValue === '0px' ? { overflow: 'hidden' } : {}),
    flex: `0 0 ${widthValue}`,
    marginLeft: show ? 0 : `-${widthValue}`,
    maxWidth: widthValue,
    minWidth: widthValue,
    width: widthValue,
  };
}

/**
 * 鼠标进入侧栏时按悬停展开：命中左边缘 10px 内（避免贴边时误触发）或已开启固定悬停展开时直接返回；
 * 否则在尚未悬停的情况下把折叠状态放开、标记正在悬停展开。侧边混合模式额外锁住 body 滚动，
 * 避免展开出的副菜单列跟随页面一起滚动。
 * @param e 鼠标事件，用 offsetX 判断指针是否落在侧栏左边缘 10px 的触发带内。
 */
function handleMouseenter(e: MouseEvent) {
  if (e?.offsetX < 10) {
    return;
  }

  // 未开启和未折叠状态不生效
  if (expandOnHover.value) {
    return;
  }
  if (!expandOnHovering.value) {
    collapse.value = false;
  }
  if (props.isSidebarMixed) {
    isLocked.value = true;
  }
  expandOnHovering.value = true;
}

/**
 * 鼠标离开侧栏后的收尾：无论是否固定展开，都会先向外派发 leave 供使用方感知；
 * 侧边混合模式同时解锁 body 滚动。已开启固定悬停展开时到此为止（保持展开与副菜单列可见），
 * 否则结束悬停状态、重新折叠侧栏并隐藏副菜单列。
 */
function handleMouseleave() {
  emit('leave');
  if (props.isSidebarMixed) {
    isLocked.value = false;
  }
  if (expandOnHover.value) {
    return;
  }

  expandOnHovering.value = false;
  collapse.value = true;
  extraVisible.value = false;
}
</script>

<template>
  <div
    v-if="domVisible"
    :class="theme"
    :style="hiddenSideStyle"
    class="h-full transition-all duration-150"
  ></div>
  <aside
    :class="[
      theme,
      {
        'bg-sidebar-deep': isSidebarMixed,
        'border-r border-border bg-sidebar': !isSidebarMixed,
      },
    ]"
    :style="style"
    class="fixed left-0 top-0 h-full transition-all duration-150"
    @mouseenter="handleMouseenter"
    @mouseleave="handleMouseleave"
  >
    <SidebarFixedButton
      v-if="!collapse && !isSidebarMixed && showFixedButton"
      v-model:expand-on-hover="expandOnHover"
    />
    <div v-if="slots.logo" :style="headerStyle">
      <slot name="logo"></slot>
    </div>
    <VbenScrollbar :style="contentStyle" shadow shadow-border>
      <slot></slot>
    </VbenScrollbar>

    <div :style="collapseStyle"></div>
    <SidebarCollapseButton
      v-if="showCollapseButton && !isSidebarMixed"
      v-model:collapsed="collapse"
    />
    <div
      v-if="isSidebarMixed"
      ref="asideRef"
      :class="{
        'border-l': extraVisible,
      }"
      :style="extraStyle"
      class="fixed top-0 h-full overflow-hidden border-r border-border bg-sidebar transition-all duration-200"
    >
      <SidebarCollapseButton
        v-if="isSidebarMixed && expandOnHover"
        v-model:collapsed="extraCollapse"
      />

      <SidebarFixedButton
        v-if="!extraCollapse"
        v-model:expand-on-hover="expandOnHover"
      />
      <div v-if="!extraCollapse" :style="extraTitleStyle" class="pl-2">
        <slot name="extra-title"></slot>
      </div>
      <VbenScrollbar
        :style="extraContentStyle"
        class="border-border py-2"
        shadow
        shadow-border
      >
        <slot name="extra"></slot>
      </VbenScrollbar>
    </div>
  </aside>
</template>
