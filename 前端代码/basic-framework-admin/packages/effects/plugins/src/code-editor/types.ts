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

export interface CodeEditorProps {
  mode?: string;
  value?: string;
  readonly?: boolean;
  bordered?: boolean;
  autoFormat?: boolean;
}
