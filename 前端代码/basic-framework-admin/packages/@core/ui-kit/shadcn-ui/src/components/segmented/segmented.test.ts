/**
 * 分段控制器（shadcn-ui 的 segmented）真实行为回归。
 *
 * 该组件把页签数据渲染成等宽的段控件：网格列数决定各段宽度，指示器宽度决定滑块
 * 覆盖范围，激活段的加粗高亮与插槽内容必须跟随选中值。列数或宽度算错会让滑块与
 * 段错位，激活样式判断写错会让用户看不出当前选中项。用例挂载真实组件与真实
 * reka-ui 页签，断言 DOM 上的样式、类名、插槽内容与 v-model 事件。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Segmented from './segmented.vue';

/** 观察者回调签名；与浏览器 ResizeObserver 的回调形状一致。 */
type ResizeCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver,
) => void;

/**
 * 可控的 ResizeObserver 替身。
 * happy-dom 的实现不会像真实浏览器那样在观察后立即回调一次，导致指示器尺寸永不更新；
 * 这里只替换“何时回调”这一环境差异，尺寸计算与样式输出仍由真实组件执行。
 */
class ControllableResizeObserver {
  /** 全部替身实例，供用例在渲染完成后主动触发一次测量。 */
  static instances: ControllableResizeObserver[] = [];

  /** 浏览器传入的尺寸变化回调。 */
  callback: ResizeCallback;

  /**
   * 记录回调并登记实例。
   * @param callback 浏览器传入的尺寸变化回调。
   */
  constructor(callback: ResizeCallback) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  /**
   * 断开观察；本替身不需要释放资源。
   */
  disconnect() {}

  /**
   * 记录被观察元素；本替身不区分元素。
   */
  observe() {}

  /**
   * 取消观察；本替身不区分元素。
   */
  unobserve() {}
}

/**
 * 触发全部已登记的观察者回调，模拟浏览器观察后的首次测量。
 * @returns 收敛后的 Promise。
 */
async function flushResizeObservers() {
  for (const observer of ControllableResizeObserver.instances) {
    observer.callback([], observer as unknown as ResizeObserver);
  }
  await nextTick();
}

/** 两段页签基线：覆盖激活与未激活两种状态。 */
const twoTabs = [
  { label: '按天', value: 'day' },
  { label: '按周', value: 'week' },
];

/**
 * 挂载分段控制器。
 * @param props 组件属性，含模型值与页签数据。
 * @param slots 按页签值提供的具名插槽。
 * @returns 已挂载的组件包装器。
 */
function mountSegmented(
  props: Record<string, unknown>,
  slots?: Record<
    string,
    /** 具名插槽：按页签值渲染对应内容。 */
    () => string
  >,
) {
  return mount(Segmented, { props, slots });
}

/**
 * 读取页签列表元素。
 * @param wrapper 已挂载的组件包装器。
 * @returns 页签列表元素包装器。
 * @throws 页签列表未渲染时报告组件回归。
 */
function getTablist(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('[role="tablist"]');
}

/**
 * 找到指示器元素：页签列表内唯一带有内联宽度的子元素。
 * @param wrapper 已挂载的组件包装器。
 * @returns 指示器元素；未渲染时为 undefined。
 */
function findIndicator(wrapper: ReturnType<typeof mount>) {
  const elements = [
    ...getTablist(wrapper).element.querySelectorAll<HTMLElement>('*'),
  ];
  return elements.find(
    /** 只保留带内联宽度的元素，即指示器本身。 */ (element) =>
      element.style.width !== '',
  );
}

describe('分段布局', /** 段宽与滑块宽度直接决定控件是否与实际选项对齐。 */ () => {
  beforeEach(
    /** 每例使用独立的观察者替身集合。 */ () => {
      ControllableResizeObserver.instances = [];
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);
    },
  );

  afterEach(
    /** 还原被替换的全局观察者。 */ () => {
      vi.unstubAllGlobals();
    },
  );

  it('按页签数量设置等宽网格与指示器宽度', /** 列数或宽度算错会让滑块停在错误的段上。 */ async () => {
    const wrapper = mountSegmented({ modelValue: 'day', tabs: twoTabs });
    // 指示器在选中段渲染完成并完成一次测量后才输出宽度。
    await nextTick();
    await flushResizeObservers();

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    expect(getTablist(wrapper).attributes('style')).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
    );
    expect(findIndicator(wrapper)?.style.width).toBe('50%');
  });

  it('三段时指示器宽度为三分之一', /** 宽度按数量动态计算，写死会让多段场景错位。 */ async () => {
    const wrapper = mountSegmented({
      modelValue: 'month',
      tabs: [...twoTabs, { label: '按月', value: 'month' }],
    });
    await nextTick();
    await flushResizeObservers();

    expect(findIndicator(wrapper)?.style.width).toBe('33%');
  });

  it('没有页签时不渲染任何段与指示器', /** 空数据必须安全退化为空控件，而不是渲染出 undefined 段。 */ async () => {
    const wrapper = mountSegmented({ modelValue: 'day', tabs: [] });
    await nextTick();
    await flushResizeObservers();

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(findIndicator(wrapper)).toBeUndefined();
  });
});

describe('激活状态', /** 激活段的高亮与滑块位置是用户判断当前视图的唯一线索。 */ () => {
  it('模型值对应的段加粗高亮且其它段保持普通样式', /** 高亮判断写错会让用户看不出当前选中项。 */ () => {
    const wrapper = mountSegmented({ modelValue: 'day', tabs: twoTabs });
    const [dayTab, weekTab] = wrapper.findAll('[role="tab"]');

    expect(dayTab?.classes()).toContain('!font-bold');
    expect(dayTab?.classes()).toContain('text-primary');
    expect(weekTab?.classes()).not.toContain('!font-bold');
    expect(weekTab?.classes()).not.toContain('text-primary');
  });

  it('只传 defaultValue 时滑块选中该段但组件自身高亮未同步', /** 高亮类取自组件自身的模型值，未传 v-model 时与内部选中状态不一致，此处如实记录。 */ () => {
    const wrapper = mountSegmented({ defaultValue: 'week', tabs: twoTabs });
    const [, weekTab] = wrapper.findAll('[role="tab"]');

    expect(weekTab?.attributes('data-state')).toBe('active');
    expect(weekTab?.classes()).not.toContain('text-primary');
  });

  it('既无模型值也无缺省值时内部选中第一段', /** 回退到首段是控件的初始契约，回退错会让首屏显示空视图。 */ () => {
    const wrapper = mountSegmented({ defaultValue: '', tabs: twoTabs });

    const [dayTab] = wrapper.findAll('[role="tab"]');
    expect(dayTab?.attributes('data-state')).toBe('active');
  });

  it('点击其它段发出 v-model 更新并切换高亮', /** 事件未发出会让父组件状态与控件显示不一致。 */ async () => {
    let wrapper: ReturnType<typeof mount>;
    const onUpdate = vi.fn(
      /** 模拟父组件回写模型值，使受控高亮跟随选中段。 */ (value: string) => {
        wrapper.setProps({ modelValue: value });
      },
    );
    wrapper = mountSegmented({
      modelValue: 'day',
      'onUpdate:modelValue': onUpdate,
      tabs: twoTabs,
    });
    const [, weekTab] = wrapper.findAll('[role="tab"]');

    // reka-ui 的页签在鼠标左键按下时切换选中段。
    await weekTab?.trigger('mousedown');
    await nextTick();

    expect(onUpdate).toHaveBeenCalledWith('week');
    const [dayTabAfter, weekTabAfter] = wrapper.findAll('[role="tab"]');
    expect(weekTabAfter?.classes()).toContain('!font-bold');
    expect(dayTabAfter?.classes()).not.toContain('!font-bold');
  });
});

describe('页签内容插槽', /** 每段内容由调用方按页签值提供插槽，插槽名或渲染时机写错会显示空白。 */ () => {
  it('渲染当前段的插槽内容并在切换后替换', /** 内容不跟随选中值会让用户看到与所选视图不符的数据。 */ async () => {
    let wrapper: ReturnType<typeof mount>;
    const onUpdate = vi.fn(
      /** 模拟父组件回写模型值，使内容插槽跟随选中段。 */ (value: string) => {
        wrapper.setProps({ modelValue: value });
      },
    );
    wrapper = mountSegmented(
      {
        modelValue: 'day',
        'onUpdate:modelValue': onUpdate,
        tabs: twoTabs,
      },
      {
        /** 按天视图内容。 */
        day: () => '按天内容',
        /** 按周视图内容。 */
        week: () => '按周内容',
      },
    );

    expect(wrapper.text()).toContain('按天内容');

    const [, weekTab] = wrapper.findAll('[role="tab"]');
    await weekTab?.trigger('mousedown');
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain('按周内容');
  });
});
