/**
 * 回到顶部按钮的属性契约：声明 bottom、right、target、
 * visibilityHeight 的默认值与类型，供组件和组合式函数共用。
 * 只描述入参，不含滚动监听与显隐实现。
 */
export const backtopProps = {
  /**
   * @zh_CN bottom distance.
   */
  bottom: {
    default: 40,
    type: Number,
  },
  /**
   * @zh_CN right distance.
   */
  right: {
    default: 40,
    type: Number,
  },
  /**
   * @zh_CN the target to trigger scroll.
   */
  target: {
    default: '',
    type: String,
  },
  /**
   * @zh_CN the button will not show until the scroll height reaches this value.
   */
  visibilityHeight: {
    default: 200,
    type: Number,
  },
} as const;

/**
 * 回到顶部按钮的入参类型：字段与同文件 backtopProps 的运行时声明对齐
 * （后者另带 Vue 侧默认值与类型校验），让组件与组合式函数复用同一份类型。
 * 全部字段可选，组件未传时由 back-top.vue 的 withDefaults 兜底。
 */
export interface BacktopProps {
  /** 按钮距视口底部的像素距离，缺省时组件填 20。 */
  bottom?: number;
  /** 预留的分组标记：当前组件的渲染与显隐逻辑都不读取它。 */
  isGroup?: boolean;
  /** 按钮距视口右侧的像素距离，缺省时组件填 24。 */
  right?: number;
  /**
   * 滚动容器选择器；留空表示用 document.documentElement，
   * 非空但挂载时查不到元素会直接抛错，不降级。
   */
  target?: string;
  /** 按钮出现所需的滚动距离阈值（像素），组合式函数读到缺失值时按 0 比较。 */
  visibilityHeight?: number;
}
