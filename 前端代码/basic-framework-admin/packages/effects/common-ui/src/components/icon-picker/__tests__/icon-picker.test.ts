/**
 * 图标选择器（common-ui 的 components/icon-picker/icon-picker.vue）真实行为回归。
 *
 * 选择器要在三种图标来源（远程图标集接口、本地已注册图标集、调用方直接传入的列表）之间取到
 * 正确的一批图标，并支持真实搜索、真实分页与真实选择回写：来源优先级写错会显示另一套图标，
 * 过滤或分页算错会让用户翻不到目标图标，选择不回写会让业务拿不到图标名，浮层开关失效会让面板
 * 打不开或关不掉。用例把图标真实注册进 Iconify 运行时、真实打开浮层并点击真实图标按钮；只有
 * 远程图标集接口属于外部边界，用替身提供响应体，其余过滤、分页、选择与事件全部走真实实现。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick, useAttrs } from 'vue';

import { addIcon, listIcons } from '@vben/icons';
import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import IconPicker from '../icon-picker.vue';

/** 基础用例使用的图标集前缀。 */
const BASIC_PREFIX = 'batch17-pick';
/** 分页用例使用的图标集前缀，注册数量超过一页。 */
const PAGE_PREFIX = 'batch17-page';
/** 远程拉取用例使用的图标集前缀。 */
const REMOTE_PREFIX = 'batch17-remote';
/** 未注册任何图标的图标集前缀，用于核对空态。 */
const MISSING_PREFIX = 'batch17-missing';
/** 页数足够触发省略号的大图标集前缀。 */
const MANY_PREFIX = 'batch17-many';
/** 一页图标数量，与组件默认分页大小一致。 */
const PAGE_SIZE = 36;

/**
 * 把图标真实注册进 Iconify 运行时。
 * @param prefix 图标集前缀。
 * @param names 图标名列表。
 * @returns 带前缀的图标全名列表，顺序与入参一致。
 */
function registerIcons(prefix: string, names: string[]): string[] {
  return names.map(
    /** 按注册顺序生成图标全名。 */ (name, index) => {
      const fullName = `${prefix}:${name}`;
      // 每个图标带一份可辨识的真实图形，用例据此还原渲染出的到底是哪一个图标。
      addIcon(fullName, {
        body: `<path d="M${index} 0h1v1h-1z"/>`,
        height: 24,
        width: 24,
      });
      return fullName;
    },
  );
}

/** 基础图标集的真实图标名。 */
registerIcons(BASIC_PREFIX, ['home', 'user']);
/** 远程图标集返回的真实图标名，同时注册进运行时以便真实渲染。 */
const REMOTE_ICONS = registerIcons(REMOTE_PREFIX, ['cloud', 'server']);
/** 分页图标集的真实图标名，数量超过一页。 */
const PAGE_ICONS = registerIcons(
  PAGE_PREFIX,
  Array.from(
    /** 生成固定数量的图标名，保证分页断言可复现。 */ { length: PAGE_SIZE + 4 },
    /** 按序号生成分页图标名。 */ (_value, index) => `icon-${index + 1}`,
  ),
);
/** 大图标集的真实图标名，页数足以让分页折叠中间页。 */
const MANY_ICONS = registerIcons(
  MANY_PREFIX,
  Array.from(
    /** 生成 8 页图标，触发分页的省略号分支。 */ { length: PAGE_SIZE * 8 },
    /** 按序号生成大图标集的图标名。 */ (_value, index) => `many-${index + 1}`,
  ),
);

/** 自定义输入组件探针：渲染当前值、图标插槽与真实输入控件，并把输入回传给调用方。 */
const ProbeInput = defineComponent({
  name: 'ProbeInput',
  inheritAttrs: false,
  props: {
    placeholder: { default: '', type: String },
    slotName: { default: 'default', type: String },
    value: { default: '', type: String },
  },
  emits: ['update:value'],
  /**
   * 渲染当前值、指定插槽与真实输入控件。
   * @param props 传入的占位文案、插槽名与当前值。
   * @param context 组件上下文，用于读取插槽、透传属性与回传输入。
   * @returns 渲染探针结构的渲染函数。
   */
  setup(props, { emit, slots }) {
    const attrs = useAttrs();
    return /** 渲染值、插槽与真实输入控件。 */ () =>
      // 展开属性可能自带 class，必须显式合并，避免探针自己的类名被覆盖。
      h('div', { ...attrs, class: ['probe-input', attrs.class] }, [
        h('span', { class: 'probe-value' }, String(props.value)),
        h('span', { class: 'probe-slot' }, slots[props.slotName]?.() ?? ''),
        h('input', {
          class: 'probe-field',
          placeholder: props.placeholder,
          value: props.value,
          /** 把用户在真实输入框里的输入回传。 */
          onInput: (event: Event) => {
            emit('update:value', (event.target as HTMLInputElement).value);
          },
        }),
      ]);
  },
});

/** 组件通过 defineExpose 暴露的公开操作。 */
type IconPickerExposed = {
  /** 关闭浮层。 */
  close: () => void;
  /** 打开浮层。 */
  open: () => void;
  /** 反转浮层的开合状态。 */
  toggleOpenState: () => void;
};

/**
 * 读取组件暴露的公开操作。
 * @param wrapper 已挂载的图标选择器。
 * @returns 组件暴露的浮层开关方法。
 * @throws 暴露契约变化时抛出，避免断言落到 undefined 上。
 */
function exposedOf(wrapper: ReturnType<typeof mount>): IconPickerExposed {
  const exposed = wrapper.vm as unknown as Partial<IconPickerExposed>;
  if (!exposed.close || !exposed.open || !exposed.toggleOpenState) {
    throw new Error('图标选择器未暴露浮层开关方法');
  }
  return exposed as IconPickerExposed;
}

/** 等待浮层真实渲染到文档中。 */
async function waitForPopover() {
  await vi.waitFor(
    /** 等待传送节点把浮层内容渲染进文档。 */ () => {
      expect(document.querySelector('.side-content')).not.toBeNull();
    },
    { timeout: 3000 },
  );
}

/** 等待浮层真实从文档中消失。 */
async function waitForPopoverClosed() {
  await vi.waitFor(
    /** 等待浮层内容被真实卸载。 */ () => {
      expect(document.querySelector('.side-content')).toBeNull();
    },
    { timeout: 3000 },
  );
}

/**
 * 读取浮层内真实渲染的图标图形路径。
 * @returns 按渲染顺序排列的图形路径。
 */
function readRenderedIconPaths(): string[] {
  return [...document.querySelectorAll('.grid svg path')].map(
    /** 只取图形路径，用于还原渲染出的图标。 */ (path) =>
      path.getAttribute('d') ?? '',
  );
}

/**
 * 读取浮层内真实渲染的图标按钮数量。
 * @returns 图标按钮数量。
 */
function countIconButtons(): number {
  return document.querySelectorAll('.grid button').length;
}

/**
 * 取出必须存在的浮层内元素。
 * @param selector 目标选择器。
 * @returns 命中的元素。
 * @throws 元素缺失时抛出，避免断言落到 undefined 上。
 */
function needInPopover<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`浮层内未渲染出元素 ${selector}`);
  }
  return element;
}

/**
 * 取出浮层内的第二页按钮。
 * @returns 可见文案为 2 的页码按钮。
 * @throws 分页未渲染出第二页按钮时抛出，避免点击落到 undefined 上。
 */
function needSecondPageButton(): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('.side-content button'),
  ].find(
    /** 按可见页码定位第二页按钮。 */ (item) =>
      item.textContent?.trim() === '2',
  );
  if (!button) {
    throw new Error('分页未渲染出第二页按钮');
  }
  return button;
}

/**
 * 在真实输入框中输入文本。
 * @param input 目标输入框。
 * @param value 要输入的文本。
 * @returns 输入事件派发完成后兑现的 Promise。
 */
async function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

beforeAll(
  /** 装配真实中文语言包：占位与空态文案都要断言到用户可见文字。 */ async () => {
    await setupI18n(
      createApp({
        /** 语言包装配不需要渲染任何界面元素。 */
        render: () => null,
      }),
      { defaultLocale: 'zh-CN' },
    );
  },
);

afterEach(
  /** 卸载残留浮层并撤销全局替身，避免用例之间互相影响。 */ () => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe('图标选择器图标来源', /** 三种图标来源的优先级决定用户看到哪一套图标。 */ () => {
  it('按远程图标集接口返回的图标渲染', /** 远程图标集拿不到会让选择器永远只有空态。 */ async () => {
    const fetchMock = vi.fn(
      /** 交出 Iconify 集合响应体。 */ async () => ({
        /** 按 Iconify 集合协议返回未分类图标名。 */
        json: () => ({
          prefix: REMOTE_PREFIX,
          title: 'Remote Icons',
          total: 2,
          uncategorized: ['cloud', 'server'],
        }),
      }),
    );
    // 远程图标集接口属于外部边界，测试进程不能访问网络，这里只替换响应体。
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: true, prefix: REMOTE_PREFIX },
    });
    exposedOf(wrapper).toggleOpenState();
    await waitForPopover();

    await vi.waitFor(
      /** 等待防抖后的远程图标真实渲染进列表。 */ () => {
        expect(countIconButtons()).toBe(2);
      },
      { timeout: 3000 },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.iconify.design/collection?prefix=${REMOTE_PREFIX}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(readRenderedIconPaths()).toEqual(['M0 0h1v1h-1z', 'M1 0h1v1h-1z']);
    // 远程图标集名与本地注册名一致时，图标必须能真实画出图形。
    expect(listIcons('', REMOTE_PREFIX)).toEqual(REMOTE_ICONS);

    wrapper.unmount();
  });

  it('关闭自动拉取时按本地已注册的图标集渲染', /** 关闭远程拉取后仍显示空态会让离线图标集不可用。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, prefix: BASIC_PREFIX },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    expect(countIconButtons()).toBe(2);
    expect(readRenderedIconPaths()).toEqual(['M0 0h1v1h-1z', 'M1 0h1v1h-1z']);

    wrapper.unmount();
  });

  it('图标集为空时告警并渲染空态', /** 静默显示空列表会让调用方排查不出图标集名写错。 */ async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 静默预期内的告警，避免污染测试输出。 */ () => {});
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, prefix: MISSING_PREFIX },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    expect(consoleWarn).toHaveBeenCalledWith(
      `No icons found for prefix: ${MISSING_PREFIX}`,
    );
    expect(countIconButtons()).toBe(0);
    expect(document.body.textContent).toContain('暂无数据');
    // 空态图标缺失会让用户只看到一块没有任何提示的空白。
    expect(document.querySelector('.side-content svg')).not.toBeNull();

    wrapper.unmount();
  });

  it('未指定图标集前缀时使用调用方传入的图标列表', /** 列表来源被前缀分支吞掉会让业务无法自定义候选图标。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: {
        icons: [`${BASIC_PREFIX}:user`],
        prefix: '',
      },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    expect(countIconButtons()).toBe(1);
    expect(readRenderedIconPaths()).toEqual(['M1 0h1v1h-1z']);

    wrapper.unmount();
  });

  it('图标列表不是数组时记录错误并退化为空态', /** 业务把可空字段直接透传进来时，组件崩溃会拖垮整个表单。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默预期内的错误日志，避免污染测试输出。 */ () => {},
      );
    // 远程图标集接口属于外部边界，测试进程不能访问网络，这里只替换响应体。
    vi.stubGlobal(
      'fetch',
      vi.fn(
        /** 交出 Iconify 集合响应体。 */ async () => ({
          /** 交出空集合，焦点放在列表异常兜底上。 */
          json: () => ({
            prefix: REMOTE_PREFIX,
            title: 'Remote Icons',
            total: 0,
            uncategorized: [],
          }),
        }),
      ),
    );

    const wrapper = mount(IconPicker, {
      props: {
        // 运行期传入空值（后端字段为空直接透传）是真实存在的调用方式，
        // 组件必须退化为空列表，而不是让整页交互崩掉。
        icons: null as unknown as string[],
        prefix: REMOTE_PREFIX,
      },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load icons:',
      expect.any(Error),
    );
    expect(countIconButtons()).toBe(0);
    expect(document.body.textContent).toContain('暂无数据');

    wrapper.unmount();
  });

  it('同时给出前缀与图标列表时按前缀的图标集渲染', /** 优先级写反会让业务传的候选列表覆盖整个图标集。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: {
        autoFetchApi: false,
        icons: [`${BASIC_PREFIX}:user`],
        prefix: BASIC_PREFIX,
      },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    expect(countIconButtons()).toBe(2);
    expect(readRenderedIconPaths()).toEqual(['M0 0h1v1h-1z', 'M1 0h1v1h-1z']);

    wrapper.unmount();
  });
});

describe('图标选择器搜索与分页', /** 过滤与分页决定用户能否在大图标集中找到目标图标。 */ () => {
  it('按关键词真实过滤图标', /** 过滤失效会让搜索结果仍是整包图标。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, prefix: BASIC_PREFIX },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    const search = needInPopover<HTMLInputElement>('.side-content input.mx-2');
    expect(search.placeholder).toBe('搜索图标...');

    await typeInto(search, 'home');
    await vi.waitFor(
      /** 等待防抖后的过滤结果真实落到列表上。 */ () => {
        expect(countIconButtons()).toBe(1);
      },
      { timeout: 3000 },
    );
    expect(readRenderedIconPaths()).toEqual(['M0 0h1v1h-1z']);

    await typeInto(search, 'not-exist');
    await vi.waitFor(
      /** 等待无结果时的空态真实渲染。 */ () => {
        expect(countIconButtons()).toBe(0);
      },
      { timeout: 3000 },
    );
    expect(document.body.textContent).toContain('暂无数据');

    wrapper.unmount();
  });

  it('图标数量超过一页时按真实分页切换', /** 分页失效会让用户看不到第一页之外的图标。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, pageSize: PAGE_SIZE, prefix: PAGE_PREFIX },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    expect(countIconButtons()).toBe(PAGE_SIZE);
    const firstPagePaths = readRenderedIconPaths();
    expect(firstPagePaths).toHaveLength(PAGE_SIZE);

    needSecondPageButton().click();
    await nextTick();

    await vi.waitFor(
      /** 等待第二页的真实切片渲染。 */ () => {
        expect(countIconButtons()).toBe(PAGE_ICONS.length - PAGE_SIZE);
      },
      { timeout: 3000 },
    );
    const secondPagePaths = readRenderedIconPaths();
    expect(secondPagePaths).toHaveLength(PAGE_ICONS.length - PAGE_SIZE);
    // 第二页必须是与第一页不同的一批图标，而不是同一页重复渲染。
    expect(secondPagePaths).not.toEqual(
      firstPagePaths.slice(0, secondPagePaths.length),
    );

    wrapper.unmount();
  });

  it('页数较多时折叠中间页并保留首尾页码', /** 省略号分支失效会让分页把几十个页码一次性铺开。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, pageSize: PAGE_SIZE, prefix: MANY_PREFIX },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    const totalPages = MANY_ICONS.length / PAGE_SIZE;
    const pageButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('.side-content button'),
    ].filter(
      /** 只统计页码按钮，排除首尾与前后翻页按钮。 */ (button) =>
        /^\d+$/.test(button.textContent?.trim() ?? ''),
    );
    expect(pageButtons.length).toBeLessThan(totalPages);
    expect(
      document.querySelector('.side-content [data-type="ellipsis"]'),
    ).not.toBeNull();

    wrapper.unmount();
  });

  it('图标不足一页时不渲染分页', /** 负对照：不足一页仍渲染分页会让面板底部出现无效控件。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, pageSize: PAGE_SIZE, prefix: BASIC_PREFIX },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    expect(
      document.querySelector('.side-content [role="navigation"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain('上一页');

    wrapper.unmount();
  });
});

describe('图标选择器选择与开关', /** 选择结果与浮层开关是调用方唯一能观察到的出口。 */ () => {
  it('点击图标回写选中值、发出变更并关闭浮层', /** 不回写会让业务拿不到图标名，不关闭会让面板挡住后续操作。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, modelValue: '', prefix: BASIC_PREFIX },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    const firstIcon = needInPopover<HTMLButtonElement>('.grid button');
    firstIcon.click();
    await nextTick();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      `${BASIC_PREFIX}:home`,
    ]);
    expect(wrapper.emitted('change')?.at(-1)).toEqual([`${BASIC_PREFIX}:home`]);
    await waitForPopoverClosed();
    // 选择后入口必须显示选中的图标。
    expect(wrapper.get('.relative svg').attributes('class')).toContain(
      'size-6',
    );

    wrapper.unmount();
  });

  it('暴露的开关方法驱动浮层开合', /** 开关方法失效会让调用方无法在业务事件里打开选择面板。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, prefix: BASIC_PREFIX },
    });
    const exposed = exposedOf(wrapper);

    exposed.open();
    await waitForPopover();

    exposed.toggleOpenState();
    await waitForPopoverClosed();

    exposed.toggleOpenState();
    await waitForPopover();

    exposed.close();
    await waitForPopoverClosed();

    wrapper.unmount();
  });

  it('点击入口真实打开浮层并再次点击关闭', /** 入口点击不开会让用户无法打开选择面板。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, prefix: BASIC_PREFIX },
    });

    await wrapper.get('button').trigger('click');
    await waitForPopover();
    expect(countIconButtons()).toBe(2);

    await wrapper.get('button').trigger('click');
    await waitForPopoverClosed();

    wrapper.unmount();
  });

  it('在入口输入框直接输入图标名时回传选中值', /** 入口是可编辑组合框，输入拿不到值会让手输的图标名石沉大海。 */ async () => {
    const wrapper = mount(IconPicker, {
      props: { autoFetchApi: false, modelValue: '', prefix: BASIC_PREFIX },
    });

    const trigger = wrapper.get<HTMLInputElement>('input[role="combobox"]');
    expect(trigger.attributes('placeholder')).toBe('选择一个图标');

    await typeInto(trigger.element, `${BASIC_PREFIX}:user`);

    expect(wrapper.emitted('change')?.at(-1)).toEqual([`${BASIC_PREFIX}:user`]);
    // 入口右侧的预览图标必须跟随手输的图标名真实换图。
    expect(wrapper.get('.relative svg path').attributes('d')).toBe(
      'M1 0h1v1h-1z',
    );

    wrapper.unmount();
  });

  it('type 为 icon 时只渲染图标入口并透传属性', /** 入口形态写错会让图标选择器在表格里撑出输入框。 */ async () => {
    const wrapper = mount(IconPicker, {
      attrs: { 'data-probe': 'DUMMY-图标入口' },
      props: { autoFetchApi: false, prefix: BASIC_PREFIX, type: 'icon' },
    });

    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.get('svg').attributes('data-probe')).toBe('DUMMY-图标入口');

    wrapper.unmount();
  });
});

describe('图标选择器自定义输入组件', /** 自定义输入组件决定业务能否替换入口与搜索框的外观。 */ () => {
  it('自定义输入组件收到值、图标插槽与过滤属性', /** 值或插槽传错会让自定义入口显示不出当前图标与搜索框。 */ async () => {
    const forwarded = vi.fn();
    const wrapper = mount(IconPicker, {
      attrs: {
        'data-probe': 'DUMMY-属性',
        /** 记录组件真实转发给调用方的值更新。 */
        'onUpdate:value': forwarded,
      },
      props: {
        autoFetchApi: false,
        iconSlot: 'probe-icon',
        inputComponent: h(ProbeInput, { slotName: 'probe-icon' }),
        modelValueProp: 'value',
        prefix: BASIC_PREFIX,
      },
    });
    exposedOf(wrapper).open();
    await waitForPopover();

    // 入口本身不是浮层内容，它留在组件挂载的容器里，因此从包装器上读取。
    const trigger = wrapper.get('.probe-input[role="combobox"]');
    // 调用方属性必须透传，且值更新事件不能被重复绑定（否则回调会被调用两次）。
    expect(trigger.attributes('data-probe')).toBe('DUMMY-属性');
    expect(trigger.find('.probe-slot svg').exists()).toBe(true);
    expect(trigger.find('.probe-value').text()).toBe('');

    const triggerField = trigger.get<HTMLInputElement>('.probe-field');
    await typeInto(triggerField.element, `${BASIC_PREFIX}:user`);

    expect(forwarded).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveBeenCalledWith(`${BASIC_PREFIX}:user`);
    expect(wrapper.emitted('change')?.at(-1)).toEqual([`${BASIC_PREFIX}:user`]);
    expect(trigger.find('.probe-value').text()).toBe(`${BASIC_PREFIX}:user`);

    // 搜索框由同一组属性驱动，输入后必须真实过滤列表。
    const search = needInPopover<HTMLElement>('.probe-input.mx-2');
    expect(search.querySelector('.probe-value')?.textContent).toBe('');
    const searchField = needInPopover<HTMLInputElement>(
      '.probe-input.mx-2 .probe-field',
    );
    await typeInto(searchField, 'user');
    await vi.waitFor(
      /** 等待自定义搜索框的过滤结果真实落到列表上。 */ () => {
        expect(countIconButtons()).toBe(1);
      },
      { timeout: 3000 },
    );
    expect(readRenderedIconPaths()).toEqual(['M1 0h1v1h-1z']);

    wrapper.unmount();
  });
});
