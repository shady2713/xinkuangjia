/**
 * 把一组 CSS 变量写进内联样式表，实现运行期换肤而不重新加载样式。
 * 复用同一个 style 元素并覆盖其内容，因此反复调用不会在文档里堆积节点。
 * @param variables 要更新的 CSS 变量与其新值的映射，键不带 `--` 前缀之外的额外前缀。
 * @param id 内联样式元素的 id，用于定位并复用同一个 style 节点。
 */
function updateCSSVariables(
  variables: { [key: string]: string },
  id = '__vben-styles__',
): void {
  // 复用已存在的内联样式表；不存在时本次新建并在同步阶段挂载。
  // 是否已存在只判断这一次：后续都以这个结果决定要不要 append，
  // 避免第二次查询与创建脱节后重复挂载同一个元素。
  const existingStyle = document.querySelector(`#${id}`);
  const styleElement = existingStyle ?? document.createElement('style');

  styleElement.id = id;

  // 构建要更新的 CSS 变量的样式文本
  let cssText = ':root {';
  for (const key in variables) {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      cssText += `${key}: ${variables[key]};`;
    }
  }
  cssText += '}';

  // 将样式文本赋值给内联样式表
  styleElement.textContent = cssText;

  // 将内联样式表添加到文档头部。
  // 这里必须同步挂载：早前用无延迟 setTimeout 只是把 append 推到下一个宏任务，
  // 没有任何批处理收益，却让样式表在调用返回时尚未进入文档；
  // 而计时器不返回句柄、也无法被调用方取消，测试环境销毁后该回调仍会执行并访问已释放的 document。
  if (!existingStyle) {
    document.head.append(styleElement);
  }
}

export { updateCSSVariables };
