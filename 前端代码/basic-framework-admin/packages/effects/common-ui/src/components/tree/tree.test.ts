/**
 * 通用树组件（common-ui 的 components/tree/tree.vue）空状态与插槽透传回归。
 *
 * 组件是核心树的外壳：树数据为空时必须渲染"暂无数据"文案与收件箱图标，否则调用方每个页面
 * 都要自行兜底；有数据时必须把接收到的属性原样交给核心树，并把调用方传入的每个具名插槽连
 * 同作用域参数一起按同名透传，否则节点自定义渲染（操作按钮、图标）会整块消失。用例真实挂载
 * 组件、真实装配中文语言包，并断言真实 DOM 与插槽收到的真实作用域参数。
 */
import { mount } from '@vue/test-utils';
import { createApp, h, nextTick, toRaw } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Tree from './tree.vue';

/** 带子节点的树夹具：字段名沿用组件默认的 label、value 与 children。 */
const TREE_DATA = [
  {
    children: [{ label: 'DUMMY-前端组', value: 'fe' }],
    label: 'DUMMY-研发部',
    value: 'rd',
  },
];

/** 单节点树夹具：只有一个根节点，用于精确核对插槽作用域参数。 */
const SINGLE_NODE_DATA = [{ label: 'DUMMY-研发部', value: 'rd' }];

/** 每个用例挂载的组件，用例结束后统一卸载，避免残留影响后续用例。 */
let mounted: ReturnType<typeof mount> | undefined;

beforeAll(
  /** 装配真实中文语言包，空状态文案才能断言到用户可见文字。 */ async () => {
    await setupI18n(
      createApp({
        /** 语言包装配不需要渲染任何界面元素。 */
        render: () => null,
      }),
    );
  },
);

afterEach(
  /** 卸载组件，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

describe('通用树空状态', /** 空数据兜底决定调用方是否还要自行处理无数据提示。 */ () => {
  it('无树数据时渲染空状态文案与收件箱图标', /** 空状态缺失会让页面只剩一块没有任何提示的空白。 */ () => {
    mounted = mount(Tree, { props: { treeData: [] } });

    expect(mounted.text()).toContain('暂无数据');
    // 收件箱图标是空状态的视觉标识，缺失时用户读不出"没有数据"的含义。
    expect(mounted.find('svg.lucide-inbox').exists()).toBe(true);
    expect(mounted.find('.tree-node').exists()).toBe(false);
  });
});

describe('通用树有数据渲染', /** 有数据分支决定节点文本与调用方插槽能否正常显示。 */ () => {
  it('把树属性交给核心树并渲染节点文本', /** 属性未透传会让树只剩一个没有节点的空壳。 */ async () => {
    mounted = mount(Tree, {
      props: { bordered: true, treeData: TREE_DATA },
    });
    await nextTick();

    expect(mounted.find('.tree-node').exists()).toBe(true);
    expect(mounted.text()).toContain('DUMMY-研发部');
    // 调用方传入的 bordered 必须真实生效，缺失边框会让树与周边内容糊在一起。
    expect(mounted.find('.container').classes()).toContain('border');
  });

  it('把具名插槽连同作用域参数透传给核心树', /** 插槽丢失会让调用方定制的节点渲染整块消失。 */ async () => {
    const nodeScopes: Record<string, unknown>[] = [];

    mounted = mount(Tree, {
      props: { treeData: SINGLE_NODE_DATA },
      slots: {
        /** 节点插槽：记录核心树传入的作用域参数并渲染自定义内容。 */
        node: (scope) => {
          nodeScopes.push(scope as Record<string, unknown>);
          return h('span', { class: 'custom-tree-node' }, 'DUMMY-自定义节点');
        },
      },
    });
    await nextTick();

    expect(mounted.find('.custom-tree-node').text()).toBe('DUMMY-自定义节点');
    // 作用域参数必须原样透传，否则调用方拿不到当前节点数据；核心树重渲染会多次调用插槽，
    // 因此逐个核对：代理层之下就是调用方传入的那个节点对象。
    expect(nodeScopes.length).toBeGreaterThan(0);
    expect(
      nodeScopes.every(
        /** 每次调用都要拿到同一个真实节点对象。 */ (scope) =>
          toRaw(scope.value) === SINGLE_NODE_DATA[0],
      ),
    ).toBe(true);
    // 自定义节点替换掉默认渲染的标签文本，说明插槽确实生效而不是被忽略。
    expect(mounted.text()).not.toContain('DUMMY-研发部');
  });
});
