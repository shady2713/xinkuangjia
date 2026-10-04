/**
 * cron 表达式生成器（apps/web-ele/src/components/cron-tab）真实行为回归。
 *
 * 该组件是任务表单的 CRON 表达式编辑器：输入框右侧的“生成器”下拉把预设表达式写入输入框，
 * 选“自定义”时打开弹窗，`set()` 把表达式拆成秒/分/时/日/月/周/年七个分区的调度配置，
 * 面板上的类型单选与范围/间隔/指定控件再通过 `value_*` 计算属性把配置拼回表达式，点“确认”
 * 后经 `update:modelValue` 交回调用方。解析或拼装口径写错时，用户在面板上只改一处却会把
 * 别的字段改坏；日与周互斥口径失效会让同时填写的两个字段被静默丢掉一个。
 *
 * 面板状态来自模块级 `CronValueDefault`（`reactive` 直接包住该对象，实例之间共享），因此
 * 每个用例先用 {@link resetPanelState} 把该共享对象复位到同一份已知档位，再断言各自的契约，
 * 避免用例之间互相影响。用例真实渲染组件、真实点击下拉与单选、真实执行子控件声明的
 * v-model 契约。
 */

import type { VueWrapper } from '@vue/test-utils';

import type { CronValue } from './types';

import { flushPromises, mount } from '@vue/test-utils';

import { ElDialog, ElInputNumber, ElSelect } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CronTab from './cron-tab.vue';
import { CronValueDefault } from './types';

/** 生成器下拉里“自定义”入口的文案，点击后打开弹窗。 */
const CUSTOM_OPTION = '自定义';

/** 生成器下拉里“每分钟”预设的文案，用于把下拉模型移出“自定义”。 */
const PRESET_OPTION = '每分钟';

/** 弹窗里的时间单位分区顺序，与模板标签页一致。 */
const SECTION_NAMES = ['秒', '分钟', '小时', '日', '月', '周', '年'];

/**
 * 面板基线档位：七个分区的类型与子档位，作为每个用例的已知起点。
 * 类型收敛到“日与周都不指定”，其余为任意值、年忽略，子档位与下面用例的断言一一对应。
 */
const PANEL_STATE: CronValue = {
  second: {
    type: '0',
    range: { start: 1, end: 2 },
    loop: { start: 0, end: 2 },
    appoint: ['5', '10'],
  },
  minute: {
    type: '0',
    range: { start: 3, end: 4 },
    loop: { start: 1, end: 3 },
    appoint: ['15', '20'],
  },
  hour: {
    type: '0',
    range: { start: 5, end: 6 },
    loop: { start: 2, end: 4 },
    appoint: ['25', '30'],
  },
  day: {
    type: '5',
    range: { start: 7, end: 8 },
    loop: { start: 3, end: 5 },
    appoint: ['1', '3'],
  },
  month: {
    type: '0',
    range: { start: 9, end: 10 },
    loop: { start: 4, end: 6 },
    appoint: ['1', '3'],
  },
  week: {
    type: '5',
    range: { start: '2', end: '3' },
    loop: { start: 2, end: '5' },
    appoint: ['1', '3'],
    last: '4',
  },
  year: {
    type: '-1',
    range: { start: 2020, end: 2030 },
    loop: { start: 5, end: 2020 },
    appoint: ['2020', '2021'],
  },
};

/** 单个分区的类型切换预期：分区下标与应展示的调度值。 */
interface SectionExpectation {
  /** 分区下标，0 为秒、6 为年。 */
  index: number;
  /** 面板上该分区应展示的调度值。 */
  value: string;
}

/** 表达式往返夹具：解析后应展示的分区值与再次提交应得到的表达式。 */
interface RoundTripCase {
  /** 用例名，用表达式与提交结果拼出便于定位。 */
  name: string;
  /** 初始交给组件的 CRON 表达式。 */
  modelValue: string;
  /** 打开生成器后七个分区应展示的值，顺序与 SECTION_NAMES 一致。 */
  sections: string[];
  /** 点击确认后应提交给调用方的表达式。 */
  submitted: string;
}

/** 挂载选项：是否保留真实过渡，决定关闭动画链路是否执行。 */
interface MountOptions {
  /** 快捷表达式列表。 */
  shortcuts?: { text: string; value: string }[];
  /** 是否关闭 @vue/test-utils 的过渡桩，弹窗关闭回调依赖真实过渡。 */
  realTransition?: boolean;
}

/** 已挂载的组件包装器；用例结束后统一卸载，避免弹窗 DOM 影响后续断言。 */
const mountedWrappers: VueWrapper[] = [];

/**
 * 挂载生成器组件并等待首次渲染完成。
 * @param modelValue 交给组件的初始 CRON 表达式。
 * @param options 挂载选项，含快捷表达式与是否保留真实过渡。
 * @returns 已挂载的组件包装器。
 */
async function mountCronTab(modelValue: string, options: MountOptions = {}) {
  const wrapper = mount(CronTab, {
    attachTo: document.body,
    global: options.realTransition
      ? { stubs: { transition: false, 'transition-group': false } }
      : {},
    props: { modelValue, shortcuts: options.shortcuts ?? [] },
  }) as VueWrapper;
  mountedWrappers.push(wrapper);
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 读取弹窗里七个分区当前展示的调度值。
 * @returns 秒到年的展示值数组；面板未渲染时元素个数不足。
 */
function readSectionValues(): string[] {
  return [...document.querySelectorAll('.sc-cron-num h4')].map(
    /** 读取单个分区标签里的展示值。 */ (label) =>
      label.textContent?.trim() ?? '',
  );
}

/**
 * 读取弹窗里七个分区必须存在的展示值。
 * @returns 秒到年的展示值数组。
 * @throws Error 面板没有渲染出七个分区时抛出，避免用例静默地什么都不验证。
 */
function requireSectionValues(): string[] {
  const values = readSectionValues();
  if (values.length !== SECTION_NAMES.length) {
    throw new Error(`弹窗未渲染出七个分区，实际为 ${values.length} 个`);
  }
  return values;
}

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
  await wrapper.vm.$nextTick();
}

/**
 * 复位模块级共享的面板状态，使每个用例都从 PANEL_STATE 的已知档位开始。
 *
 * 组件的 `cronValue` 是 `reactive(CronValueDefault)`，直接改写该模块级对象即可复位；
 * 复位走原始对象、不经过响应式代理，因此不会触发上一个用例遗留组件的侦听器。
 */
function resetPanelState() {
  Object.assign(CronValueDefault, structuredClone(PANEL_STATE));
}

/**
 * 点击弹窗底部按钮。
 * @param label 按钮文案，忽略中间空白。
 * @returns 点击与状态更新完成。
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
 * 点击指定分区里的类型单选按钮。
 * @param sectionIndex 分区下标，0 为秒、6 为年。
 * @param type 单选按钮对应的调度类型值。
 * @returns 点击与重渲染完成。
 * @throws Error 该分区没有目标类型单选按钮时抛出，避免用例静默地什么都不验证。
 */
async function clickTypeRadio(sectionIndex: number, type: string) {
  const pane = sectionPane(sectionIndex);
  const radio = pane.querySelector<HTMLInputElement>(
    `input.el-radio-button__original-radio[value="${type}"]`,
  );
  if (!radio) {
    throw new Error(`分区 ${sectionIndex} 没有类型为 ${type} 的单选按钮`);
  }
  radio.click();
  await flushPromises();
}

/**
 * 取出弹窗里指定分区的 DOM 节点。
 * @param sectionIndex 分区下标，0 为秒、6 为年。
 * @returns 该分区的标签页元素。
 * @throws Error 弹窗没有该分区时抛出，避免用例在空节点上静默通过。
 */
function sectionPane(sectionIndex: number): Element {
  const panes = document.querySelectorAll(
    '.sc-cron .el-tabs__content > .el-tab-pane',
  );
  const pane = panes[sectionIndex];
  if (!pane) {
    throw new Error(`弹窗没有第 ${sectionIndex} 个分区`);
  }
  return pane;
}

/**
 * 按 DOM 节点在组件树里定位子控件实例，避免下标随渲染分支漂移。
 * @param wrapper 已挂载的组件包装器。
 * @param element 目标子控件的根 DOM 节点。
 * @param name 控件类型名，用于失败信息。
 * @returns 与该 DOM 节点对应的组件包装器。
 * @throws Error 没有组件对应该节点时抛出，避免把断言落到别的控件上。
 */
function controlOf(wrapper: VueWrapper, element: Element, name: string) {
  const control = [
    ...wrapper.findAllComponents(ElInputNumber),
    ...wrapper.findAllComponents(ElSelect),
  ].find(
    /** 按根元素定位与 DOM 节点对应的组件实例。 */ (item) =>
      item.element === element,
  );
  if (!control) {
    throw new Error(`未找到 ${name} 对应的组件实例`);
  }
  return control;
}

/**
 * 取出指定分区里的第 n 个数字输入控件。
 * @param wrapper 已挂载的组件包装器。
 * @param sectionIndex 分区下标，0 为秒、6 为年。
 * @param index 该分区内数字输入控件的顺序下标。
 * @returns 该数字输入控件的包装器。
 * @throws Error 目标控件不存在时抛出，避免把断言落到别的控件上。
 */
function numberInputInSection(
  wrapper: VueWrapper,
  sectionIndex: number,
  index: number,
) {
  const element =
    sectionPane(sectionIndex).querySelectorAll('.el-input-number')[index];
  if (!element) {
    throw new Error(`分区 ${sectionIndex} 的第 ${index} 个数字输入控件不存在`);
  }
  return controlOf(wrapper, element, `分区 ${sectionIndex} 的数字输入控件`);
}

/**
 * 取出指定分区里的第 n 个下拉控件。
 * @param wrapper 已挂载的组件包装器。
 * @param sectionIndex 分区下标，0 为秒、6 为年。
 * @param index 该分区内下拉控件的顺序下标。
 * @returns 该下拉控件的包装器。
 * @throws Error 目标控件不存在时抛出，避免把断言落到别的控件上。
 */
function selectInSection(
  wrapper: VueWrapper,
  sectionIndex: number,
  index: number,
) {
  const element =
    sectionPane(sectionIndex).querySelectorAll('.el-select')[index];
  if (!element) {
    throw new Error(`分区 ${sectionIndex} 的第 ${index} 个下拉控件不存在`);
  }
  return controlOf(wrapper, element, `分区 ${sectionIndex} 的下拉控件`);
}

/**
 * 拼接面板展示值对应的表达式，口径与组件的提交规则一致。
 * @param sections 七个分区的展示值。
 * @returns 年为空时省略年字段的表达式。
 */
function joinSections(sections: string[]): string {
  const year = sections[6] ? ` ${sections[6]}` : '';
  return `${sections[0]} ${sections[1]} ${sections[2]} ${sections[3]} ${sections[4]} ${sections[5]}${year}`;
}

/**
 * 关闭并清空上一个用例留下的弹窗 DOM。
 */
function cleanupDom() {
  while (mountedWrappers.length > 0) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = '';
}

/**
 * 整理一条表达式往返夹具。
 * @param modelValue 初始表达式。
 * @param sections 七个分区的期望展示值。
 * @param submitted 期望提交的表达式。
 * @returns 补齐用例名的往返夹具。
 */
function roundTrip(
  modelValue: string,
  sections: string[],
  submitted: string,
): RoundTripCase {
  return {
    modelValue,
    name: `${modelValue} → ${submitted}`,
    sections,
    submitted,
  };
}

beforeEach(
  /** 复位共享面板状态，避免上一个用例的档位影响本用例的展示与提交值。 */ () => {
    resetPanelState();
  },
);

afterEach(
  /** 卸载组件并清空弹窗 DOM，避免残留节点影响后续用例。 */ () => {
    cleanupDom();
  },
);

describe('cron 生成器面板展示', /** 分区展示值与类型联动决定用户看到的调度口径。 */ () => {
  it('打开生成器后按表达式展示七个分区', /** 档位解析错误会让面板展示与输入框不一致。 */ async () => {
    const wrapper = await mountCronTab('0 0 0 L * ?');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);

    expect(requireSectionValues()).toEqual(['0', '0', '0', 'L', '*', '?', '']);
    expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(true);
  });

  it('七个分区的类型单选按各自口径刷新展示值', /** 类型切换写错会让面板展示别的分区的值。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ?');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);
    expect(requireSectionValues()).toEqual(['*', '*', '*', '*', '*', '?', '']);

    /** 各分区依次点击的类型值，顺序即点击顺序。 */
    const types = [
      ['1', '2', '3', '0'],
      ['1', '2', '3', '0'],
      ['1', '2', '3', '0'],
      ['1', '2', '3', '4', '5'],
      ['1', '2', '3', '0'],
      ['1', '2', '3', '4', '5', '0'],
      ['1', '0', '2', '3', '-1'],
    ];
    /** 各分区依次点击后应展示的值，与 types 一一对应。 */
    const sweep: SectionExpectation[][] = [
      [
        { index: 0, value: '1-2' },
        { index: 0, value: '0/2' },
        { index: 0, value: '5,10' },
        { index: 0, value: '*' },
      ],
      [
        { index: 1, value: '3-4' },
        { index: 1, value: '1/3' },
        { index: 1, value: '15,20' },
        { index: 1, value: '*' },
      ],
      [
        { index: 2, value: '5-6' },
        { index: 2, value: '2/4' },
        { index: 2, value: '25,30' },
        { index: 2, value: '*' },
      ],
      [
        { index: 3, value: '7-8' },
        { index: 3, value: '3/5' },
        { index: 3, value: '1,3' },
        { index: 3, value: 'L' },
        { index: 3, value: '?' },
      ],
      [
        { index: 4, value: '9-10' },
        { index: 4, value: '4/6' },
        { index: 4, value: '1,3' },
        { index: 4, value: '*' },
      ],
      [
        { index: 5, value: '2-3' },
        { index: 5, value: '5#2' },
        { index: 5, value: '1,3' },
        { index: 5, value: '4L' },
        { index: 5, value: '?' },
        { index: 5, value: '*' },
      ],
      [
        { index: 6, value: '2020-2030' },
        { index: 6, value: '*' },
        { index: 6, value: '5/2020' },
        { index: 6, value: '2020,2021' },
        { index: 6, value: '' },
      ],
    ];

    for (const [sectionIndex, sectionTypes] of types.entries()) {
      const expectations = sweep[sectionIndex] ?? [];
      expect(
        sectionTypes,
        `分区 ${SECTION_NAMES[sectionIndex]} 的类型与预期条数不一致`,
      ).toHaveLength(expectations.length);
      for (const [typeIndex, type] of sectionTypes.entries()) {
        await clickTypeRadio(sectionIndex, type);
        const values = requireSectionValues();
        expect(
          values[sectionIndex],
          `${SECTION_NAMES[sectionIndex]} 分区类型 ${type} 的展示值`,
        ).toBe(expectations[typeIndex]?.value);
      }
    }
  });

  it('切换日的类型会把已填写的周收敛为不指定', /** 日与周互斥口径失效会让表达式同时带上两个字段。 */ async () => {
    const wrapper = await mountCronTab('* * * ? * 1-2');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);
    expect(requireSectionValues()[5]).toBe('1-2');

    await clickTypeRadio(3, '1');

    const values = requireSectionValues();
    expect(values[3]).toBe('7-8');
    expect(values[5]).toBe('?');
  });

  it('同时填写日与周时后写的周被静默丢弃', /** 互斥收敛只朝一个方向生效会让用户填写的周值丢失。 */ async () => {
    const wrapper = await mountCronTab('* * * * * 1-2');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);

    // 现状：日先被写入并触发互斥回调，周随后被收敛为“不指定”，用户填写的周值不再出现。
    expect(requireSectionValues()).toEqual(['*', '*', '*', '*', '*', '?', '']);
    await clickFooterButton('确认');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '* * * * * ?',
    );
  });

  it('面板状态在多个实例之间共享', /** 共享面板状态会让两个编辑器的档位互相覆盖。 */ async () => {
    const first = await mountCronTab('* * * * * 6L');
    await clickGeneratorOption(first, CUSTOM_OPTION);

    const second = await mountCronTab('* * * ? * ?');
    await clickGeneratorOption(second, CUSTOM_OPTION);
    await clickTypeRadio(5, '4');

    // 第二个实例没有解析过任何 L 表达式，却展示了第一个实例写入的星期值。
    expect(requireSectionValues()[5]).toBe('6L');
  });
});

describe('cron 生成器控件写回', /** 面板子控件写回决定用户改动能否进入最终表达式。 */ () => {
  /** 单个分区的控件写回规格：类型、写回值与应展示的调度值。 */
  interface WriteBackCase {
    /** 分区下标，0 为秒、6 为年。 */
    section: number;
    /** 要切换到的调度类型值。 */
    type: string;
    /** 该分区内数字输入控件按顺序写回的值。 */
    numbers?: number[];
    /** 该分区内下拉控件按顺序写回的值；多选控件传字符串数组。 */
    selects?: unknown[];
    /** 写回后面板上该分区应展示的调度值。 */
    display: string;
  }

  /** 覆盖七个分区全部子控件的写回规格，每行用互不相同的值便于发现串档。 */
  const writeBackCases: WriteBackCase[] = [
    { section: 0, type: '1', numbers: [11, 12], display: '11-12' },
    { section: 0, type: '2', numbers: [13, 14], display: '13/14' },
    { section: 0, type: '3', selects: [['15', '16']], display: '15,16' },
    { section: 1, type: '1', numbers: [21, 22], display: '21-22' },
    { section: 1, type: '2', numbers: [23, 24], display: '23/24' },
    { section: 1, type: '3', selects: [['25', '26']], display: '25,26' },
    { section: 2, type: '1', numbers: [1, 2], display: '1-2' },
    { section: 2, type: '2', numbers: [3, 4], display: '3/4' },
    { section: 2, type: '3', selects: [['5', '6']], display: '5,6' },
    { section: 3, type: '1', numbers: [11, 12], display: '11-12' },
    { section: 3, type: '2', numbers: [13, 14], display: '13/14' },
    { section: 3, type: '3', selects: [['15', '16']], display: '15,16' },
    { section: 4, type: '1', numbers: [1, 2], display: '1-2' },
    { section: 4, type: '2', numbers: [3, 4], display: '3/4' },
    { section: 4, type: '3', selects: [['5', '6']], display: '5,6' },
    { section: 5, type: '1', selects: ['3', '5'], display: '3-5' },
    { section: 5, type: '2', numbers: [2], selects: ['5'], display: '5#2' },
    { section: 5, type: '3', selects: [['1', '3']], display: '1,3' },
    { section: 5, type: '4', selects: ['6'], display: '6L' },
    { section: 6, type: '1', numbers: [2021, 2029], display: '2021-2029' },
    { section: 6, type: '2', numbers: [2022, 3], display: '2022/3' },
    {
      section: 6,
      type: '3',
      selects: [['2023', '2024']],
      display: '2023,2024',
    },
  ];

  it('范围、间隔与指定控件写回后展示值与提交表达式一致', /** 子控件未绑定面板状态会让用户改动丢失或提交出别的值。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ?');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);

    for (const item of writeBackCases) {
      await clickTypeRadio(item.section, item.type);
      for (const [index, value] of (item.numbers ?? []).entries()) {
        await numberInputInSection(wrapper, item.section, index).vm.$emit(
          'update:modelValue',
          value,
        );
      }
      for (const [index, value] of (item.selects ?? []).entries()) {
        await selectInSection(wrapper, item.section, index).vm.$emit(
          'update:modelValue',
          value,
        );
      }
      await flushPromises();
      expect(
        requireSectionValues()[item.section],
        `${SECTION_NAMES[item.section]} 分区类型 ${item.type} 写回后的展示值`,
      ).toBe(item.display);
    }

    const sections = requireSectionValues();
    await clickFooterButton('确认');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      joinSections(sections),
    );
  });
});

describe('cron 表达式往返', /** 解析与拼装的口径决定表达式是否被面板改写。 */ () => {
  /** 覆盖七个分区全部分支的表达式往返夹具。 */
  const cases: RoundTripCase[] = [
    roundTrip('* * * * * ?', ['*', '*', '*', '*', '*', '?', ''], '* * * * * ?'),
    roundTrip('* * * ? * *', ['*', '*', '*', '?', '*', '*', ''], '* * * ? * *'),
    roundTrip(
      '1-2 3-4 5-6 ? 9-10 ?',
      ['1-2', '3-4', '5-6', '?', '9-10', '?', ''],
      '1-2 3-4 5-6 ? 9-10 ?',
    ),
    roundTrip(
      '1-2 3-4 5-6 7-8 9-10 ?',
      ['1-2', '3-4', '5-6', '7-8', '9-10', '?', ''],
      '1-2 3-4 5-6 7-8 9-10 ?',
    ),
    roundTrip(
      '0/2 1/3 2/4 3/5 4/6 ?',
      ['0/2', '1/3', '2/4', '3/5', '4/6', '?', ''],
      '0/2 1/3 2/4 3/5 4/6 ?',
    ),
    roundTrip(
      '5,10 15,20 25,30 1,3 1,3 ?',
      ['5,10', '15,20', '25,30', '1,3', '1,3', '?', ''],
      '5,10 15,20 25,30 1,3 1,3 ?',
    ),
    roundTrip('* * * L * ?', ['*', '*', '*', 'L', '*', '?', ''], '* * * L * ?'),
    roundTrip(
      '* * * ? * 1-2',
      ['*', '*', '*', '?', '*', '1-2', ''],
      '* * * ? * 1-2',
    ),
    roundTrip(
      '* * * ? * 5#2',
      ['*', '*', '*', '?', '*', '5#2', ''],
      '* * * ? * 5#2',
    ),
    roundTrip(
      '* * * ? * 1,3',
      ['*', '*', '*', '?', '*', '1,3', ''],
      '* * * ? * 1,3',
    ),
    roundTrip(
      '* * * ? * 3L',
      ['*', '*', '*', '?', '*', '3L', ''],
      '* * * ? * 3L',
    ),
    roundTrip(
      '* * * * * ? *',
      ['*', '*', '*', '*', '*', '?', '*'],
      '* * * * * ? *',
    ),
    roundTrip(
      '* * * * * ? 2020-2030',
      ['*', '*', '*', '*', '*', '?', '2020-2030'],
      '* * * * * ? 2020-2030',
    ),
    roundTrip(
      '* * * * * ? 2020,2021',
      ['*', '*', '*', '*', '*', '?', '2020,2021'],
      '* * * * * ? 2020,2021',
    ),
  ];

  for (const item of cases) {
    it(`解析并提交 ${item.name}`, /** 往返口径错误会把用户输入的表达式改写成语义不同的调度。 */ async () => {
      const wrapper = await mountCronTab(item.modelValue);
      await clickGeneratorOption(wrapper, CUSTOM_OPTION);

      expect(requireSectionValues()).toEqual(item.sections);
      await clickFooterButton('确认');
      expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
        item.submitted,
      );
    });
  }

  it('年间隔表达式被面板调换起止顺序', /** 年字段把年份与步长写反，提交时会把语义不同的表达式交回调用方。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ? 2020/2');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);

    // 现状：表达式里的步长被当成起始年份，起始年份被当成步长，往返后被改写。
    expect(requireSectionValues()[6]).toBe('2/2020');
    await clickFooterButton('确认');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '* * * * * ? 2/2020',
    );
  });

  it('周字段只写占位符时被收敛为不指定', /** 空区间与空序数的解析结果不应残留在面板上误导用户。 */ async () => {
    const wrapper = await mountCronTab('* * * * * -');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);

    expect(requireSectionValues()).toEqual(['*', '*', '*', '*', '*', '?', '']);
    await clickFooterButton('确认');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '* * * * * ?',
    );
  });

  it('位数不足的表达式提示后回落到默认档位', /** 畸形表达式没有提示会让用户以为已经生效。 */ async () => {
    const wrapper = await mountCronTab('* * *');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);

    expect(requireSectionValues()).toEqual(['*', '*', '*', '*', '*', '?', '']);
    await clickFooterButton('确认');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '* * * * * ?',
    );
    expect(document.body.textContent).toContain('cron表达式错误');
  });
});

describe('cron 生成器下拉与输入框', /** 下拉与输入框是表达式的两个手工入口。 */ () => {
  it('初始表达式回填到输入框', /** 未回填会让用户看不到当前表达式。 */ async () => {
    const wrapper = await mountCronTab('0 0 1 * * ?');

    expect(wrapper.find('input').element.value).toBe('0 0 1 * * ?');
  });

  it('调用方更新表达式后输入框同步刷新', /** 未同步会让弹窗面板与外部值不一致。 */ async () => {
    const wrapper = await mountCronTab('0 0 1 * * ?');
    await wrapper.setProps({ modelValue: '0 0 2 * * ?' });
    await flushPromises();

    expect(wrapper.find('input').element.value).toBe('0 0 2 * * ?');
  });

  it('选择预设表达式直接写入并提交', /** 预设未提交会让用户选了档位却没有生效。 */ async () => {
    const wrapper = await mountCronTab('0 0 1 * * ?');
    await clickGeneratorOption(wrapper, PRESET_OPTION);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '0 * * * * ?',
    );
    expect(wrapper.find('input').element.value).toBe('0 * * * * ?');
  });

  it('调用方追加的快捷表达式出现在下拉里', /** 快捷项丢失会让业务自定义档位无法使用。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ?', {
      shortcuts: [{ text: 'DUMMY-每天九点', value: '0 0 9 * * ?' }],
    });
    await wrapper.find('.el-select__wrapper').trigger('click');
    await flushPromises();

    const texts = [
      ...document.querySelectorAll('.el-select-dropdown__item'),
    ].map(/** 读取候选项文案。 */ (item) => item.textContent?.trim() ?? '');
    expect(texts).toContain('DUMMY-每天九点');
  });

  it('手工编辑输入框后把新表达式交回调用方', /** 未提交会让用户的手工修改丢失。 */ async () => {
    const wrapper = await mountCronTab('0 0 1 * * ?');
    await wrapper.find('input').setValue('0 0 3 * * ?');
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '0 0 3 * * ?',
    );
  });
});

describe('cron 生成器弹窗关闭', /** 关闭链路决定弹窗状态与外部表达式是否一致。 */ () => {
  it('确认按钮提交表达式并关闭弹窗', /** 未关闭会让用户以为还没提交。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ?', {
      realTransition: true,
    });
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);
    await clickFooterButton('确认');
    await vi.waitFor(
      /** 等待弹窗离场动画完成后回调把关闭状态写回组件。 */ async () => {
        await flushPromises();
        expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false);
      },
    );
  });

  it('取消按钮放弃改动并关闭弹窗', /** 未放弃会让用户以为改动已经保存。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ?', {
      realTransition: true,
    });
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);
    await clickTypeRadio(0, '1');
    await clickFooterButton('取消');
    await vi.waitFor(
      /** 等待弹窗离场动画完成后回调把关闭状态写回组件。 */ async () => {
        await flushPromises();
        expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false);
      },
    );
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('弹窗自带关闭按钮同样关闭弹窗', /** 关闭按钮失效会让用户被困在弹窗里。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ?', {
      realTransition: true,
    });
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);
    const closeButton = document.querySelector<HTMLElement>(
      '.el-dialog__headerbtn',
    );
    expect(closeButton).not.toBeNull();
    closeButton?.click();
    await vi.waitFor(
      /** 等待关闭按钮驱动的离场动画把关闭状态写回组件。 */ async () => {
        await flushPromises();
        expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false);
      },
    );
  });

  it('打开生成器时下拉模型改为自定义', /** 下拉模型未同步会让用户重复点击同一档位无响应。 */ async () => {
    const wrapper = await mountCronTab('* * * * * ?');
    await clickGeneratorOption(wrapper, CUSTOM_OPTION);

    expect(wrapper.findComponent(ElSelect).props('modelValue')).toBe('custom');
  });
});
