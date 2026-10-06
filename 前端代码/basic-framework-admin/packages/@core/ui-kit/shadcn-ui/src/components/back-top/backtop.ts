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

export interface BacktopProps {
  bottom?: number;
  isGroup?: boolean;
  right?: number;
  target?: string;
  visibilityHeight?: number;
}
