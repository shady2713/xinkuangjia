/**
 * 命令式提示弹窗（alert.vue）的真实行为回归。
 *
 * 弹窗是危险操作确认与信息提示的统一出口：图标必须按类型真实渲染、确认与取消必须
 * 产生真实的模型更新与事件、`beforeClose` 返回 false 时必须阻止关闭、按钮对齐与边框
 * 配置必须落到容器样式上。用例真实挂载组件并通过真实 DOM 点击驱动交互，
 * 断言的是渲染结果与对外事件，不镜像内部状态变量。
 */
import type { AlertProps } from '../alert';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAlertContext } from '../alert';
import Alert from '../alert.vue';

/**
 * 通过 content 属性注入弹窗上下文的内容组件，驱动真实的确认与取消动作。
 */
const AlertContextConsumer = defineComponent({
  name: 'AlertContextConsumer',
  /**
   * 读取弹窗上下文并渲染两个动作按钮。
   * @returns 渲染动作按钮的渲染函数。
   */
  setup() {
    const { doCancel, doConfirm } = useAlertContext();
    return /** 渲染真实按钮以触发上下文动作。 */ () =>
      h('div', [
        h(
          'button',
          {
            'data-test': 'ctx-confirm',
            /** 触发确认动作。 */
            onClick: () => doConfirm(),
          },
          '上下文确认',
        ),
        h(
          'button',
          {
            'data-test': 'ctx-cancel',
            /** 触发取消动作。 */
            onClick: () => doCancel(),
          },
          '上下文取消',
        ),
      ]);
  },
});

/**
 * 派发真实的内容动画结束事件，驱动打开与关闭事件转发。
 * @returns 事件派发完成后兑现的 Promise。
 */
async function dispatchAnimationEnd() {
  document
    .querySelector('[role="alertdialog"]')
    ?.dispatchEvent(new Event('animationend', { bubbles: true }));
  await nextTick();
}

/**
 * 挂载弹窗并等待门户内容渲染到文档中。
 * @param props 本次要传入的弹窗属性。
 * @returns 已挂载的弹窗包装器。
 */
async function mountAlert(props: InstanceType<typeof Alert>['$props']) {
  const wrapper = mount(Alert, { attachTo: document.body, props });
  await wrapper.vm.$nextTick();
  await new Promise(
    /** 等待门户内容与过渡状态稳定。 */
    (resolve) => {
      setTimeout(resolve, 0);
    },
  );
  return wrapper;
}

/**
 * 在文档中按可见文案定位按钮。
 * @param text 按钮文案。
 * @returns 匹配到的按钮元素；未渲染时返回 null。
 */
function findButton(text: string) {
  return [...document.querySelectorAll('button')].find(
    /** 按可见文案筛选按钮。 */ (button) => button.textContent?.includes(text),
  );
}

describe('提示弹窗渲染与交互', /** 提示与确认弹窗的渲染分支决定用户能否看到正确的图标与按钮。 */ () => {
  afterEach(
    /** 清理门户渲染到文档中的残留内容。 */ () => {
      document.body.innerHTML = '';
      vi.restoreAllMocks();
    },
  );

  it('标题、内容与底部内容真实渲染', /** 内容缺失会让提示弹窗变成空壳。 */ async () => {
    const wrapper = await mountAlert({
      content: '确认删除该记录吗',
      footer: '底部说明',
      open: true,
      title: '危险操作',
    });

    expect(document.body.textContent).toContain('危险操作');
    expect(document.body.textContent).toContain('确认删除该记录吗');
    expect(document.body.textContent).toContain('底部说明');
    wrapper.unmount();
  });

  it('图标按类型渲染对应图形，未知类型不渲染图标', /** 图标类型写错会把成功提示渲染成警告图标。 */ async () => {
    const expectedStyles: Record<string, string> = {
      error: '--destructive',
      info: '--info',
      success: '--success',
      warning: '--warning',
    };
    for (const [icon, style] of Object.entries(expectedStyles)) {
      const wrapper = await mountAlert({
        content: '内容',
        // 图标名由被测组件按字符串取值解析，用例逐项核对真实渲染结果。
        icon: icon as AlertProps['icon'],
        open: true,
        title: '标题',
      });
      const svg = document.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('style')).toContain(style);
      wrapper.unmount();
      document.body.innerHTML = '';
    }

    const question = await mountAlert({
      content: '内容',
      icon: 'question',
      open: true,
      title: '标题',
    });
    expect(document.querySelector('svg')).not.toBeNull();
    question.unmount();
    document.body.innerHTML = '';

    const unknown = await mountAlert({
      content: '内容',
      // 未知图标名必须不渲染图标，因此按运行期真实输入模拟。
      icon: 'not-an-icon' as AlertProps['icon'],
      open: true,
      title: '标题',
    });
    expect(document.querySelector('svg')).toBeNull();
    unknown.unmount();
  });

  it('点击确认发出确认事件并请求关闭', /** 确认事件缺失会让业务拿不到用户决策。 */ async () => {
    const wrapper = await mountAlert({
      confirmText: '删除',
      content: '内容',
      open: true,
      title: '标题',
    });

    findButton('删除')?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('显示取消按钮时点击取消只请求关闭', /** 取消按钮失效会让用户无法退出危险操作。 */ async () => {
    const wrapper = await mountAlert({
      cancelText: '再想想',
      content: '内容',
      open: true,
      showCancel: true,
      title: '标题',
    });

    findButton('再想想')?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('beforeClose 返回 false 时阻止关闭', /** 未通过关闭校验就关闭会让业务校验形同虚设。 */ async () => {
    const beforeClose = vi.fn(/** 明确拒绝本次关闭。 */ async () => false);
    const wrapper = await mountAlert({
      beforeClose,
      confirmText: '确认',
      content: '内容',
      open: true,
      title: '标题',
    });

    findButton('确认')?.click();
    await wrapper.vm.$nextTick();
    await new Promise(
      /** 等待关闭校验的异步结果。 */
      (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(beforeClose).toHaveBeenCalledWith({ isConfirm: true });
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });

  it('beforeClose 放行时关闭并按确认状态回调', /** 放行后不关闭会让弹窗卡在页面上。 */ async () => {
    const beforeClose = vi.fn(/** 放行本次关闭。 */ async () => true);
    const wrapper = await mountAlert({
      beforeClose,
      confirmText: '确认',
      content: '内容',
      open: true,
      title: '标题',
    });

    findButton('确认')?.click();
    await wrapper.vm.$nextTick();
    await new Promise(
      /** 等待关闭校验的异步结果。 */
      (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(beforeClose).toHaveBeenCalledWith({ isConfirm: true });
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('内容组件可注入弹窗上下文并驱动确认动作', /** 内容组件拿不到上下文会让自定义内容无法触发确认。 */ async () => {
    const wrapper = await mountAlert({
      content: AlertContextConsumer,
      open: true,
      title: '标题',
    });

    document.querySelector<HTMLElement>('[data-test="ctx-confirm"]')?.click();
    await nextTick();

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it('内容组件可注入弹窗上下文并驱动取消动作', /** 取消动作走错分支会让自定义内容误触发确认回调。 */ async () => {
    const wrapper = await mountAlert({
      content: AlertContextConsumer,
      open: true,
      title: '标题',
    });

    document.querySelector<HTMLElement>('[data-test="ctx-cancel"]')?.click();
    await nextTick();

    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it('内容动画结束转发打开事件，关闭时按确认状态回调', /** 事件不转发会让命令式弹窗的打开回调与结果结算全部失效。 */ async () => {
    const wrapper = await mountAlert({
      content: '内容',
      open: true,
      title: '标题',
    });

    await dispatchAnimationEnd();
    expect(wrapper.emitted('opened')).toHaveLength(1);
    expect(wrapper.emitted('closed')).toBeUndefined();

    // 未确认时关闭必须回传 false，确认后再关闭必须回传 true。
    await wrapper.setProps({ open: false });
    await dispatchAnimationEnd();
    expect(wrapper.emitted('closed')?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it('按下 Escape 复位确认状态且不误报确认', /** Escape 关闭后仍按确认结算会把取消当成用户同意。 */ async () => {
    const wrapper = await mountAlert({
      content: '内容',
      open: true,
      title: '标题',
    });

    document.querySelector<HTMLElement>('[role="alertdialog"]')?.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await nextTick();
    await wrapper.setProps({ open: false });
    await dispatchAnimationEnd();

    expect(wrapper.emitted('closed')?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it('按钮对齐与边框配置落到容器与操作区样式', /** 样式配置失效会让确认区排版与设计不符。 */ async () => {
    const wrapper = await mountAlert({
      bordered: false,
      buttonAlign: 'center',
      containerClass: 'probe-container',
      content: '内容',
      open: true,
      title: '标题',
    });
    await wrapper.vm.$nextTick();

    const container = document.querySelector('.probe-container');
    expect(container).not.toBeNull();
    expect(container?.className).toContain('shadow-3xl');
    expect(container?.className).not.toContain('border-border');

    const actionRow = [...document.querySelectorAll('div')].find(
      /** 按操作区类名定位按钮容器。 */ (item) =>
        item.className.includes('gap-x-2'),
    );
    expect(actionRow?.className).toContain('justify-center');
  });

  it('默认渲染边框与右对齐操作区', /** 默认样式是多数调用方的实际外观，不能被配置分支带偏。 */ async () => {
    const wrapper = await mountAlert({
      containerClass: 'probe-default',
      content: '内容',
      open: true,
      title: '标题',
    });
    await wrapper.vm.$nextTick();

    const container = document.querySelector('.probe-default');
    expect(container?.className).toContain('border-border');

    const actionRow = [...document.querySelectorAll('div')].find(
      /** 按操作区类名定位按钮容器。 */ (item) =>
        item.className.includes('gap-x-2'),
    );
    expect(actionRow?.className).toContain('justify-end');
  });
});
