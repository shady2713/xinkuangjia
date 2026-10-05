/**
 * 命令式提示弹窗（popup-ui 的 alert/AlertBuilder）真实行为回归。
 *
 * AlertBuilder 是业务代码确认危险操作、提示错误与收集用户输入的统一下发入口：它把调用方的
 * 参数渲染成真实弹窗，并把用户的确认与取消结算成 Promise。任何一处算错都会让业务拿到错误的
 * 决策——确认后 Promise 不兑现、取消被当成确认、弹窗容器残留在页面上、prompt 丢掉用户输入、
 * 输入框拿不到焦点。用例在真实 DOM 中点击真实按钮、派发真实动画结束事件，断言 Promise 的
 * 兑现/拒绝、真实 DOM 内容、真实焦点位置与容器清理结果。
 */
import { defineComponent, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllAlerts,
  vbenAlert,
  vbenConfirm,
  vbenPrompt,
} from '../AlertBuilder';

/** 记录探针组件被聚焦的次数，用于断言弹窗打开后真实调用输入组件的聚焦能力。 */
const exposedFocus = vi.fn();

/** 暴露 focus 方法的探针输入组件，模拟自己实现聚焦逻辑的业务输入组件。 */
const ExposedFocusInput = defineComponent({
  name: 'ExposedFocusInput',
  /**
   * 暴露 focus 方法并按原样渲染输入框。
   * @param _props 该探针不使用属性。
   * @param context 组件上下文，用于暴露聚焦方法。
   * @returns 渲染输入框的渲染函数。
   */
  setup(_props, { expose }) {
    expose({ focus: exposedFocus });
    return /** 渲染真实输入控件以承载焦点。 */ () =>
      h('input', { class: 'probe-exposed-input' });
  },
});

/** 包装式探针输入组件：根节点是容器，真实输入控件在内部，聚焦必须回退到内部控件。 */
const WrapperInput = defineComponent({
  name: 'WrapperInput',
  props: {
    placeholder: { default: '', type: String },
    value: { default: '', type: String },
  },
  emits: ['update:value'],
  /**
   * 渲染容器与内部输入控件，并把输入值回传给调用方。
   * @param props 传入的占位文案与当前值。
   * @param context 组件上下文，用于回传输入事件。
   * @returns 渲染包装结构的渲染函数。
   */
  setup(props, { emit }) {
    return /** 渲染包装容器与真实输入控件。 */ () =>
      h('div', { class: 'probe-wrapper-input' }, [
        h('input', {
          class: 'probe-inner-input',
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

/** 多根节点探针输入组件：输入框与后缀是并列根节点，聚焦必须回退到第一个真实元素上。 */
const MultiRootInput = defineComponent({
  name: 'MultiRootInput',
  props: {
    placeholder: { default: '', type: String },
    value: { default: '', type: String },
  },
  emits: ['update:value'],
  /**
   * 渲染并列的输入框与后缀节点。
   * @returns 渲染多根节点的渲染函数。
   */
  setup() {
    return /** 渲染输入框与单位后缀两个根节点。 */ () => [
      h('input', { class: 'probe-multi-input' }),
      h('span', { class: 'probe-multi-suffix' }, 'DUMMY-后缀'),
    ];
  },
});

/** 带插槽的探针输入组件：核对调用方传入的插槽与属性是否真实落到输入组件上。 */
const SlotInput = defineComponent({
  name: 'SlotInput',
  props: {
    placeholder: { default: '', type: String },
    value: { default: '', type: String },
  },
  emits: ['update:value'],
  /**
   * 渲染当前值、插槽内容与真实输入控件。
   * @param props 传入的占位文案与当前值。
   * @param context 组件上下文，用于读取插槽与回传输入。
   * @returns 渲染探针结构的渲染函数。
   */
  setup(props, { emit, slots }) {
    return /** 渲染当前值与调用方插槽。 */ () =>
      h('div', { class: 'probe-slot-input' }, [
        h('span', { 'data-test': 'slot-value' }, String(props.value)),
        h('span', { 'data-test': 'slot-content' }, slots.default?.() ?? ''),
        h('input', {
          class: 'probe-slot-field',
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

/**
 * 在文档中按可见文案定位按钮。
 * @param text 按钮可见文案。
 * @returns 匹配到的按钮元素；未渲染时返回 undefined。
 */
function findButton(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    /** 按可见文案筛选按钮。 */ (button) => button.textContent?.includes(text),
  );
}

/**
 * 取出必须存在的文档元素。
 * @param selector 目标选择器。
 * @returns 命中的元素。
 * @throws 元素缺失时抛出，避免断言落到 undefined 上。
 */
function needElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`未渲染出元素 ${selector}`);
  }
  return element;
}

/**
 * 等待命令式弹窗真实渲染到文档中。
 * @param count 期望同时出现的弹窗数量。
 * @returns 弹窗渲染完成后兑现的 Promise。
 */
async function waitForDialog(count = 1) {
  await vi.waitFor(
    /** 等待传送节点把弹窗内容渲染进文档。 */ () => {
      expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(
        count,
      );
    },
    { timeout: 2000 },
  );
}

/**
 * 派发弹窗内容的动画结束事件：真实浏览器里打开与关闭动画结束会驱动 opened/closed 结算。
 * @param selector 接收事件的内容元素选择器。
 * @returns 事件派发与响应式更新完成后兑现的 Promise。
 */
async function dispatchAnimationEnd(selector = '[role="alertdialog"]') {
  document
    .querySelector(selector)
    ?.dispatchEvent(new Event('animationend', { bubbles: true }));
  await nextTick();
  await nextTick();
}

/**
 * 等待关闭状态落到真实 DOM，并按真实浏览器的同一时机补发动画结束事件。
 *
 * 伪 DOM 不执行真实动画：弹窗在关闭状态存在期间由用例补发 animationend，才会走到组件的
 * closed 结算；若弹窗已被立即卸载（确认路径会同步卸载），则直接返回。
 * @returns 结算事件派发完成后兑现的 Promise。
 */
async function settleClosingDialog() {
  for (let tick = 0; tick < 3; tick += 1) {
    await nextTick();
    const content = document.querySelector<HTMLElement>('[role="alertdialog"]');
    if (!content) {
      return;
    }
    if (content.dataset.state === 'closed') {
      content.dispatchEvent(new Event('animationend', { bubbles: true }));
      await nextTick();
      return;
    }
  }
}

/**
 * 点击按钮并等待关闭动画结束，驱动 Promise 真实结算。
 * @param text 按钮可见文案。
 * @returns 结算流程完成后兑现的 Promise。
 */
async function clickAndSettle(text: string) {
  const button = findButton(text);
  if (!button) {
    throw new Error(`未渲染出按钮 ${text}`);
  }
  button.click();
  await settleClosingDialog();
}

afterEach(
  /** 清理残留弹窗与全局替身，避免用例之间互相影响。 */ () => {
    clearAllAlerts();
    document.body.innerHTML = '';
    exposedFocus.mockReset();
    vi.restoreAllMocks();
  },
);

describe('vbenAlert 参数兼容', /** 三种历史调用方式必须都能渲染出调用方要的弹窗。 */ () => {
  it('字符串文案渲染为弹窗内容并在确认后兑现', /** 文案丢失或确认后不兑现会让业务无法提示用户。 */ async () => {
    const pending = vbenAlert('DUMMY-确认删除吗');
    await waitForDialog();

    expect(document.body.textContent).toContain('DUMMY-确认删除吗');
    // 未指定标题时使用内置提示标题，避免弹窗顶部空白。
    expect(document.body.textContent).toContain('提示');

    await clickAndSettle('确认');
    await expect(pending).resolves.toBeUndefined();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('文案加标题时使用给定标题', /** 标题被当成选项对象会让弹窗标题丢失。 */ async () => {
    const pending = vbenAlert('DUMMY-正文', 'DUMMY-标题');
    await waitForDialog();

    expect(document.body.textContent).toContain('DUMMY-标题');
    expect(document.body.textContent).toContain('DUMMY-正文');

    await clickAndSettle('确认');
    await expect(pending).resolves.toBeUndefined();
  });

  it('文案加选项对象时选项合并进弹窗', /** 选项未合并会让自定义按钮文案失效。 */ async () => {
    const pending = vbenAlert('DUMMY-正文', { confirmText: '知道了' });
    await waitForDialog();

    expect(findButton('知道了')).toBeDefined();

    await clickAndSettle('知道了');
    await expect(pending).resolves.toBeUndefined();
  });

  it('文案加标题加选项时两者同时生效', /** 第三个参数被忽略会让补充选项丢失。 */ async () => {
    const pending = vbenAlert('DUMMY-正文', 'DUMMY-标题', {
      cancelText: '再想想',
      confirmText: '好的',
      showCancel: true,
    });
    await waitForDialog();

    expect(document.body.textContent).toContain('DUMMY-标题');
    expect(findButton('好的')).toBeDefined();
    expect(findButton('再想想')).toBeDefined();

    await clickAndSettle('好的');
    await expect(pending).resolves.toBeUndefined();
  });

  it('直接传选项对象时按对象渲染', /** 对象形式的调用被当成文案会让内容显示成 [object Object]。 */ async () => {
    const pending = vbenAlert({
      content: 'DUMMY-对象正文',
      title: 'DUMMY-对象标题',
    });
    await waitForDialog();

    expect(document.body.textContent).toContain('DUMMY-对象正文');
    expect(document.body.textContent).toContain('DUMMY-对象标题');

    await clickAndSettle('确认');
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('vbenAlert 取消与清理', /** 取消必须被识别成取消，强制清理必须真的移除残留弹窗。 */ () => {
  it('点击取消按钮后以固定原因拒绝', /** 取消被当成确认会让业务误删数据。 */ async () => {
    const pending = vbenAlert({
      cancelText: '再想想',
      content: 'DUMMY-取消文案',
      showCancel: true,
    });
    await waitForDialog();

    await clickAndSettle('再想想');

    await expect(pending).rejects.toThrow('dialog cancelled');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('双击确认按钮只结算一次', /** 用户双击确认时二次结算会让业务重复执行危险操作。 */ async () => {
    const settled = vi.fn();
    const pending = vbenAlert('DUMMY-双击确认');
    pending.then(
      /** 记录真实兑现次数。 */ () => {
        settled();
      },
      /** 兑现路径不应出现拒绝。 */ () => {
        settled();
      },
    );
    await waitForDialog();

    const confirm = findButton('确认');
    confirm?.click();
    confirm?.click();

    await expect(pending).resolves.toBeUndefined();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('重复的动画结束事件只结算一次', /** 浏览器对同一元素重复派发结束事件时二次结算会污染调用方结果。 */ async () => {
    const rejections: unknown[] = [];
    const pending = vbenAlert({ content: 'DUMMY-重复通知', showCancel: true });
    pending.catch(
      /** 记录真实结算次数。 */ (error: unknown) => {
        rejections.push(error);
      },
    );
    await waitForDialog();

    const content = needElement('[role="alertdialog"]');
    findButton('取消')?.click();
    await nextTick();
    await nextTick();
    // 真实浏览器对同一元素的多个结束动画会派发多次 animationend，重复通知不能二次结算。
    content.dispatchEvent(new Event('animationend', { bubbles: true }));
    content.dispatchEvent(new Event('animationend', { bubbles: true }));
    await nextTick();
    await nextTick();

    await expect(pending).rejects.toThrow('dialog cancelled');
    expect(rejections).toHaveLength(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('强制清理时移除页面上全部弹窗容器', /** 页面切换后残留的弹窗会挡住整个界面且无人能关闭。 */ async () => {
    vbenAlert('DUMMY-第一个弹窗');
    vbenAlert({
      cancelText: '再想想',
      content: 'DUMMY-第二个弹窗',
      showCancel: true,
    });
    await waitForDialog(2);

    clearAllAlerts();

    expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(0);
    expect(document.body.textContent).not.toContain('DUMMY-第一个弹窗');
    expect(document.body.textContent).not.toContain('DUMMY-第二个弹窗');
    // 登记簿已清空，重复清理必须安全：既不抛错，也不再次操作已卸载的容器。
    expect(
      /** 再次清理已清空的登记簿。 */ () => clearAllAlerts(),
    ).not.toThrow();
  });
});

describe('vbenConfirm 参数兼容', /** 确认弹窗必须默认带取消按钮，否则用户无法退出危险操作。 */ () => {
  it('只传文案时渲染确认弹窗', /** 缺少取消按钮会让用户只能确认。 */ async () => {
    const pending = vbenConfirm('DUMMY-确认文案');
    await waitForDialog();

    expect(findButton('取消')).toBeDefined();

    await clickAndSettle('确认');
    await expect(pending).resolves.toBeUndefined();
  });

  it('只传选项对象时合并默认选项', /** 对象形式漏掉取消按钮会让确认弹窗退化成提示弹窗。 */ async () => {
    const pending = vbenConfirm({
      confirmText: '删除',
      content: 'DUMMY-对象确认',
    });
    await waitForDialog();

    expect(findButton('取消')).toBeDefined();
    expect(findButton('删除')).toBeDefined();

    await clickAndSettle('删除');
    await expect(pending).resolves.toBeUndefined();
  });

  it('文案加选项对象时选项生效', /** 选项参数被丢给标题分支会让自定义文案失效。 */ async () => {
    const pending = vbenConfirm('DUMMY-正文', { confirmText: '继续' });
    await waitForDialog();

    expect(findButton('继续')).toBeDefined();

    await clickAndSettle('继续');
    await expect(pending).resolves.toBeUndefined();
  });

  it('文案加标题时使用给定标题', /** 标题被当成选项对象会让确认弹窗丢失标题。 */ async () => {
    const pending = vbenConfirm('DUMMY-正文', 'DUMMY-确认标题');
    await waitForDialog();

    expect(document.body.textContent).toContain('DUMMY-确认标题');
    expect(findButton('取消')).toBeDefined();

    await clickAndSettle('确认');
    await expect(pending).resolves.toBeUndefined();
  });

  it('文案加标题加选项时三者都生效', /** 标题与选项互相覆盖会让弹窗缺少关键提示。 */ async () => {
    const pending = vbenConfirm('DUMMY-正文', 'DUMMY-确认标题', {
      cancelText: '算了',
    });
    await waitForDialog();

    expect(document.body.textContent).toContain('DUMMY-确认标题');
    expect(findButton('算了')).toBeDefined();

    await clickAndSettle('确认');
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('vbenPrompt 输入收集', /** 输入弹窗必须把用户真实输入回传给调用方。 */ () => {
  it('返回用户在默认输入框中输入的文本', /** 输入值丢失会让业务拿到空结果。 */ async () => {
    const pending = vbenPrompt({ content: 'DUMMY-请输入名称' });
    await waitForDialog();

    const input = needElement<HTMLInputElement>('[role="alertdialog"] input');
    input.value = 'DUMMY-输入值';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    await clickAndSettle('确认');

    await expect(pending).resolves.toBe('DUMMY-输入值');
  });

  it('打开后把焦点落到默认输入框上', /** 打开后不聚焦会让用户必须额外点击一次才能输入。 */ async () => {
    vbenPrompt({ content: 'DUMMY-聚焦默认输入框' });
    await waitForDialog();

    await dispatchAnimationEnd();

    const input = needElement<HTMLInputElement>('[role="alertdialog"] input');
    expect(document.activeElement).toBe(input);
  });

  it('优先调用输入组件自己暴露的聚焦方法', /** 忽略组件自带的聚焦能力会让复杂输入控件无法就位。 */ async () => {
    vbenPrompt({
      component: ExposedFocusInput,
      content: 'DUMMY-聚焦暴露方法',
    });
    await waitForDialog();

    await dispatchAnimationEnd();

    expect(exposedFocus).toHaveBeenCalledTimes(1);
  });

  it('输入组件没有聚焦方法时回退到内部输入控件', /** 包装式输入组件不聚焦内部控件会让用户无法直接输入。 */ async () => {
    vbenPrompt({
      component: WrapperInput,
      componentProps: { placeholder: 'DUMMY-占位' },
      content: 'DUMMY-聚焦内部控件',
      modelPropName: 'value',
    });
    await waitForDialog();

    await dispatchAnimationEnd();

    const inner = needElement<HTMLInputElement>(
      '[role="alertdialog"] .probe-inner-input',
    );
    expect(document.activeElement).toBe(inner);
    expect(inner.placeholder).toBe('DUMMY-占位');
  });

  it('自定义值属性名、默认值与插槽真实传给输入组件', /** 值属性名或插槽传错会让自定义输入组件收不到数据。 */ async () => {
    const pending = vbenPrompt({
      component: SlotInput,
      componentProps: { placeholder: 'DUMMY-占位' },
      componentSlots: {
        /**
         * 渲染调用方插槽内容。
         * @returns 插槽文案。
         */
        default: () => 'DUMMY-插槽内容',
      },
      content: 'DUMMY-自定义输入',
      defaultValue: 'DUMMY-默认值',
      modelPropName: 'value',
    });
    await waitForDialog();

    expect(needElement('[data-test="slot-value"]').textContent).toBe(
      'DUMMY-默认值',
    );
    expect(needElement('[data-test="slot-content"]').textContent).toBe(
      'DUMMY-插槽内容',
    );

    const field = needElement<HTMLInputElement>('.probe-slot-field');
    field.value = 'DUMMY-新输入';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    await clickAndSettle('确认');

    await expect(pending).resolves.toBe('DUMMY-新输入');
  });

  it('多根节点输入组件聚焦时回退到第一个真实元素', /** 输入框与后缀并列时找不到可聚焦元素会让用户无法直接输入。 */ async () => {
    vbenPrompt({
      component: MultiRootInput,
      content: 'DUMMY-多根节点输入',
      modelPropName: 'value',
    });
    await waitForDialog();

    await dispatchAnimationEnd();

    const input = needElement<HTMLInputElement>(
      '[role="alertdialog"] .probe-multi-input',
    );
    expect(document.activeElement).toBe(input);
    expect(needElement('.probe-multi-suffix').textContent).toBe('DUMMY-后缀');
  });

  it('调用方关闭校验返回 false 时弹窗保持打开', /** 未通过校验就关闭会让业务校验形同虚设。 */ async () => {
    const beforeClose = vi.fn(
      /** 明确拒绝本次关闭并核对收到的当前值。 */ async () => false,
    );
    vbenPrompt({
      beforeClose,
      content: 'DUMMY-校验关闭',
      defaultValue: 'DUMMY-校验值',
    });
    await waitForDialog();

    // 关闭校验拒绝时弹窗不会进入关闭状态，这里只点击并推进渲染。
    findButton('取消')?.click();
    await settleClosingDialog();

    expect(beforeClose).toHaveBeenCalledWith({
      isConfirm: false,
      value: 'DUMMY-校验值',
    });
    expect(needElement<HTMLElement>('[role="alertdialog"]').dataset.state).toBe(
      'open',
    );
  });

  it('取消时把取消结果真实抛给调用方', /** 静默吞掉取消会让调用方分不清用户取消与输入为空。 */ async () => {
    const pending = vbenPrompt({ content: 'DUMMY-取消输入' });
    await waitForDialog();

    await clickAndSettle('取消');

    await expect(pending).rejects.toThrow('dialog cancelled');
  });
});
