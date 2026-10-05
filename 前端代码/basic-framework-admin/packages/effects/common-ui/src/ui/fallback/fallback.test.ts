/**
 * 兜底页（effects/common-ui 的 ui/fallback/fallback）状态分支与出口按钮回归。
 *
 * 兜底页是 403、404、500、离线与敬请期待五类异常的最终展示面：标题或描述按状态取错会让用户
 * 看到与真实故障不符的提示甚至空白页；图标未按状态渲染会让页面失去辨识度；返回首页与刷新
 * 按钮的显示条件写反，会让用户在没有任何出口的页面上无法自助恢复。用例在真实内存路由上
 * 挂载真实组件，逐个状态断言标题、描述与图标，并用真实点击验证路由跳转与页面刷新调用。
 */
import type { FallbackProps } from './fallback';

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { $t } from '@vben/locales';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Fallback from './fallback.vue';
import Icon403 from './icons/icon-403.vue';
import Icon404 from './icons/icon-404.vue';
import Icon500 from './icons/icon-500.vue';
import IconComingSoon from './icons/icon-coming-soon.vue';
import IconOffline from './icons/icon-offline.vue';

/** 内置状态与期望的文案键、图标、出口按钮对照表；按钮为 none 表示不提供自助出口。 */
const STATUS_CASES = [
  {
    action: 'back',
    descKey: 'ui.fallback.forbiddenDesc',
    icon: Icon403,
    status: '403',
    titleKey: 'ui.fallback.forbidden',
  },
  {
    action: 'back',
    descKey: 'ui.fallback.pageNotFoundDesc',
    icon: Icon404,
    status: '404',
    titleKey: 'ui.fallback.pageNotFound',
  },
  {
    action: 'refresh',
    descKey: 'ui.fallback.internalErrorDesc',
    icon: Icon500,
    status: '500',
    titleKey: 'ui.fallback.internalError',
  },
  {
    action: 'refresh',
    descKey: 'ui.fallback.offlineErrorDesc',
    icon: IconOffline,
    status: 'offline',
    titleKey: 'ui.fallback.offlineError',
  },
  {
    action: 'none',
    descKey: '',
    icon: IconComingSoon,
    status: 'coming-soon',
    titleKey: 'ui.fallback.comingSoon',
  },
] as const;

/** 占位路由组件：兜底页用例只关心跳转结果，目标页面内容不参与断言。 */
const EmptyRoute = {
  /** 占位渲染函数不输出任何内容。 */
  render: () => null,
};

/** 最近一次挂载的兜底页，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载组件并复位浏览器替身，避免用例之间互相影响。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
  },
);

/**
 * 建立真实内存路由并在其上挂载兜底页。
 * @param props 兜底页属性，用来选择内置状态、自定义图片与返回地址。
 * @param slots 调用方传入的插槽内容，用于验证业务定制分支。
 * @returns 真实路由实例与已挂载的组件包装器。
 */
async function mountFallback(
  props: Partial<FallbackProps> = {},
  slots: Record<string, string> = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: EmptyRoute, path: '/' },
      { component: EmptyRoute, path: '/dashboard' },
    ],
  });
  await router.push('/dashboard');
  await router.isReady();
  const wrapper = mount(Fallback, {
    global: { plugins: [router] },
    props,
    slots,
  });
  mounted = wrapper;
  await flushPromises();
  return { router, wrapper };
}

describe('兜底页状态展示', /** 状态与文案、图标的对应关系决定用户能否看懂当前故障。 */ () => {
  it.each(STATUS_CASES)(
    '$status 渲染对应标题、描述与图标',
    /**
     * 文案或图标串状态会让用户按错误原因处理故障。
     * @param testCase 内置状态用例，含状态、期望文案键、图标与出口按钮类型。
     */
    async ({ action, descKey, icon, status, titleKey }) => {
      const { wrapper } = await mountFallback({ status });

      await vi.waitFor(
        /** 按状态动态加载的图标需要等待异步组件解析完成。 */ () => {
          expect(wrapper.findComponent(icon).exists()).toBe(true);
        },
      );
      expect(wrapper.get('p').text()).toBe($t(titleKey));
      const paragraphs = wrapper.findAll('p');
      if (descKey) {
        expect(paragraphs.at(-1)?.text()).toBe($t(descKey));
      } else {
        // 敬请期待没有独立描述文案，多渲染一段空描述会留下无意义的留白。
        expect(paragraphs).toHaveLength(1);
      }
      const buttons = wrapper.findAll('button');
      if (action === 'none') {
        expect(buttons).toHaveLength(0);
      } else {
        expect(buttons).toHaveLength(1);
      }
    },
  );

  it('未知状态不渲染标题、描述与图标', /** 路由 meta 传入联合类型外的状态时残留默认内容会误导用户。 */ async () => {
    // 状态由路由 meta 在运行时给出，可能是当前联合类型之外的值，这里按真实运行时输入传入。
    const unknownStatus = 'maintenance' as unknown as FallbackProps['status'];
    const { wrapper } = await mountFallback({ status: unknownStatus });

    expect(wrapper.findAll('p')).toHaveLength(0);
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('自定义标题与描述优先于内置状态文案', /** 调用方覆盖文案失效会让业务无法说明本系统特有的故障原因。 */ async () => {
    const { wrapper } = await mountFallback({
      description: 'DUMMY-自定义描述',
      status: '404',
      title: 'DUMMY-自定义标题',
    });

    expect(wrapper.get('p').text()).toBe('DUMMY-自定义标题');
    expect(wrapper.findAll('p').at(-1)?.text()).toBe('DUMMY-自定义描述');
  });

  it('传入图片时渲染图片而不渲染状态图标', /** 图片与图标同时渲染会让页面出现两个互相矛盾的插画。 */ async () => {
    const { wrapper } = await mountFallback({
      image: 'DUMMY-fallback.svg',
      status: '404',
    });

    const image = wrapper.get('img');
    expect(image.attributes('src')).toBe('DUMMY-fallback.svg');
    // 插画区第一个子节点必须是图片本身，异步图标组件不得同时出现在这里。
    expect(wrapper.findComponent(Icon404).exists()).toBe(false);
    expect(wrapper.element.firstElementChild?.tagName).toBe('IMG');
  });
});

describe('兜底页插槽', /** 插槽是业务定制兜底页内容的唯一入口。 */ () => {
  it('标题、描述与操作插槽覆盖默认内容', /** 插槽丢失会让业务无法替换兜底页文案与操作区。 */ async () => {
    const { wrapper } = await mountFallback(
      { status: '500' },
      {
        action: '<button data-test="action">DUMMY-联系管理员</button>',
        describe: '<p data-test="describe">DUMMY-插槽描述</p>',
        title: '<p data-test="title">DUMMY-插槽标题</p>',
      },
    );

    expect(wrapper.get('[data-test="title"]').text()).toBe('DUMMY-插槽标题');
    expect(wrapper.get('[data-test="describe"]').text()).toBe('DUMMY-插槽描述');
    expect(wrapper.get('[data-test="action"]').text()).toBe('DUMMY-联系管理员');
    // 插槽接管操作区后不再渲染内置的刷新按钮。
    expect(wrapper.findAll('button')).toHaveLength(1);
  });
});

describe('兜底页出口按钮', /** 出口按钮是用户离开异常页面的唯一自助手段。 */ () => {
  it('返回首页按钮真实跳转到默认首页地址', /** 跳转地址写死或未触发会让用户留在异常页面。 */ async () => {
    const { router, wrapper } = await mountFallback({ status: '403' });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/');
  });

  it('返回首页按钮跳转到调用方指定的首页地址', /** 忽略 homePath 会把用户带到本系统不存在的首页。 */ async () => {
    const { router, wrapper } = await mountFallback({
      homePath: '/dashboard',
      status: '404',
    });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('刷新按钮触发一次真实页面刷新调用' /** 刷新入口失效会让离线与 500 页面失去重试手段。 */, /** 页面刷新是浏览器外部动作，这里只记录调用而不真正重载文档。 */ async () => {
    const reload = vi
      .spyOn(window.location, 'reload')
      .mockImplementation(
        /** 记录刷新调用，避免测试进程真的重载文档。 */ () => {},
      );
    const { wrapper } = await mountFallback({ status: 'offline' });

    await wrapper.get('button').trigger('click');

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
