/**
 * 点选验证码（point-selection-captcha/index）真实行为回归。
 *
 * 该组件把用户在图片上的点击换算成图片内坐标并编号标记，再通过 click/confirm/refresh 三个事件
 * 把点位、清空回调与刷新意图交给业务方；未配置任何提示时还会给出控制台告警。
 * 坐标未减去图片在视口中的位置会让后端比对全部偏移；越界点击未拦截会让图片外的点击也被计入；
 * 坐标不是数字时未兜底会让异常冒泡出去打断整个页面；清空点位失败、业务方的 refresh/confirm
 * 监听抛错时未兜底会让一次业务异常直接把组件打挂；点位未编号或未按偏移渲染会让用户不知道
 * 还要点几个字、标记也会偏离点击位置；提示图片与提示文字的互斥分支写反会让提示区内容错位；
 * 刷新入口未清空上一轮点位会让旧点残留在新图上。
 *
 * 用例真实挂载组件、真实派发带视口坐标的点击、真实读取事件载荷与渲染结果；只替换浏览器布局
 * 计算（happy-dom 不计算元素位置），并对组件显式兜底的异常分支做受控故障注入。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { $t } from '@vben/locales';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PointSelectionCaptcha from '../index.vue';

/** 点位标记相对点击坐标的半径偏移，与组件声明的 11 像素保持一致。 */
const POINT_OFFSET = 11;

/** 图片相对视口左边缘的位置，happy-dom 不计算布局，按浏览器契约注入。 */
const IMAGE_LEFT = 10;

/** 图片相对视口上边缘的位置，happy-dom 不计算布局，按浏览器契约注入。 */
const IMAGE_TOP = 20;

/** 图片的像素宽度，决定越界点击的判定边界。 */
const IMAGE_WIDTH = 300;

/** 图片的像素高度，决定越界点击的判定边界。 */
const IMAGE_HEIGHT = 220;

/** 图片占位地址：只用于核对渲染出的图片地址。 */
const CAPTCHA_IMAGE = 'DUMMY-CAPTCHA-IMAGE';

/** 提示图占位地址：只用于核对提示区的图片分支。 */
const HINT_IMAGE = 'DUMMY-HINT-IMAGE';

/** 提示文字夹具：只用于核对提示区的文字分支。 */
const HINT_TEXT = 'DUMMY-请依次点击文字';

/**
 * 给图片注入受控布局矩形。
 * @param wrapper 已挂载的点选验证码包装器。
 */
function layoutImage(wrapper: ReturnType<typeof mount>) {
  const image = wrapper.find('img').element;
  // happy-dom 不计算布局，这里按浏览器契约注入图片的真实位置与尺寸。
  image.getBoundingClientRect = /** 返回受控的图片布局矩形。 */ () =>
    new DOMRect(IMAGE_LEFT, IMAGE_TOP, IMAGE_WIDTH, IMAGE_HEIGHT);
}

/**
 * 在图片上的指定相对坐标处派发一次真实点击。
 * @param wrapper 已挂载的点选验证码包装器。
 * @param x 相对图片左上角的横坐标。
 * @param y 相对图片左上角的纵坐标。
 * @returns 已派发的点击事件，供调用方核对默认行为是否被阻止。
 */
function clickImage(wrapper: ReturnType<typeof mount>, x: number, y: number) {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: IMAGE_LEFT + x,
    clientY: IMAGE_TOP + y,
  });
  wrapper.find('img').element.dispatchEvent(event);
  return event;
}

/**
 * 取出渲染出的点位标记。
 * @param wrapper 已挂载的点选验证码包装器。
 * @returns 带按钮语义的点位标记列表。
 */
function pointMarks(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('div[role="button"]');
}

/**
 * 按无障碍标签取出组件顶部的功能按钮。
 * @param wrapper 已挂载的点选验证码包装器。
 * @param label 按钮的无障碍标签，与组件内的文案键一致。
 * @returns 命中的按钮包装器。
 * @throws TypeError 组件未渲染该按钮时抛出，避免用例静默地什么都不验证。
 */
function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper
    .findAll('button')
    .find(
      /** 按无障碍标签匹配功能按钮。 */ (item) =>
        item.attributes('aria-label') === label,
    );
  if (!button) {
    throw new TypeError(`未渲染无障碍标签为 ${label} 的按钮`);
  }
  return button;
}

/**
 * 挂载点选验证码。
 * @param props 传给组件的提示与接口配置。
 * @param slots 传给组件的插槽内容。
 * @returns 已挂载的点选验证码包装器。
 */
function mountCaptcha(
  props: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) {
  const wrapper = mount(PointSelectionCaptcha, {
    props: { captchaImage: CAPTCHA_IMAGE, hintText: HINT_TEXT, ...props },
    slots,
  });
  layoutImage(wrapper);
  return wrapper;
}

beforeEach(
  /** 每例静默控制台输出，避免预期的兜底日志污染测试结果。 */ () => {
    vi.spyOn(console, 'warn').mockImplementation(
      /** 静默越界与缺提示的告警。 */ () => {},
    );
    vi.spyOn(console, 'error').mockImplementation(
      /** 静默兜底分支的错误日志。 */ () => {},
    );
  },
);

afterEach(
  /** 还原控制台替身，避免影响同进程内其它用例的输出。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('点选验证码点位采集', /** 坐标换算与越界拦截决定提交给后端的点位是否正确。 */ () => {
  it('点击图片按图片内坐标编号标记并回传点位', /** 未减去图片位置会让后端比对偏移，未编号会让用户不知道还差几个字。 */ async () => {
    const wrapper = mountCaptcha();

    const event = clickImage(wrapper, 100, 50);
    await nextTick();

    const clicks = wrapper.emitted('click');
    expect(clicks).toHaveLength(1);
    expect(clicks?.[0]?.[0]).toEqual({
      i: 0,
      t: expect.any(Number),
      x: 100,
      y: 50,
    });
    expect(event.defaultPrevented).toBe(true);

    const marks = pointMarks(wrapper);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.text()).toBe('1');
    expect(marks[0]?.attributes('style')).toContain(
      `left: ${100 - POINT_OFFSET}px`,
    );
    expect(marks[0]?.attributes('style')).toContain(
      `top: ${50 - POINT_OFFSET}px`,
    );
  });

  it('多次点击按顺序编号并保留原始点位', /** 顺序错乱会让后端按错误顺序比对字符。 */ async () => {
    const wrapper = mountCaptcha();

    clickImage(wrapper, 10, 10);
    clickImage(wrapper, 20, 30);
    await nextTick();

    expect(wrapper.findAll('div[role="button"]')).toHaveLength(2);
    expect(wrapper.emitted('click')?.[0]?.[0]).toMatchObject({ i: 0, x: 10 });
    expect(wrapper.emitted('click')?.[1]?.[0]).toMatchObject({ i: 1, x: 20 });
  });

  it('图片外的点击被拦截且不产生点位', /** 未拦截越界点击会让图片外的空白区域也被计入点位。 */ async () => {
    const wrapper = mountCaptcha();

    clickImage(wrapper, IMAGE_WIDTH + 10, IMAGE_HEIGHT + 10);
    await nextTick();

    expect(wrapper.emitted('click')).toBeUndefined();
    expect(pointMarks(wrapper)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      'Click position is out of the valid range',
    );
  });

  it('坐标不是数字时兜底记录日志且不冒泡', /** 未兜底会让外部合成的脏事件直接打断整个页面。 */ async () => {
    const wrapper = mountCaptcha();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    // 受控故障注入：外部合成的点击事件坐标不是数字，验证组件的兜底日志分支。
    Object.defineProperty(event, 'clientX', { value: 'DUMMY-非数字横坐标' });

    wrapper.find('img').element.dispatchEvent(event);
    await nextTick();

    expect(console.error).toHaveBeenCalledWith(
      'Error in handleClick:',
      expect.any(TypeError),
    );
    expect(wrapper.emitted('click')).toBeUndefined();
  });

  it('布局 API 抛错时兜底记录日志且不冒泡', /** 未兜底会让一次布局异常直接打断整个页面。 */ async () => {
    const wrapper = mountCaptcha();
    const fault = new Error('DUMMY-布局计算失败');
    wrapper.find('img').element.getBoundingClientRect =
      /** 受控故障注入：让布局 API 抛错，验证组件的兜底日志分支。 */ () => {
        throw fault;
      };

    clickImage(wrapper, 10, 10);
    await nextTick();

    expect(console.error).toHaveBeenCalledWith('Error in handleClick:', fault);
    expect(wrapper.emitted('click')).toBeUndefined();
  });
});

describe('点选验证码确认与刷新', /** 确认载荷与刷新清空决定业务方能否拿到点位并重新开始。 */ () => {
  it('未开启确认按钮时不渲染确认入口', /** 误渲染确认按钮会让业务方拿到未确认的点位。 */ () => {
    const wrapper = mountCaptcha();

    expect(
      wrapper
        .findAll('button')
        .some(
          /** 判断是否存在确认按钮。 */ (item) =>
            item.attributes('aria-label') === $t('ui.captcha.confirmAriaLabel'),
        ),
    ).toBe(false);
  });

  it('点击确认把点位与清空回调交给业务方', /** 载荷不完整会让业务方拿不到点位或无法清空重新点。 */ async () => {
    const wrapper = mountCaptcha({ showConfirm: true });
    clickImage(wrapper, 100, 50);
    await nextTick();

    await findButton(wrapper, $t('ui.captcha.confirmAriaLabel')).trigger(
      'click',
    );

    const confirmed = wrapper.emitted('confirm')?.[0];
    expect(confirmed?.[0]).toEqual([
      { i: 0, t: expect.any(Number), x: 100, y: 50 },
    ]);
    const clearCallback = confirmed?.[1];
    expect(typeof clearCallback).toBe('function');
    (clearCallback as CallableFunction)();
    await nextTick();
    expect(pointMarks(wrapper)).toHaveLength(0);
  });

  it('点击刷新清空点位并通知业务方', /** 未清空会让旧点残留在新图上。 */ async () => {
    const wrapper = mountCaptcha();
    clickImage(wrapper, 100, 50);
    await nextTick();
    expect(pointMarks(wrapper)).toHaveLength(1);

    await findButton(wrapper, $t('ui.captcha.refreshAriaLabel')).trigger(
      'click',
    );

    expect(pointMarks(wrapper)).toHaveLength(0);
    expect(wrapper.emitted('refresh')).toHaveLength(1);
  });

  it('业务方的刷新监听抛错时兜底记录日志', /** 未兜底会让业务方的一次异常把刷新入口打挂。 */ async () => {
    const fault = new Error('DUMMY-刷新监听失败');
    const wrapper = mountCaptcha({
      /** 受控故障注入：业务方刷新监听抛错，验证组件的兜底日志分支。 */
      onRefresh: () => {
        throw fault;
      },
    });

    await findButton(wrapper, $t('ui.captcha.refreshAriaLabel')).trigger(
      'click',
    );

    expect(console.error).toHaveBeenCalledWith(
      'Error in handleRefresh:',
      fault,
    );
  });

  it('业务方的确认监听抛错时兜底记录日志', /** 未兜底会让业务方的一次异常把确认入口打挂。 */ async () => {
    const fault = new Error('DUMMY-确认监听失败');
    const wrapper = mountCaptcha({
      /** 受控故障注入：业务方确认监听抛错，验证组件的兜底日志分支。 */
      onConfirm: () => {
        throw fault;
      },
      showConfirm: true,
    });

    await findButton(wrapper, $t('ui.captcha.confirmAriaLabel')).trigger(
      'click',
    );

    expect(console.error).toHaveBeenCalledWith(
      'Error in handleConfirm:',
      fault,
    );
  });

  it('底层点位数组清空失败时兜底记录日志', /** 未兜底会让一次数组操作异常把刷新入口打挂。 */ async () => {
    const fault = new Error('DUMMY-点位清空失败');
    const wrapper = mountCaptcha();
    clickImage(wrapper, 100, 50);
    await nextTick();

    // 受控故障注入：让底层数组清空操作抛错，验证组件的兜底日志分支。
    const spliceSpy = vi
      .spyOn(Array.prototype, 'splice')
      .mockImplementationOnce(
        /** 下一次数组清空操作固定抛错。 */ () => {
          throw fault;
        },
      );
    try {
      findButton(
        wrapper,
        $t('ui.captcha.refreshAriaLabel'),
      ).element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } finally {
      spliceSpy.mockRestore();
    }

    expect(console.error).toHaveBeenCalledWith('Error in clear:', fault);
  });
});

describe('点选验证码外观分支', /** 提示区与标题分支决定业务方的配置能否生效。 */ () => {
  it('未配置任何提示时给出控制台告警', /** 静默缺少提示会让用户完全不知道要按什么顺序点击。 */ () => {
    mount(PointSelectionCaptcha, { props: { captchaImage: CAPTCHA_IMAGE } });

    expect(console.warn).toHaveBeenCalledWith(
      'At least one of hint image or hint text must be provided',
    );
  });

  it('配置提示图时渲染提示图而不是提示文字', /** 两个分支写反会让提示区内容与配置不一致。 */ () => {
    const wrapper = mountCaptcha({ hintImage: HINT_IMAGE, hintText: '' });

    const hint = wrapper.find(`img[src="${HINT_IMAGE}"]`);
    expect(hint.exists()).toBe(true);
    expect(wrapper.text()).not.toContain($t('ui.captcha.clickInOrder'));
  });

  it('配置提示文字时按序拼接点击提示', /** 提示文字丢失会让用户不知道要按什么顺序点击。 */ () => {
    const wrapper = mountCaptcha();

    expect(wrapper.text()).toContain(
      `${$t('ui.captcha.clickInOrder')}【${HINT_TEXT}】`,
    );
  });

  it('title 插槽替换默认标题', /** 插槽被默认标题顶掉会让业务方无法定制标题。 */ () => {
    const wrapper = mountCaptcha(
      {},
      { title: '<b class="DUMMY-title-slot">DUMMY-插槽标题</b>' },
    );

    expect(wrapper.find('.DUMMY-title-slot').exists()).toBe(true);
  });
});
