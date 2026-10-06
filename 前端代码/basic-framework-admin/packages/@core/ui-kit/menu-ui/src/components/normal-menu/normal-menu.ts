/**
 * 普通菜单的属性契约：声明菜单数据、当前激活路径、折叠开关与深浅主题。
 * 只约定调用方传入的字段，渲染与交互实现不在类型层。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

interface NormalMenuProps {
  /**
   * 菜单数据
   */
  activePath?: string;
  /**
   * 是否折叠
   */
  collapse?: boolean;
  /**
   * 菜单项
   */
  menus?: MenuRecordRaw[];
  /**
   * @zh_CN 是否圆润风格
   * @default true
   */
  rounded?: boolean;
  /**
   * 主题
   */
  theme?: 'dark' | 'light';
}

export type { NormalMenuProps };
