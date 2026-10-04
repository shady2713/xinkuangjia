/**
 * 省略文本组件（common-ui 的 ellipsis-text）真实行为回归。
 *
 * 该组件负责单行/多行截断、点击展开与"仅在真正被截断时显示提示框"三件事：截断类名或
 * 行数写错会让文本溢出布局，展开状态写错会让用户点不开完整内容，截断检测口径写错会让
 * 提示框要么从不出现要么对未截断的文本也弹出。用例挂载真实组件，通过真实 DOM 度量与
 * 受控的 ResizeObserver 驱动截断检测，并断言组件计算出的提示框门控值与触发区真实结构。
 *
 * 提示框边界替换为记录型替身：真实的 `VbenTooltip` 并未声明 `disabled` 属性（本轮发现的
 * 真实缺陷，已单独报告），因此用真实组件无法观察本组件的门控结果；替身同时避免加载整个
 * shadcn-ui 桶文件而让其它未渲染组件出现"只被导入即通过"的假覆盖。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { VNode } from 'vue';

import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EllipsisText from '../ellipsis-text.vue';

/** 提示框替身收到的最近一次属性，供断言核对本组件的门控结果。 */
const tooltipStub = vi.hoisted(
  /** 建立跨用例可读的属性记录容器。 */ () => ({
    /** 最近一次渲染收到的属性。 */
    current: {} as Record<string, unknown>,
  }),
);

/** 提示框替身需要渲染的插槽集合。 */
interface StubSlots {
  /** 默认插槽，渲染提示内容。 */
  default?: () => VNode;
  /** trigger 插槽，渲染真实触发区。 */
  trigger?: () => VNode;
}

/** 提示框替身需要的组件上下文。 */
interface StubContext {
  /** 需要原样渲染的插槽集合。 */
  slots: StubSlots;
}

vi.mock(
  '@vben-core/shadcn-ui',
  /** 只替换提示框边界，省略检测与展开逻辑保持真实实现。 */ () => ({
    VbenTooltip: {
      /** 声明真实组件接收的属性，保证本组件传入的门控值可被观察。 */
      props: ['contentStyle', 'disabled', 'side'],
      /**
       * 记录每次渲染收到的属性，并渲染提示框替身结构。
       * @param props 组件传入的真实属性，用于记录门控结果与提示宽度。
       * @param context 组件上下文。
       * @param context.slots 需要原样渲染的默认插槽与 trigger 插槽。
       * @returns 返回渲染提示框替身结构的函数。
       */
      setup(props: Record<string, unknown>, { slots }: StubContext) {
        /**
         * 渲染提示框替身：把门控与内容样式暴露到真实 DOM，并渲染两个插槽。
         * @returns 提示框替身节点。
         */
        function renderStub() {
          tooltipStub.current = {
            contentStyle: props.contentStyle,
            disabled: props.disabled,
            side: props.side,
          };
          return h(
            'div',
            {
              class: 'tooltip-stub',
              'data-disabled': String(props.disabled),
              'data-side': String(props.side),
            },
            [
              ...(slots.trigger ? [slots.trigger()] : []),
              h(
                'div',
                { class: 'tooltip-content', style: props.contentStyle },
                slots.default ? [slots.default()] : [],
              ),
            ],
          );
        }

        return renderStub;
      },
    },
  }),
);

/** 元素内容区域尺寸，字段与真实观察器条目一致。 */
interface ContentRect {
  /** 内容高度，单位像素。 */
  height: number;
  /** 内容宽度，单位像素。 */
  width: number;
}

/** 一条尺寸变化条目。 */
interface ResizeEntry {
  /** 元素新的内容区域尺寸。 */
  contentRect: ContentRect;
}

/** 组件注册的尺寸变化回调。 */
type ResizeCallback = (entries: ResizeEntry[]) => void;

/** 受控的 ResizeObserver 替身，用于在伪 DOM 中驱动真实尺寸变化回调。 */
class ResizeObserverStub {
  /** 本用例创建的全部实例，供断言观察与释放行为。 */
  static instances: ResizeObserverStub[] = [];

  /** 是否已断开监听。 */
  disconnected = false;

  /** 被观察的元素列表。 */
  targets: Element[] = [];

  /** 组件注册的尺寸变化回调。 */
  private readonly callback: ResizeCallback;

  /**
   * 保存组件注册的回调并登记实例。
   * @param callback 组件注册的尺寸变化回调。
   */
  constructor(callback: ResizeCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  /** 标记监听已断开。 */
  disconnect() {
    this.disconnected = true;
  }

  /**
   * 触发一次尺寸变化。
   * @param width 元素新的内容宽度，单位像素。
   * @param height 元素新的内容高度，单位像素。
   */
  emitSize(width: number, height: number) {
    this.callback([{ contentRect: { height, width } }]);
  }

  /**
   * 记录被观察元素。
   * @param target 组件要求观察的元素。
   */
  observe(target: Element) {
    this.targets.push(target);
  }

  /**
   * 取消单个元素的观察；本替身不区分单个目标，交由 disconnect 统一断言。
   */
  unobserve() {}
}

/**
 * 挂载省略文本组件。
 * @param props 传给组件的真实属性。
 * @param text 默认插槽文本，空串代表没有可见文本。
 * @returns 组件包装器。
 */
function mountEllipsis(
  props: Record<string, unknown> = {},
  text = '一段很长的文本',
) {
  return mount(EllipsisText, { props, slots: { default: text } });
}

/**
 * 取出触发区元素并覆盖其截断度量。
 * @param wrapper 已挂载的组件。
 * @param size 需要伪造的滚动区与可视区尺寸。
 * @param size.scrollWidth 滚动宽度。
 * @param size.clientWidth 可视宽度。
 * @param size.scrollHeight 滚动高度。
 * @param size.clientHeight 可视高度。
 * @returns 触发区元素。
 */
async function setMetrics(
  wrapper: VueWrapper,
  size: {
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
    scrollWidth: number;
  },
) {
  const element = wrapper.find('.cursor-text').element;
  for (const [key, value] of Object.entries(size)) {
    Object.defineProperty(element, key, { configurable: true, value });
  }
  return element;
}

/**
 * 读取提示框替身当前收到的禁用标记。
 * @param wrapper 已挂载的组件。
 * @returns 组件计算出的提示框禁用值。
 */
function tooltipDisabled(wrapper: VueWrapper) {
  return wrapper.find('.tooltip-stub').attributes('data-disabled');
}

/**
 * 读取触发区当前的行数限制。
 *
 * 伪 DOM 的 CSSStyleDeclaration 把 `-webkit-line-clamp` 记成自有属性而不是标准声明，
 * 序列化后的 style 文本里看不到它，因此这里读取真实写入结果。
 *
 * @param wrapper 已挂载的组件。
 * @returns 写入的行数限制值；展开状态下为空串。
 */
function lineClampOf(wrapper: VueWrapper) {
  const element = wrapper.find('.cursor-text').element as HTMLElement;
  return (element.style as unknown as Record<string, unknown>)[
    '-webkit-line-clamp'
  ];
}

/**
 * 取出观察了触发区元素的观察器，最后一个即组件自身为截断检测创建的那个。
 * @param wrapper 已挂载的组件。
 * @returns 观察了触发区的观察器列表，按创建顺序排列。
 */
function observingStubs(wrapper: VueWrapper) {
  const trigger = wrapper.find('.cursor-text').element;
  return ResizeObserverStub.instances.filter(
    /** 只保留真正观察触发区的观察器，元素尺寸工具的观察器始终存在。 */ (
      observer,
    ) => observer.targets.includes(trigger),
  );
}

/**
 * 模拟一次真实尺寸变化。
 *
 * 元素尺寸工具与组件自身的截断检测各注册了一个观察器，真实浏览器会分别回调，
 * 因此这里向所有观察该元素的替身分发同一条条目。
 *
 * @param wrapper 已挂载的组件。
 * @param width 新的内容宽度，单位像素。
 * @param height 新的内容高度，单位像素。
 * @throws 触发区没有被任何观察器观察时抛出，避免尺寸变化被静默忽略。
 */
async function emitResize(wrapper: VueWrapper, width: number, height: number) {
  // 元素尺寸工具的观察器在后置侦听器里登记，先让挂载期任务完成再分发尺寸变化。
  await nextTick();
  await nextTick();
  const observers = observingStubs(wrapper);
  if (observers.length === 0) {
    throw new Error('触发区必须被至少一个观察器观察');
  }
  for (const observer of observers) {
    observer.emitSize(width, height);
  }
  await nextTick();
}

beforeEach(
  /** 每例使用独立观察器实例集合。 */ () => {
    ResizeObserverStub.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  },
);

afterEach(
  /** 撤销全局观察器替身，避免影响其它用例。 */ () => {
    vi.unstubAllGlobals();
  },
);

describe('ellipsisText 截断与展开', /** 类名、行数与展开状态必须落在真实 DOM 上。 */ () => {
  it('默认按单行截断并限制最大宽度', /** 截断类名或行数写错会让文本溢出布局。 */ () => {
    const wrapper = mountEllipsis();

    const trigger = wrapper.find('.cursor-text');
    expect(trigger.classes()).toContain('block');
    expect(trigger.classes()).toContain('truncate');
    expect(lineClampOf(wrapper)).toBe(1);
    expect(trigger.attributes('style')).toContain('max-width: 100%');
    expect(tooltipStub.current).toMatchObject({ disabled: false, side: 'top' });

    wrapper.unmount();
  });

  it('数字宽度按像素换算，字符串宽度原样使用', /** 单位口径写错会让最大宽度失效或写成非法值。 */ () => {
    const numeric = mountEllipsis({ maxWidth: 300 });
    expect(numeric.find('.cursor-text').attributes('style')).toContain(
      'max-width: 300px',
    );
    numeric.unmount();

    const text = mountEllipsis({ maxWidth: '50%' });
    expect(text.find('.cursor-text').attributes('style')).toContain(
      'max-width: 50%',
    );
    text.unmount();
  });

  it('多行模式按行数截断并切换样式类', /** 多行仍套用单行截断类会让文本被压成一行。 */ () => {
    const wrapper = mountEllipsis({ line: 3 });

    const trigger = wrapper.find('.cursor-text');
    expect(trigger.classes()).not.toContain('truncate');
    expect(lineClampOf(wrapper)).toBe(3);

    wrapper.unmount();
  });

  it('未开启展开时点击不改变状态', /** 点击副作用会让只读展示区域出现意外交互。 */ async () => {
    const wrapper = mountEllipsis({ expand: false });

    await wrapper.find('.cursor-text').trigger('click');

    expect(wrapper.emitted('expandChange')).toBeUndefined();
    expect(wrapper.find('.cursor-text').classes()).not.toContain(
      '!cursor-pointer',
    );

    wrapper.unmount();
  });

  it('开启展开时点击切换状态并抛出事件', /** 展开状态或事件丢失会让用户点不开完整内容。 */ async () => {
    const wrapper = mountEllipsis({ expand: true });

    const trigger = wrapper.find('.cursor-text');
    expect(trigger.classes()).toContain('!cursor-pointer');

    await trigger.trigger('click');

    expect(wrapper.emitted('expandChange')).toEqual([[true]]);
    expect(lineClampOf(wrapper)).toBe('');

    await trigger.trigger('click');

    expect(wrapper.emitted('expandChange')).toEqual([[true], [false]]);
    expect(lineClampOf(wrapper)).toBe(1);

    wrapper.unmount();
  });
});

describe('ellipsisText 提示框门控', /** 只有真正被截断的文本才允许弹出提示框。 */ () => {
  it('关闭提示框时门控为禁用', /** tooltip 关闭后仍弹出提示会遮挡界面。 */ () => {
    const wrapper = mountEllipsis({ tooltip: false });

    expect(tooltipDisabled(wrapper)).toBe('true');

    wrapper.unmount();
  });

  it('开启截断检测但未截断时门控为禁用', /** 未截断仍弹出会让用户看到与显示内容重复的浮层。 */ async () => {
    const wrapper = mountEllipsis({ tooltipWhenEllipsis: true });
    await setMetrics(wrapper, {
      clientHeight: 20,
      clientWidth: 200,
      scrollHeight: 20,
      scrollWidth: 200,
    });

    wrapper.vm.$forceUpdate();
    await nextTick();

    expect(tooltipDisabled(wrapper)).toBe('true');

    wrapper.unmount();
  });

  it('宽度差超过阈值后放行提示框', /** 阈值判定失效会让长文本看不到完整内容。 */ async () => {
    const wrapper = mountEllipsis({ tooltipWhenEllipsis: true });
    await setMetrics(wrapper, {
      clientHeight: 20,
      clientWidth: 100,
      scrollHeight: 20,
      scrollWidth: 200,
    });

    wrapper.vm.$forceUpdate();
    await nextTick();

    expect(tooltipDisabled(wrapper)).toBe('false');

    wrapper.unmount();
  });

  it('宽度差不超过阈值时保持禁用', /** 阈值用于过滤亚像素误差，写反会让提示框频繁闪现。 */ async () => {
    const wrapper = mountEllipsis({ tooltipWhenEllipsis: true });
    await setMetrics(wrapper, {
      clientHeight: 20,
      clientWidth: 200,
      scrollHeight: 20,
      scrollWidth: 202,
    });

    wrapper.vm.$forceUpdate();
    await nextTick();

    expect(tooltipDisabled(wrapper)).toBe('true');

    wrapper.unmount();
  });

  it('多行模式按高度差判定，单行模式忽略高度差', /** 判定维度选错会让多行文本永远弹不出提示框。 */ async () => {
    const multi = mountEllipsis({ line: 2, tooltipWhenEllipsis: true });
    await setMetrics(multi, {
      clientHeight: 20,
      clientWidth: 200,
      scrollHeight: 60,
      scrollWidth: 200,
    });
    multi.vm.$forceUpdate();
    await nextTick();
    expect(tooltipDisabled(multi)).toBe('false');
    multi.unmount();

    const single = mountEllipsis({ line: 1, tooltipWhenEllipsis: true });
    await setMetrics(single, {
      clientHeight: 20,
      clientWidth: 200,
      scrollHeight: 60,
      scrollWidth: 200,
    });
    single.vm.$forceUpdate();
    await nextTick();
    expect(tooltipDisabled(single)).toBe('true');
    single.unmount();
  });

  it('空文本即使尺寸异常也保持禁用', /** 空白文本被判定为截断会弹出空提示框。 */ async () => {
    const wrapper = mountEllipsis({ tooltipWhenEllipsis: true }, '   ');
    await setMetrics(wrapper, {
      clientHeight: 0,
      clientWidth: 0,
      scrollHeight: 0,
      scrollWidth: 200,
    });

    wrapper.vm.$forceUpdate();
    await nextTick();

    expect(tooltipDisabled(wrapper)).toBe('true');

    wrapper.unmount();
  });

  it('尺寸变化后重新判定并透传提示内容宽度', /** 不监听尺寸变化会让折叠面板展开后提示框判定过期。 */ async () => {
    const wrapper = mountEllipsis({
      tooltipWhenEllipsis: true,
      tooltipMaxWidth: undefined,
    });
    await setMetrics(wrapper, {
      clientHeight: 20,
      clientWidth: 100,
      scrollHeight: 20,
      scrollWidth: 200,
    });
    const observers = observingStubs(wrapper);
    expect(observers).toHaveLength(2);
    const componentObserver = observers.at(-1);

    await emitResize(wrapper, 150, 20);

    await vi.waitFor(
      /** 宽度经尺寸工具与后置侦听器写入模板，按真实渲染结果等待。 */ () => {
        expect(tooltipDisabled(wrapper)).toBe('false');
        expect(wrapper.find('.tooltip-content').attributes('style')).toContain(
          'max-width: 174px',
        );
      },
    );

    wrapper.unmount();

    expect(componentObserver?.disconnected).toBe(true);
  });

  it('显式提示宽度优先于元素宽度', /** 配置被自动宽度覆盖会让调用方无法约束提示框尺寸。 */ async () => {
    const wrapper = mountEllipsis({
      tooltipWhenEllipsis: true,
      tooltipMaxWidth: 320,
    });
    await emitResize(wrapper, 150, 20);

    await vi.waitFor(
      /** 显式宽度按后置侦听器写入模板，按真实渲染结果等待。 */ () => {
        expect(wrapper.find('.tooltip-content').attributes('style')).toContain(
          'max-width: 320px',
        );
      },
    );

    wrapper.unmount();
  });

  it('关闭截断检测时组件不注册尺寸监听', /** 关闭检测后仍监听会白白持有元素引用。 */ async () => {
    const wrapper = mountEllipsis({ tooltipWhenEllipsis: false });
    await nextTick();
    await nextTick();

    // 元素尺寸工具始终观察触发区，组件只在开启截断检测时额外注册自己的观察器。
    expect(observingStubs(wrapper)).toHaveLength(1);

    wrapper.unmount();
  });

  it('多行截断检测下点击展开会重新判定门控', /** 展开后不重新判定会让提示框状态停留在展开前的结论。 */ async () => {
    const wrapper = mountEllipsis({
      expand: true,
      line: 2,
      tooltipWhenEllipsis: true,
    });
    await setMetrics(wrapper, {
      clientHeight: 20,
      clientWidth: 100,
      scrollHeight: 60,
      scrollWidth: 100,
    });
    wrapper.vm.$forceUpdate();
    await nextTick();
    expect(tooltipDisabled(wrapper)).toBe('false');

    await wrapper.find('.cursor-text').trigger('click');

    expect(wrapper.emitted('expandChange')).toEqual([[true]]);
    expect(tooltipDisabled(wrapper)).toBe('true');

    wrapper.unmount();
  });
});
