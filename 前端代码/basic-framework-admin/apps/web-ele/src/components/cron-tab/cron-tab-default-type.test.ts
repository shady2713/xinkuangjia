/**
 * cron 表达式生成器分区兜底档位（components/cron-tab）真实行为回归。
 *
 * 弹窗把七个分区的调度配置拼回表达式时，每个 `value_*` 计算属性都用 switch 分派档位，并为
 * 面板当前不认识的档位保留兜底取值（秒/分/时/日/月/周退回 `*`，年退回空串）。兜底写错会让
 * 面板在遇到未知档位时显示空白或拼出非法表达式，用户点确认后把坏表达式写回表单。用例挂载
 * 真实组件、真实打开生成器弹窗，把共享面板状态改成面板未实现的档位（模拟后续新增但尚未
 * 支持的类型），断言分区展示值与确认后真实回传的表达式。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { CronValue } from './types';

import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import CronTab from './cron-tab.vue';
import { CronValueDefault } from './types';

/** 生成器下拉里“自定义”入口的文案，点击后打开弹窗并解析当前表达式。 */
const CUSTOM_OPTION = '自定义';

/** 面板分区顺序：秒、分、时、日、月、周、年，与弹窗标签页一致。 */
const SECTION_COUNT = 7;

/** 面板当前未实现的档位取值，用于驱动每个分区的兜底分支。 */
const UNKNOWN_TYPE = '9';

/**
 * 面板共享状态。
 *
 * 组件的 `cronValue` 是 `reactive(CronValueDefault)`；Vue 对同一目标对象返回同一个代理，
 * 因此这里取到的就是组件正在使用的响应式状态，改写它会真实触发渲染与分区侦听器。
 */
const panelState = reactive<CronValue>(CronValueDefault);

/** 已挂载的组件包装器；用例结束后统一卸载，避免弹窗 DOM 影响后续断言。 */
const mountedWrappers: VueWrapper[] = [];

afterEach(
  /** 卸载本用例挂载的组件并清空弹窗 DOM。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
  },
);

/**
 * 打开“生成器”下拉并点击指定候选项。
 * @param wrapper 已挂载的组件包装器。
 * @param optionText 候选项文案。
 * @throws Error 下拉没有渲染出目标候选项时抛出，避免用例静默地什么都不验证。
 */
async function clickGeneratorOption(wrapper: VueWrapper, optionText: string) {
  await wrapper.find('.el-select__wrapper').trigger('click');
  await flushPromises();
  const option = [
    ...document.querySelectorAll('.el-select-dropdown__item'),
  ].find(
    /** 按文案定位目标候选项。 */ (item) =>
      item.textContent?.trim() === optionText,
  );
  if (!option) {
    throw new Error(`生成器下拉没有候选项：${optionText}`);
  }
  option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
  await nextTick();
}

/**
 * 读取弹窗里七个分区当前展示的调度值。
 * @returns 秒到年的展示值数组。
 * @throws Error 面板没有渲染出七个分区时抛出，避免用例在空节点上静默通过。
 */
function readSectionValues(): string[] {
  const values = [...document.querySelectorAll('.sc-cron-num h4')].map(
    /** 读取单个分区标签里的展示值。 */ (label) =>
      label.textContent?.trim() ?? '',
  );
  if (values.length !== SECTION_COUNT) {
    throw new Error(`弹窗未渲染出七个分区，实际为 ${values.length} 个`);
  }
  return values;
}

/**
 * 点击弹窗底部按钮。
 * @param label 按钮文案，比较时忽略中间空白。
 * @throws Error 弹窗底部没有该文案的按钮时抛出，避免用例静默地什么都不验证。
 */
async function clickFooterButton(label: string) {
  const buttons = [
    ...document.querySelectorAll<HTMLElement>('.el-dialog__footer button'),
  ];
  const target = buttons.find(
    /** 按去掉空白后的文案定位底部按钮。 */ (button) =>
      (button.textContent ?? '').replaceAll(/\s/gu, '') === label,
  );
  if (!target) {
    throw new Error(`弹窗底部没有按钮：${label}`);
  }
  target.click();
  await flushPromises();
}

/**
 * 把某个分区的档位改写成面板未实现的取值。
 *
 * 面板档位是设计期约定的字符串字面量，这里模拟“后续新增但当前未实现”的取值，
 * 用于验证每个 `value_*` 的兜底分支而不是绕过它们。
 * @param part 目标分区名。
 */
function setUnknownType(part: keyof CronValue) {
  (panelState[part] as { type: string }).type = UNKNOWN_TYPE;
}

describe('分区档位越出已知取值时的兜底', /** 兜底取值决定未知档位下表达式是否仍然合法。 */ () => {
  it('未知档位按兜底值展示并在确认后拼回表达式', /** 兜底写错会让面板显示空白或把非法表达式写回表单。 */ async () => {
    const wrapper = mount(CronTab, {
      attachTo: document.body,
      props: { modelValue: '* * * * * ?' },
    }) as VueWrapper;
    mountedWrappers.push(wrapper);
    // 打开生成器弹窗：set() 会按当前表达式重置七个分区的档位。
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);
    await nextTick();

    // 阶段一：五个没有联动约束的分区与「日」都改成未实现档位。
    // 「周」保持在“不指定”，这样改写「日」时对方的侦听器只会把它写回同一档位。
    for (const part of ['second', 'minute', 'hour', 'month', 'year'] as const) {
      setUnknownType(part);
    }
    setUnknownType('day');
    await nextTick();

    expect(readSectionValues()).toEqual(['*', '*', '*', '*', '*', '?', '']);

    // 阶段二：再把「周」改成未实现档位；日与周的互斥侦听器会把「日」收回“不指定”。
    setUnknownType('week');
    await nextTick();

    expect(readSectionValues()).toEqual(['*', '*', '*', '?', '*', '*', '']);

    await clickFooterButton('确认');

    // 确认后回传的表达式必须用兜底值拼装：日被互斥规则收回“不指定”，年不参与拼接。
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      '* * * ? * *',
    ]);
  });
});
