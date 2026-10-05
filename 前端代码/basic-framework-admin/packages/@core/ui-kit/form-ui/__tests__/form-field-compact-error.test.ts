/**
 * 表单项紧凑模式错误提示（form-ui 的 form-render/form-field.vue）真实交互回归。
 *
 * 搜索区与弹窗内的紧凑表单没有整行错误文案的位置，必须把错误收进警告图标的气泡里：错误图标
 * 未渲染会让用户完全看不到校验失败原因，气泡未真正承载错误信息会让提示点了没有内容，字段说明
 * 漏渲染会让业务丢失补充解释。用例用真实创建入口建立紧凑表单，跑真实校验产生错误，再悬停真实
 * 警告图标读取传送后的提示内容。
 */
import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { defineRule } from 'vee-validate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVbenForm } from '../src/use-form';

// 必填规则返回失败文案，用于确认错误提示里出现的是规则给出的真实信息。
defineRule(
  'required',
  /** 必填规则：空值返回失败文案，否则通过。 */ (value: unknown) =>
    value ? true : 'DUMMY-必填提示',
);

/** 探针控件：把表单项透传的属性真实落到原生输入框，便于定位字段节点。 */
const TextProbe = defineComponent({
  name: 'CompactTextProbe',
  inheritAttrs: false,
  /**
   * 渲染原生输入框并透传全部控件属性。
   * @param _props 未声明的控件属性。
   * @param context 组件上下文，用于读取表单项透传的属性。
   * @param context.attrs 表单项透传的控件属性。
   * @returns 渲染输入元素的渲染函数。
   */
  setup(_props, { attrs }) {
    return /** 把控件属性真实落到输入框。 */ () =>
      h('input', { ...attrs, 'data-test': 'compact-probe' });
  },
});

/** 本文件已挂载的组件包装器，用例结束后统一卸载以清理提示气泡与校验副作用。 */
const mountedWrappers: ReturnType<typeof mount>[] = [];

afterEach(
  /** 卸载本文件挂载的全部表单并清理传送节点，避免残留影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  },
);

/**
 * 挂载紧凑表单并触发一次真实校验，得到带错误的表单项。
 * @returns 表单操作实例与已挂载的组件包装器。
 */
async function mountInvalidCompactField() {
  const [FormComponent, formApi] = useVbenForm({
    compact: true,
    schema: [
      {
        component: TextProbe,
        description: 'DUMMY-字段说明',
        fieldName: 'name',
        label: '名称',
        rules: 'required',
      },
    ],
  } as Parameters<typeof useVbenForm>[0]);
  const wrapper = mount(FormComponent as Component);
  mountedWrappers.push(wrapper);
  await flushPromises();
  await flushPromises();

  // 真实跑一次校验，让字段进入错误态。
  await expect(formApi.validate()).resolves.toMatchObject({ valid: false });
  await flushPromises();
  await wrapper.vm.$nextTick();

  return { formApi, wrapper };
}

describe('紧凑表单项错误态', /** 紧凑表单的错误入口决定用户能否发现校验失败，漏渲染会让提交失败且毫无提示。 */ () => {
  it('校验失败时标记错误态并渲染警告图标', /** 错误态或警告图标缺失会让空提交没有任何可见反馈。 */ async () => {
    const { wrapper } = await mountInvalidCompactField();

    expect(wrapper.find('[data-test="compact-probe"]').exists()).toBe(true);
    expect(wrapper.find('.form-valid-error').exists()).toBe(true);
    expect(wrapper.find('.lucide-circle-alert').exists()).toBe(true);
  });

  it('悬停警告图标时在气泡里渲染真实错误信息', /** 错误信息未落到气泡会让用户看不到失败原因。 */ async () => {
    const { wrapper } = await mountInvalidCompactField();

    await wrapper.find('.lucide-circle-alert').trigger('pointermove');

    await vi.waitFor(
      /** 等待提示气泡真实渲染出规则给出的错误文案。 */ () => {
        expect(document.body.textContent).toContain('DUMMY-必填提示');
      },
      { timeout: 2000 },
    );
  });

  it('渲染字段说明文案', /** 说明漏渲染会让用户不知道字段的填写口径。 */ async () => {
    const { wrapper } = await mountInvalidCompactField();

    expect(wrapper.text()).toContain('DUMMY-字段说明');
  });

  it('紧凑模式不渲染整行错误文案占位', /** 负对照：紧凑模式仍占一行错误位会让表单高度抖动。 */ async () => {
    const { wrapper } = await mountInvalidCompactField();

    expect(wrapper.find('.slide-up-enter-from').exists()).toBe(false);
    expect(wrapper.find('.form-valid-error').exists()).toBe(true);
  });
});

describe('非紧凑表单项错误态', /** 常规业务表单要在字段下方直接给出错误文案，缺少会让用户必须悬停才能看到原因。 */ () => {
  it('非紧凑模式渲染整行错误文案', /** 整行错误文案缺失会让常规表单的校验失败无从解释。 */ async () => {
    const [FormComponent, formApi] = useVbenForm({
      schema: [
        {
          component: TextProbe,
          fieldName: 'plain',
          label: '普通字段',
          rules: 'required',
        },
      ],
    } as Parameters<typeof useVbenForm>[0]);
    const wrapper = mount(FormComponent as Component);
    mountedWrappers.push(wrapper);
    await flushPromises();
    await flushPromises();
    await expect(formApi.validate()).resolves.toMatchObject({ valid: false });
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.form-valid-error').exists()).toBe(true);
    // 非紧凑模式没有警告气泡图标，错误文案直接渲染在字段下方。
    expect(wrapper.find('.lucide-circle-alert').exists()).toBe(false);
    expect(wrapper.text()).toContain('DUMMY-必填提示');
  });
});
