/**
 * CodeMirror 运行时装配：副作用式注册 json、css、htmlmixed、vue 语言模式与主题样式，
 * 并统一从本模块再导出 CodeMirror 构造函数。
 * 只有导入与再导出，不含实例创建、选项配置等逻辑。
 */
// modes
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/css/css';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/mode/vue/vue';

import './codemirror.css';
import 'codemirror/theme/idea.css';
import 'codemirror/theme/material-palenight.css';

export { default as CodeMirror } from 'codemirror';
