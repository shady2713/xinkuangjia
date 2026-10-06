/**
 * 菜单组件的类型契约：MenuProps 描述菜单容器入参，SubMenuProps 与 MenuItemProps
 * 描述子级节点入参，MenuProvider 与 SubMenuProvider 约定上下文的注入成员。
 * 登记与点击载荷由 Registered、Clicked 描述；此处只声明类型，不含运行时逻辑。
 */
import type { Component, Ref } from 'vue';

import type { MenuRecordBadgeRaw, ThemeModeType } from '@vben-core/typings';

/**
 * 菜单容器属性：描述展开互斥、折叠形态、主题与溢出滚动等整体行为开关。
 * 容器自身持有激活项与展开项集合，此处只约定调用方可传入的入参。
 */
interface MenuProps {
  /**
   * @zh_CN 是否开启手风琴模式
   * @default true
   */
  accordion?: boolean;
  /**
   * @zh_CN 菜单是否折叠
   * @default false
   */
  collapse?: boolean;

  /**
   * @zh_CN 菜单折叠时是否显示菜单名称
   * @default false
   */
  collapseShowTitle?: boolean;

  /**
   * @zh_CN 默认激活的菜单
   */
  defaultActive?: string;

  /**
   * @zh_CN 默认展开的菜单
   */
  defaultOpeneds?: string[];

  /**
   * @zh_CN 菜单模式
   * @default vertical
   */
  mode?: 'horizontal' | 'vertical';

  /**
   * @zh_CN 是否圆润风格
   * @default true
   */
  rounded?: boolean;

  /**
   * @zh_CN 是否自动滚动到激活的菜单项
   * @default false
   */
  scrollToActive?: boolean;

  /**
   * @zh_CN 菜单主题
   * @default dark
   */
  theme?: ThemeModeType;
}

/**
 * 子菜单属性：在菜单项公共字段之上补充可展开节点的图标与禁用开关。
 * 展开集合由所属菜单容器持有，本契约只描述单条子菜单记录的展示与交互入参。
 */
interface SubMenuProps extends MenuRecordBadgeRaw {
  /**
   * @zh_CN 激活图标
   */
  activeIcon?: string;
  /**
   * @zh_CN 是否禁用
   */
  disabled?: boolean;
  /**
   * @zh_CN 图标
   */
  icon?: Component | string;
  /**
   * @zh_CN submenu 名称
   */
  path: string;
}

/**
 * 叶子菜单项属性：除图标与禁用开关外还携带 path，用于在菜单容器中建立登记索引。
 * path 必填，是激活态比对、手风琴互斥与选中事件载荷的共同主键。
 */
interface MenuItemProps extends MenuRecordBadgeRaw {
  /**
   * @zh_CN 图标
   */
  activeIcon?: string;
  /**
   * @zh_CN 是否禁用
   */
  disabled?: boolean;
  /**
   * @zh_CN 图标
   */
  icon?: Component | string;
  /**
   * @zh_CN menuitem 名称
   */
  path: string;
}

/**
 * 菜单项登记记录：菜单树中一个节点挂载时登记到祖先容器、并随激活态变化而更新的快照。
 * active 与 parentPaths 均以 ref 传入后在 reactive 中解包，因此读取到的始终是最新值。
 */
interface MenuItemRegistered {
  active: boolean;
  parentPaths: string[];
  path: string;
}

/**
 * 菜单项点击载荷：根菜单据此外发 select 事件，比登记记录少了仅供高亮的 active 字段。
 * path 与 parentPaths 均来自被点击的菜单项自身，调用方可据此决定跳转落点。
 */
interface MenuItemClicked {
  parentPaths: string[];
  path: string;
}

/**
 * 菜单容器上下文：菜单树内所有节点通过 inject 取用的共享状态与操作集合。
 * 容器用 reactive 包裹后整体下发，节点只读取激活项、展开项与登记表，并回调登记与展开操作。
 */
interface MenuProvider {
  activePath?: string;
  /** 把一条菜单项登记记录写入 items 登记表；path 重复时后挂载者覆盖前者。 */
  addMenuItem: (item: MenuItemRegistered) => void;

  /** 把一条子菜单登记记录写入 subMenus 登记表，供父级汇总激活态与手风琴互斥使用。 */
  addSubMenu: (item: MenuItemRegistered) => void;
  /** 收起指定 path 的子菜单并外发 close 事件；path 不在展开集合中时仅外发事件不改状态。 */
  closeMenu: (path: string, parentLinks: string[]) => void;
  /** 处理叶子菜单项点击：水平模式或折叠态下先清空展开项，再校验载荷并外发 select 事件。 */
  handleMenuItemClick: (item: MenuItemClicked) => void;
  /** 处理子菜单标题点击：按当前是否已展开决定调用 openMenu 还是 closeMenu。 */
  handleSubMenuClick: (subMenu: MenuItemRegistered) => void;
  isMenuPopup: boolean;
  items: Record<string, MenuItemRegistered>;

  openedMenus: string[];
  /** 展开指定 path 的子菜单；手风琴模式下先把展开集合收敛到该节点的父级链路。 */
  openMenu: (path: string, parentLinks: string[]) => void;
  props: MenuProps;
  /** 卸载时从 items 登记表移除该菜单项，避免残留项继续参与激活态计算。 */
  removeMenuItem: (item: MenuItemRegistered) => void;

  /** 卸载时从 subMenus 登记表移除该子菜单，使父级激活态汇总不再计入它。 */
  removeSubMenu: (item: MenuItemRegistered) => void;

  subMenus: Record<string, MenuItemRegistered>;
  theme: string;
}

/**
 * 子菜单上下文：由每层子菜单向下提供，供更下一级的菜单项与子菜单读取层级与鼠标移入标记。
 * level 由父级加一得到，mouseInChild 用于避免鼠标在嵌套层级间移动时误关弹层。
 */
interface SubMenuProvider {
  /** 把下级子菜单登记到本层 subMenus 表，使本层能汇总子级激活态。 */
  addSubMenu: (item: MenuItemRegistered) => void;
  /** 鼠标离开后按需延时收回本层弹层；deepDispatch 为真时继续向父层逐级传递收回意图。 */
  handleMouseleave?: (deepDispatch: boolean) => void;
  level: number;
  mouseInChild: Ref<boolean>;
  /** 卸载时从本层登记表移除该子菜单。 */
  removeSubMenu: (item: MenuItemRegistered) => void;
}

export type {
  MenuItemClicked,
  MenuItemProps,
  MenuItemRegistered,
  MenuProps,
  MenuProvider,
  SubMenuProps,
  SubMenuProvider,
};
