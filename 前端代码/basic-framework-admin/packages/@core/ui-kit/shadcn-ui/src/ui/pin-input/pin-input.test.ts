/**
 * 验证码输入（shadcn-ui 的 ui/pin-input）结构与输入回归。
 *
 * 验证码输入由根节点、分组、单格输入与分隔符组成：单格必须按索引渲染并回填对应字符，输入
 * 必须抛出完整验证码，分隔符默认渲染圆点。结构或绑定写错会让用户输入的验证码错位或丢失。
 * 用例真实挂载 reka-ui 的验证码根节点，读取真实输入值与双向绑定事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import PinInput from './PinInput.vue';
import PinInputGroup from './PinInputGroup.vue';
import PinInputInput from './PinInputInput.vue';
import PinInputSeparator from './PinInputSeparator.vue';

/**
 * 挂载验证码输入。
 * @param modelValue 当前验证码。
 * @param values 记录双向绑定更新的数组。
 * @returns 已挂载的验证码输入包装器。
 */
function mountPinInput(modelValue: string[] = [], values: unknown[] = []) {
  return mount(
    h(
      PinInput,
      {
        class: 'custom-pin',
        modelValue,
        /** 记录取值更新。 */
        'onUpdate:modelValue': (value: unknown) => {
          values.push(value);
        },
      },
      {
        /** 渲染两个分组与分隔符。 */
        default: () => [
          h(
            PinInputGroup,
            { class: 'custom-group' },
            {
              /** 渲染前三格。 */
              default: () =>
                [0, 1, 2].map(
                  /** 按索引渲染单格输入。 */ (index) =>
                    h(PinInputInput, { class: 'custom-input', index }),
                ),
            },
          ),
          h(PinInputSeparator, { class: 'custom-separator' }),
          h(
            PinInputGroup,
            {},
            {
              /** 渲染最后一格。 */
              default: () => h(PinInputInput, { index: 3 }),
            },
          ),
        ],
      },
    ),
  );
}

describe('验证码输入结构', /** 单格数量与分隔符决定用户能否按位输入。 */ () => {
  it('按索引渲染单格输入并合并调用方 class', /** 单格缺失会让验证码位数不足。 */ async () => {
    const wrapper = mountPinInput();
    await nextTick();

    // reka-ui 额外渲染一个隐藏输入用于表单提交，这里只核对可按位输入的四格。
    const inputs = wrapper.findAll('.custom-input');
    expect(inputs).toHaveLength(3);
    expect(wrapper.findAll('input')).toHaveLength(5);
    expect(inputs[0]?.classes()).toContain('custom-input');
    expect(inputs[0]?.classes()).toContain('text-center');
    expect(inputs[0]?.attributes('type')).toBe('text');
    expect(wrapper.find('.custom-group').classes()).toContain('flex');
    expect(wrapper.classes()).toContain('custom-pin');
    expect(wrapper.classes()).toContain('gap-2');
  });

  it('回填验证码到对应单格', /** 未回填会让编辑场景显示空白。 */ async () => {
    const wrapper = mountPinInput(['1', '2', '3', '4']);
    await nextTick();

    expect(
      wrapper
        .findAll('input')
        .map(
          /** 读取每格当前字符。 */ (input) =>
            (input.element as HTMLInputElement).value,
        ),
    ).toEqual(['1', '2', '3', '4', '1234']);
  });

  it('分隔符默认渲染圆点并支持自定义内容', /** 分隔符缺失会让分组不易辨认。 */ async () => {
    const wrapper = mountPinInput(['1', '2', '3', '4']);
    await nextTick();

    expect(wrapper.find('.custom-separator').find('svg').exists()).toBe(true);

    const custom = mount(
      h(
        PinInput,
        { modelValue: ['1', '2'] },
        {
          /** 渲染自定义分隔符。 */
          default: () =>
            h(
              PinInputSeparator,
              {},
              {
                /** 自定义分隔符文案。 */
                default: () => '-',
              },
            ),
        },
      ),
    );
    await nextTick();
    expect(custom.text()).toBe('-');
  });
});

describe('验证码输入绑定', /** 输入丢失会让用户无法完成验证。 */ () => {
  it('输入字符后抛出完整验证码', /** 只抛单格字符会让父组件拿不到完整验证码。 */ async () => {
    const values: unknown[] = [];
    const wrapper = mountPinInput([], values);
    await nextTick();

    const first = wrapper.findAll('.custom-input')[0];
    if (!first) {
      throw new Error('验证码输入未渲染单格');
    }
    await first.setValue('7');
    await nextTick();

    expect(values).toEqual([['7']]);
  });
});
