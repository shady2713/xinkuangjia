/** 数据字典 Select 选择器组件 Props 类型 */
export interface DictSelectProps {
  dictType: string; // 字典类型
  valueType?: 'bool' | 'int' | 'str'; // 字典值类型
  selectType?: 'checkbox' | 'radio' | 'select'; // 选择器类型，下拉框 select、多选框 checkbox、单选框 radio
  formCreateInject?: Record<string, unknown>;
}

/** 左侧拖拽按钮 */
export interface MenuItem {
  label: string;
  name: string;
  icon: string;
}

/** 左侧拖拽按钮分类 */
export interface Menu {
  title: string;
  name: string;
  list: MenuItem[];
}

/** 通用 API 下拉组件 Props 类型 */
export interface ApiSelectProps {
  name: string; // 组件名称
  labelField?: string; // 选项标签
  valueField?: string; // 选项的值
  url?: string; // url 接口
  isDict?: boolean; // 是否字典选择器
}

/**
 * form-create 设计器属性面板传入的翻译函数。
 * @description 语言包缺键时 vue-i18n 会回显 key 本身，调用方仍用 `||` 兜底原 title。
 * @param message 语言键，例如 props.required
 * @returns 翻译后的文案
 */
export type FormCreateTranslate = (message: string) => string;

/**
 * form-create 设计器调用属性面板 props 工厂时传入的上下文。
 * @description 当前只依赖 t 翻译函数；form-create 还会附带 option 等字段，本工程用不到。
 */
export interface FormCreatePropsContext {
  t: FormCreateTranslate;
}

/**
 * 设计器属性面板的一条配置行。
 * @description form-create 只按 field/title 驱动该面板，其余键（type、value、options、props、
 * control、info 等）由对应控件类型各自解释，形状差异大且完全由外部配置决定，因此按 unknown 承接，
 * 需要具体字段时由使用者就地收窄。
 */
export interface FormCreatePropsRule {
  /** 目标组件或设计器控件的属性名，同时是国际化语言键的末段 */
  field: string;
  /** 设计器属性面板展示的中文文案；语言包缺键时保留该值 */
  title: string;
  /** 其余控件配置，形状由 form-create 对应控件类型决定 */
  [key: string]: unknown;
}

/**
 * 设计器生成的 form-create 规则对象，最终由表单运行时消费。
 * @description `$required` 与 field 由设计器面板写入，props 是目标组件的默认属性集合；
 * modelField 等扩展字段按 form-create 运行时约定透传。
 */
export interface FormCreateRule {
  /** 是否必填，由属性面板的"是否必填"开关写入 */
  $required: boolean;
  /** 表单字段名，设计器生成时用 UUID 保证唯一 */
  field: string;
  /** 字段标题，缺省为空串 */
  info: string;
  /** 目标组件类型名 */
  type: string;
  /** 目标组件的默认属性集合；仅在规则配置了默认值覆盖项时存在 */
  props?: Record<string, unknown>;
  /** 允许透传 modelField 等由表单运行时解释的扩展字段 */
  [key: string]: unknown;
}

/** 选择组件规则配置类型 */
export interface SelectRuleOption {
  label: string; // label 名称
  name: string; // 组件名称
  icon: string; // 组件图标
  props?: FormCreatePropsRule[]; // 组件规则
  /**
   * 事件配置，运行时由 form-create 按事件声明解释；每项结构由外部表单配置决定，
   * 本工程不解析其内容，因此只保留未知元素序列。
   */
  event?: unknown[];
}
