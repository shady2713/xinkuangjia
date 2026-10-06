/**
 * JSON 查看器的对外类型契约：定义入参 JsonViewerProps，
 * 以及点击、复制、展开等事件的负载类型：JsonViewerAction、
 * JsonViewerValue 与 JsonViewerToggle。
 * 只声明字段与可选性，默认值和运行时解析都在 index.vue。
 */
export interface JsonViewerProps {
  /**
   * 要展示的结构数据
   *
   * 允许任意 JSON 可表示的取值（对象、数组、字符串、数字、布尔、null），
   * 展示组件只负责渲染而不解释业务含义，因此按 unknown 接收。
   */
  value: unknown;
  /** 展开深度 */
  expandDepth?: number;
  /** 是否可复制 */
  copyable?: boolean;
  /** 是否排序 */
  sort?: boolean;
  /** 显示边框 */
  boxed?: boolean;
  /** 主题 */
  theme?: string;
  /** 是否展开 */
  expanded?: boolean;
  /** 时间格式化函数 */
  timeformat?: (time: Date | number | string) => string;
  /** 预览模式 */
  previewMode?: boolean;
  /** 显示数组索引 */
  showArrayIndex?: boolean;
  /** 显示双引号 */
  showDoubleQuotes?: boolean;
}

/** 复制或点击等交互的动作载荷：动作名、展示文本与触发元素。 */
export interface JsonViewerAction {
  action: string;
  text: string;
  trigger: HTMLElement;
}

/** 被点击节点的信息：原始值、数据路径、嵌套深度与对应元素。 */
export interface JsonViewerValue {
  /**
   * 被点击节点的原始值
   *
   * 由节点文本 JSON.parse 得到，解析失败时可能为 undefined；
   * 形状完全取决于被查看的数据，调用方需自行收窄。
   */
  value: unknown;
  path: string;
  depth: number;
  el: HTMLElement;
}

/** 展开或收起事件的载荷：触发用的鼠标事件与切换后的展开状态。 */
export interface JsonViewerToggle {
  /** 鼠标事件 */
  event: MouseEvent;
  /** 当前展开状态 */
  open: boolean;
}
