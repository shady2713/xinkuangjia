/**
 * 布局缩略图出口：聚合七种导航布局的预览小图，供布局预设选择器渲染缩略图。
 *
 * 这些组件只是示意图，不承担布局渲染；ContentWide 复用 HeaderNav，
 * 与 ContentCompact 一起供内容宽度选择使用。
 */
import HeaderNav from './header-nav.vue';

export { default as ContentCompact } from './content-compact.vue';
export { default as FullContent } from './full-content.vue';
export { default as HeaderMixedNav } from './header-mixed-nav.vue';
export { default as HeaderSidebarNav } from './header-sidebar-nav.vue';
export { default as MixedNav } from './mixed-nav.vue';
export { default as SidebarMixedNav } from './sidebar-mixed-nav.vue';
export { default as SidebarNav } from './sidebar-nav.vue';

const ContentWide = HeaderNav;
export { ContentWide, HeaderNav };
