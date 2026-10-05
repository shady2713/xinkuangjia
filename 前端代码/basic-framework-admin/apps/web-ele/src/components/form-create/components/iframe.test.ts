/**
 * 网页嵌入组件（form-create 的 iframe 组件）真实行为回归。
 *
 * 该组件是表单设计器里的网页预览控件：`url` 优先于 `modelValue`，只有 http/https 地址才
 * 渲染真实 iframe，其余情况显示占位提示。取址优先级写错会让设计器忽略用户在属性面板里
 * 填写的地址；协议判断写错会把 `javascript:` 之类的地址直接嵌进页面（脚本注入面）；
 * iframe 属性透传错误会让高度、宽度、沙箱与加载策略失效。用例真实挂载组件并断言渲染出的
 * 原生 iframe 元素及其属性，只依赖 Element Plus 的空状态组件，不替换被测实现。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Iframe from './iframe.vue';

/**
 * 读取组件当前渲染出的原生 iframe 元素。
 * @param wrapper 已挂载的组件包装器。
 * @returns 原生 iframe 元素；未渲染时返回 undefined。
 */
function iframeElement(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('iframe').element as HTMLIFrameElement | undefined;
}

describe('网页嵌入组件取址', /** url 优先级与协议判断决定设计器能否正确预览、以及是否引入脚本注入面。 */ () => {
  it('url 与 modelValue 同时存在时优先使用 url', /** 属性面板填写的地址必须优先于表单值，否则用户配置不生效。 */ () => {
    const wrapper = mount(Iframe, {
      props: {
        modelValue: 'https://model.test/page',
        url: 'https://url.test/page',
      },
    });

    expect(iframeElement(wrapper)?.getAttribute('src')).toBe(
      'https://url.test/page',
    );
    expect(wrapper.find('.iframe-placeholder').exists()).toBe(false);
  });

  it('url 为空时回退到 modelValue', /** 只绑定表单值时仍要能预览，回退缺失会让预览整片空白。 */ () => {
    const wrapper = mount(Iframe, {
      props: { modelValue: 'https://model.test/page', url: '' },
    });

    expect(iframeElement(wrapper)?.getAttribute('src')).toBe(
      'https://model.test/page',
    );
  });

  it('空 whitespace 地址按无效地址处理并显示占位提示', /** 只含空白的地址既不该渲染 iframe，也不该让组件抛错。 */ () => {
    const wrapper = mount(Iframe, { props: { url: '   ' } });

    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('.iframe-placeholder').exists()).toBe(true);
  });

  it('非 http/https 协议一律拒绝渲染 iframe', /** javascript: 之类地址被嵌入会形成脚本注入面，必须按无效地址处理。 */ () => {
    const wrapper = mount(Iframe, {
      props: { url: 'javascript:alert(document.cookie)' },
    });

    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('.iframe-placeholder').exists()).toBe(true);
  });

  it('完全不是 URL 的文本被拒绝并显示占位提示', /** 构造 URL 抛出的异常必须被吞掉并降级为占位提示，不能冒泡成渲染失败。 */ () => {
    const wrapper = mount(Iframe, { props: { url: '不是地址' } });

    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('.iframe-placeholder').exists()).toBe(true);
  });
});

describe('网页嵌入组件属性透传', /** 尺寸、边框、加载策略与沙箱必须原样交给浏览器，写错会影响嵌入页行为与安全边界。 */ () => {
  it('按声明透传尺寸、边框、全屏与加载策略', /** 透传丢失会让设计器里的预览尺寸与真实页面不一致。 */ () => {
    const wrapper = mount(Iframe, {
      props: {
        allowfullscreen: false,
        frameborder: '1',
        height: '320px',
        loading: 'eager',
        url: 'https://url.test/page',
        width: '60%',
      },
    });

    const element = iframeElement(wrapper);
    expect(element?.getAttribute('height')).toBe('320px');
    expect(element?.getAttribute('width')).toBe('60%');
    expect(element?.getAttribute('frameborder')).toBe('1');
    expect(element?.getAttribute('loading')).toBe('eager');
    // 布尔属性为假时不会渲染出该属性，符合原生 iframe 语义。
    expect(element?.hasAttribute('allowfullscreen')).toBe(false);
  });

  it('默认值与声明一致：lazy 加载、100% 宽、500px 高', /** 默认值被改会让未配置尺寸的嵌入页撑破或塌缩布局。 */ () => {
    const wrapper = mount(Iframe, { props: { url: 'https://url.test/page' } });

    const element = iframeElement(wrapper);
    expect(element?.getAttribute('loading')).toBe('lazy');
    expect(element?.getAttribute('width')).toBe('100%');
    expect(element?.getAttribute('height')).toBe('500px');
    expect(element?.hasAttribute('allowfullscreen')).toBe(true);
  });

  it('沙箱为空时不渲染 sandbox 属性，配置后原样透传', /** 空沙箱必须等同"不加限制"，写死空串会让嵌入页被浏览器按最严沙箱执行。 */ () => {
    const openWrapper = mount(Iframe, {
      props: { url: 'https://url.test/page' },
    });
    expect(iframeElement(openWrapper)?.hasAttribute('sandbox')).toBe(false);

    const sandboxedWrapper = mount(Iframe, {
      props: {
        sandbox: 'allow-scripts allow-same-origin',
        url: 'https://url.test/page',
      },
    });
    expect(iframeElement(sandboxedWrapper)?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin',
    );
  });
});
