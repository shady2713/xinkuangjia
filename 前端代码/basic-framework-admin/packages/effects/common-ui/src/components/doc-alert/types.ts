/**
 * 文档提示条的 props 契约：title 为提示前缀文案，url 为点击后新窗口打开的地址，均必填。
 */
export interface DocAlertProps {
  title: string;
  url: string;
}
