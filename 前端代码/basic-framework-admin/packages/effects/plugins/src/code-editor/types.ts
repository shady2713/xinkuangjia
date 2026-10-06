/**
 * 代码编辑器契约：MODE 给出 html、js、json、vue 四种模式对应的 CodeMirror 模式名，
 * CodeEditorProps 约定 value、mode、readonly、bordered、autoFormat 五个入参。
 * 只声明枚举与类型，不含运行时逻辑；实例行为见 code-mirror.vue。
 */
export enum MODE {
  HTML = 'htmlmixed',
  JS = 'javascript',
  JSON = 'application/json',
  VUE = 'vue',
}

/** 代码编辑器入参：value 为受控内容，mode 决定语法高亮，readonly 与 bordered 控制交互与外观，autoFormat 决定 JSON 是否自动格式化。 */
export interface CodeEditorProps {
  mode?: string;
  value?: string;
  readonly?: boolean;
  bordered?: boolean;
  autoFormat?: boolean;
}
