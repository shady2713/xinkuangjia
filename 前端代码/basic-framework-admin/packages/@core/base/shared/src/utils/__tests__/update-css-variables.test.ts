/**
 * 锁定 updateCSSVariables 的 :root 写入契约。
 * 目标 style 元素不存在时须同步新建并挂进 head，
 * 推迟到下一个宏任务挂载即视为失败。
 */
import { expect, it } from 'vitest';

import { updateCSSVariables } from '../update-css-variables';

it('updateCSSVariables should update CSS variables in :root selector', () => {
  // 模拟初始的内联样式表内容
  const initialStyleContent = ':root { --primaryColor: red; }';
  document.head.innerHTML = `<style id="custom-styles">${initialStyleContent}</style>`;

  // 要更新的CSS变量和它们的新值
  const updatedVariables = {
    fontSize: '16px',
    primaryColor: 'blue',
    secondaryColor: 'green',
  };

  // 调用函数来更新CSS变量
  updateCSSVariables(updatedVariables, 'custom-styles');

  // 获取更新后的样式内容
  const styleElement = document.querySelector('#custom-styles');
  const updatedStyleContent = styleElement ? styleElement.textContent : '';

  // 检查更新后的样式内容是否包含正确的更新值
  expect(
    updatedStyleContent?.includes('primaryColor: blue;') &&
      updatedStyleContent?.includes('secondaryColor: green;') &&
      updatedStyleContent?.includes('fontSize: 16px;'),
  ).toBe(true);
});

it('updateCSSVariables should mount a newly created style element synchronously', /** 目标 id 尚不存在，本次调用必须新建样式表并直接挂进 head。 */ () => {
  document.head.innerHTML = '';

  updateCSSVariables({ primaryColor: 'teal' }, 'fresh-styles');

  // 同步可见：调用返回时样式表已经在文档里。
  // 若实现把挂载推迟到无延迟 setTimeout，此刻查询必然为 null，本用例随即失败。
  const styleElement = document.querySelector('#fresh-styles');
  expect(styleElement).not.toBeNull();
  expect(styleElement?.parentElement).toBe(document.head);
  expect(styleElement?.textContent).toContain('primaryColor: teal;');
});
