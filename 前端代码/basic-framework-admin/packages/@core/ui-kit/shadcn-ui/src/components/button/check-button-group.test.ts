/**
 * 勾选按钮组（shadcn-ui 的 components/button/check-button-group）真实交互回归。
 *
 * 该组件是筛选与权限配置的选中入口：单选/多选判定写反会让用户一次选中多项或点不动第二项，
 * 换行清除与数量上限算错会让选中集合丢失或超出业务允许的条数，变更前置回调未按加载态收口
 * 会让用户在异步校验期间重复点击并拿到互相覆盖的取值。用例真实挂载组件，点击真实按钮并断言
 * 真实抛出的取值、按钮禁用状态与图标渲染结果，只把异步校验的兑现时机交给用例控制。
 */
import type { CustomRenderType, ValueType } from './button';

import { flushPromises, mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { Circle, CircleCheckBig, LoaderCircle } from '@vben-core/icons';

import { describe, expect, it, vi } from 'vitest';

import VbenButton from './button.vue';
import CheckButtonGroup from './check-button-group.vue';

/** 图标插槽参数：只声明用例真正读取的两个状态字段。 */
type IconSlotProps = {
  /** 该项当前是否已被选中。 */
  checked: boolean;
  /** 该项是否正在等待异步校验结果。 */
  loading: boolean;
};

/** 选项插槽参数：只声明用例真正读取的标签、取值与原始选项。 */
type OptionSlotProps = {
  /** 原始选项对象，业务可读取自定义字段。 */
  data: { value: ValueType };
  /** 选项显示文案；组件透传的是字符串或渲染函数，与选项声明的类型保持一致。 */
  label: CustomRenderType;
  /** 选项取值。 */
  value: ValueType;
};

/** 异步校验结果的放行函数：调用它即模拟业务校验结束。 */
type ReleaseCheck = (value: boolean) => void;

/** 三个可选项，覆盖选中、换选与数量上限所需的条目数。 */
const options = [
  { label: '选项甲', value: 'alpha' },
  { label: '选项乙', value: 'beta' },
  { label: '选项丙', value: 'gamma' },
];

/**
 * 建立一个可手动兑现的异步校验结果。
 * @returns 结果 Promise 与放行函数；调用放行函数即模拟业务校验结束。
 */
function createPendingCheck() {
  /** 占位实现，构造时立即被真实 resolve 覆盖。 */
  let release: ReleaseCheck = () => {};
  const promise = new Promise<boolean>(
    /** 捕获真实 resolve，供用例在断言加载态之后放行。 */ (resolve) => {
      release = resolve;
    },
  );
  return { promise, release };
}

/**
 * 读取按钮组当前的选中值集合。
 * @param wrapper 已挂载的按钮组包装器。
 * @returns 按钮的 variant 为默认态（即选中）的取值数组。
 */
function readCheckedValues(wrapper: ReturnType<typeof mount>) {
  const checked: ValueType[] = [];
  wrapper.findAllComponents(VbenButton).forEach(
    /** 按按钮顺序与选项声明一一对应，收集处于默认态的取值。 */ (
      button,
      index,
    ) => {
      const option = options[index];
      if (option && button.props('variant') === 'default') {
        checked.push(option.value);
      }
    },
  );
  return checked;
}

describe('单选模式选中与换选', /** 单选判定写错会让筛选条件同时命中多项。 */ () => {
  it('点击按钮抛出选中取值并标记为选中态', /** 取值未回写会让页面条件与用户点击不一致。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { options },
    });

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')).toEqual([['beta']]);
    expect(wrapper.emitted('btnClick')).toEqual([['beta']]);
    expect(readCheckedValues(wrapper)).toEqual(['beta']);

    wrapper.unmount();
  });

  it('再次点击其它按钮时替换原选中项', /** 单选模式下累加选中会让条件集合越点越多。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: 'alpha', options },
    });

    await wrapper.findAll('button')[2]?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')).toEqual([['gamma']]);
    expect(readCheckedValues(wrapper)).toEqual(['gamma']);

    wrapper.unmount();
  });
});

describe('单选模式允许清除', /** 清除开关决定用户能否取消已选条件，失效会让筛选无法回到全部。 */ () => {
  it('开启清除时再次点击已选项取消选中', /** 无法取消会让用户被困在单一筛选条件里。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { allowClear: true, modelValue: 'beta', options },
    });

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')).toEqual([[undefined]]);
    expect(wrapper.emitted('btnClick')).toEqual([[undefined]]);
    expect(readCheckedValues(wrapper)).toEqual([]);

    wrapper.unmount();
  });

  it('未开启清除时再次点击已选项保持选中', /** 负对照：未声明清除能力时不得把选中项清空。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: 'beta', options },
    });

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    // 取值未变化时双向绑定不会重复回写，避免父组件收到同值更新；点击事件仍然照常抛出。
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('btnClick')).toEqual([['beta']]);
    expect(readCheckedValues(wrapper)).toEqual(['beta']);

    wrapper.unmount();
  });
});

describe('多选模式与数量上限', /** 多选集合与上限决定一次能提交多少条配置，算错会丢选中项或超限。 */ () => {
  it('多选模式下逐项累加并支持取消选中', /** 多选判定失效会让用户只能选中一个条件。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { multiple: true, options },
    });

    await wrapper.findAll('button')[0]?.trigger('click');
    await flushPromises();
    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      ['alpha', 'beta'],
    ]);
    expect(readCheckedValues(wrapper)).toEqual(['alpha', 'beta']);

    await wrapper.findAll('button')[0]?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['beta']]);
    expect(readCheckedValues(wrapper)).toEqual(['beta']);

    wrapper.unmount();
  });

  it('达到数量上限时挤掉最早选中项', /** 上限未生效会让提交的配置条数超出后端允许范围。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { maxCount: 2, multiple: true, options },
    });

    await wrapper.findAll('button')[0]?.trigger('click');
    await flushPromises();
    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();
    await wrapper.findAll('button')[2]?.trigger('click');
    await flushPromises();

    // 上限只保留最早的 maxCount-1 项再追加新项，因此被挤掉的是中间那次选中。
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      ['alpha', 'gamma'],
    ]);
    expect(readCheckedValues(wrapper)).toEqual(['alpha', 'gamma']);

    wrapper.unmount();
  });
});

describe('变更前置校验与加载态', /** 异步校验期间必须锁定按钮，否则用户重复点击会拿到互相覆盖的取值。 */ () => {
  it('校验未放行时按钮进入加载禁用态且不改变取值', /** 未锁定会让用户在服务端校验期间连点，产生重复请求。 */ async () => {
    const pending = createPendingCheck();
    const beforeChange = vi.fn(
      /** 模拟异步权限校验：先挂起，由用例后续放行。 */ () => pending.promise,
    );
    const wrapper = mount(CheckButtonGroup, {
      props: { beforeChange, options },
    });

    await wrapper.findAll('button')[0]?.trigger('click');
    await nextTick();

    expect(beforeChange).toHaveBeenCalledWith('alpha', true);
    expect(wrapper.findAllComponents(LoaderCircle)).toHaveLength(1);
    expect(
      wrapper
        .findAll('button')
        .every(
          /** 加载期间所有按钮都必须带禁用属性。 */ (button) =>
            button.attributes('disabled') !== undefined,
        ),
    ).toBe(true);

    pending.release(false);
    await flushPromises();
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(readCheckedValues(wrapper)).toEqual([]);
    expect(wrapper.findAllComponents(LoaderCircle)).toHaveLength(0);

    wrapper.unmount();
  });

  it('校验放行后写入取值并恢复按钮可用状态', /** 校验通过未写入会让用户点了按钮却没有任何变化。 */ async () => {
    const pending = createPendingCheck();
    const wrapper = mount(CheckButtonGroup, {
      props: {
        /** 异步校验放行后返回 true，允许本次选中。 */
        beforeChange: /** 返回待兑现的校验结果。 */ () => pending.promise,
        options,
      },
    });

    await wrapper.findAll('button')[2]?.trigger('click');
    await nextTick();
    pending.release(true);
    await flushPromises();
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toEqual([['gamma']]);
    expect(readCheckedValues(wrapper)).toEqual(['gamma']);
    expect(wrapper.findAllComponents(LoaderCircle)).toHaveLength(0);
    expect(
      wrapper
        .findAll('button')
        .every(
          /** 校验结束后按钮必须恢复可点击。 */ (button) =>
            button.attributes('disabled') === undefined,
        ),
    ).toBe(true);

    wrapper.unmount();
  });

  it('同步返回通过时按选中态渲染勾选图标', /** 校验通过但未标记选中会让用户看不出哪一项已生效。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: {
        /** 同步放行，模拟无需等待的本地校验。 */
        beforeChange: /** 直接放行本次选中。 */ () => true,
        options,
      },
    });

    await wrapper.findAll('button')[0]?.trigger('click');
    await flushPromises();

    expect(wrapper.findAllComponents(CircleCheckBig)).toHaveLength(1);
    expect(wrapper.findAllComponents(Circle)).toHaveLength(2);

    wrapper.unmount();
  });
});

describe('图标与内容插槽', /** 插槽决定按钮内的图标与文案，未透传状态会让业务无法自定义选中样式。 */ () => {
  it('自定义图标插槽收到加载态与选中态', /** 缺少状态透传会让自定义图标无法区分选中与加载。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: 'alpha', options },
      slots: {
        /** 按插槽状态渲染可断言文本。 */
        icon: (slotProps: IconSlotProps) =>
          h(
            'span',
            { class: 'probe-icon' },
            `${String(slotProps.loading)}-${String(slotProps.checked)}`,
          ),
      },
    });

    const icons = wrapper.findAll('.probe-icon');
    expect(icons[0]?.text()).toBe('false-true');
    expect(icons[1]?.text()).toBe('false-false');

    wrapper.unmount();
  });

  it('自定义选项插槽收到标签、取值与原始选项', /** 选项数据未透传会让业务无法按权限标识渲染禁用提示。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { options },
      slots: {
        /** 把选项元数据渲染成可断言文本。 */
        option: (slotProps: OptionSlotProps) =>
          h(
            'span',
            { class: 'probe-option' },
            `${String(slotProps.label)}:${String(slotProps.value)}:${String(slotProps.data.value)}`,
          ),
      },
    });

    expect(
      wrapper
        .findAll('.probe-option')
        .map(/** 收集每个选项插槽渲染出的真实文案。 */ (node) => node.text()),
    ).toEqual(['选项甲:alpha:alpha', '选项乙:beta:beta', '选项丙:gamma:gamma']);

    wrapper.unmount();
  });

  it('关闭图标时只渲染文案', /** 关闭图标仍渲染占位会破坏紧凑排版的间距。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { options, showIcon: false },
    });

    expect(wrapper.find('.icon-wrapper').exists()).toBe(false);
    expect(wrapper.text()).toContain('选项甲');

    wrapper.unmount();
  });

  it('默认按标签渲染按钮文案', /** 标签未渲染会让按钮变成空白方块。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { options },
    });

    expect(
      wrapper
        .findAllComponents(VbenButton)
        .map(/** 收集每个按钮的真实文案。 */ (button) => button.text()),
    ).toEqual(['选项甲', '选项乙', '选项丙']);

    wrapper.unmount();
  });
});

describe('初始取值解析与模式切换', /** 初始值形状决定进入页面时哪些条件保持选中，解析错会让筛选条件丢失。 */ () => {
  it('数组初始值在单选模式下只取第一项', /** 单选模式拿到整个数组会让页面显示多个选中项。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: ['alpha', 'beta'], options },
    });

    expect(readCheckedValues(wrapper)).toEqual(['alpha']);

    wrapper.unmount();
  });

  it('数组初始值在多选模式下全部保留', /** 多选模式只取第一项会让业务预置的条件被丢弃。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: ['alpha', 'beta'], multiple: true, options },
    });

    expect(readCheckedValues(wrapper)).toEqual(['alpha', 'beta']);

    wrapper.unmount();
  });

  it('数组中的空洞值被忽略', /** 未过滤空洞会让组件把 undefined 当作一个真实取值。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: {
        modelValue: [undefined, 'gamma'] as unknown as ValueType[],
        multiple: true,
        options,
      },
    });

    expect(readCheckedValues(wrapper)).toEqual(['gamma']);

    wrapper.unmount();
  });

  it('空数组初始值不选中任何按钮', /** 空数组被当成有效取值会让页面默认选中第一项。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: [], multiple: true, options },
    });

    expect(readCheckedValues(wrapper)).toEqual([]);

    wrapper.unmount();
  });

  it('未传初始值时保持未选中', /** 未传值却默认选中会让用户以为条件已生效。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { options },
    });

    expect(readCheckedValues(wrapper)).toEqual([]);

    wrapper.unmount();
  });

  it('切换为多选模式时把当前选中项升级为数组', /** 切换模式未重写取值会让父组件的单选值丢失。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: 'alpha', options },
    });

    await wrapper.setProps({ multiple: true });
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toEqual([[['alpha']]]);

    wrapper.unmount();
  });

  it('切回单选模式时把数组降级为首项', /** 切换模式未降级会让父组件收到数组而校验失败。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: ['alpha', 'beta'], multiple: true, options },
    });

    await wrapper.setProps({ multiple: false });
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toEqual([['alpha']]);

    wrapper.unmount();
  });

  it('切回单选模式且无选中项时回写空值', /** 未回写空值会让父组件继续持有已取消的旧数组。 */ async () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { modelValue: [], multiple: true, options },
    });

    await wrapper.setProps({ multiple: false });
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toEqual([[undefined]]);

    wrapper.unmount();
  });
});

describe('按钮组整体禁用', /** 禁用属性漏传会让只读场景下的条件仍可被修改。 */ () => {
  it('禁用时所有按钮不可点击', /** 禁用失效会让用户改出与权限不符的筛选条件。 */ () => {
    const wrapper = mount(CheckButtonGroup, {
      props: { disabled: true, options },
    });

    expect(
      wrapper
        .findAll('button')
        .every(
          /** 每个按钮都必须带禁用属性。 */ (button) =>
            button.attributes('disabled') !== undefined,
        ),
    ).toBe(true);

    wrapper.unmount();
  });
});
