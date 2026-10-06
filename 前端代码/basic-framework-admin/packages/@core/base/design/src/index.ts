/**
 * 设计包样式总入口：先加载设计令牌，再引入全局、过渡、进度条与 UI 基础样式。
 * styles 包与应用主入口引入一次即可获得整套基础外观，
 * 组件自身的样式仍随组件分发。
 */
import './design-tokens';

import './css/global.css';
import './css/transition.css';
import './css/nprogress.css';
import './css/ui.css';
