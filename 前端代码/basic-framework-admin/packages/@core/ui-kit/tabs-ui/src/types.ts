/**
 * 标签页组件的类型契约：描述标签集合、外观、拖拽与右键菜单等可配置项。
 */
import type {
  ContextMenuHandlerData,
  IContextMenuItem,
} from '@vben-core/shadcn-ui';
import type { TabDefinition, TabsStyleType } from '@vben-core/typings';

/**
 * 标签栏向上层抛出的事件契约：关闭指定 key 的标签、拖拽排序后的新旧下标，
 * 以及解除固定时回传的标签实体。三个事件的载荷顺序固定，监听方按位置解构。
 */
export type TabsEmits = {
  close: [string];
  sortTabs: [number, number];
  unpin: [TabDefinition];
};

/**
 * 标签栏的属性契约：标签集合、当前选中项、外观（风格、间隙、宽窄、图标）
 * 与交互开关（拖拽、中键关闭、滚轮滚动）都在这里声明。
 * 只在 tabs-chrome 风格下生效的字段已在对应成员上标出。
 */
export interface TabsProps {
  active?: string;
  /**
   * @zh_CN content class
   * @default tabs-chrome
   */
  contentClass?: string;
  /**
   * 右键菜单：入参是触发菜单的标签页实体，菜单构建方可直接按 TabDefinition 字段使用。
   * 用方法语法声明，使使用方可以只声明自己关心的实体类型。
   * @param data 触发右键菜单的标签页实体。
   * @returns 该标签页对应的菜单项列表，空数组表示不展示菜单。
   */
  contextMenus?(data: ContextMenuHandlerData): IContextMenuItem[];
  /**
   * @zh_CN 是否可以拖拽
   */
  draggable?: boolean;
  /**
   * @zh_CN 间隙
   * @default 7
   * 仅限 tabs-chrome
   */
  gap?: number;
  /**
   * @zh_CN tab 最大宽度
   * 仅限 tabs-chrome
   */
  maxWidth?: number;
  /**
   * @zh_CN 点击中键时关闭Tab
   */
  middleClickToClose?: boolean;

  /**
   * @zh_CN tab最小宽度
   * 仅限 tabs-chrome
   */
  minWidth?: number;

  /**
   * @zh_CN 是否显示图标
   */
  showIcon?: boolean;
  /**
   * @zh_CN 标签页风格
   */
  styleType?: TabsStyleType;

  /**
   * @zh_CN 选项卡数据
   */
  tabs?: TabDefinition[];

  /**
   * @zh_CN 是否响应滚轮事件
   */
  wheelable?: boolean;
}

/**
 * 渲染单个标签项所需的字段集：在路由标签定义之上补出模板直接消费的展示字段。
 * closable 为假时关闭与固定两个标记都不展示；affixTab 为真时把关闭按钮换成固定标记。
 */
export interface TabConfig extends TabDefinition {
  affixTab: boolean;
  closable: boolean;
  icon: string;
  key: string;
  title: string;
}
