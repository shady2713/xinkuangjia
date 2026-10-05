/**
 * 滑块验证码（slider-captcha/index）真实行为回归。
 *
 * 该组件把鼠标与触摸的按下、移动、松开换算成滑块位移：按下时记录起点与按下时刻，移动时按容器
 * 与滑块的真实宽度把位移夹紧在轨道内，越过右端判定通过并回传耗时与凭据，未越过则复位滑块与
 * 进度条，松手后 300 毫秒内还要把宽度回零；isSlot 模式下组件只做联动、由父级决定是否通过。
 * 位移未减去按下位置会让滑块与鼠标错位；未按真实宽度夹紧会让滑块滑出轨道；越界未判定通过会
 * 让用户永远验证不过；未越界未复位会让下一轮从错误位置开始；复位后未回零会让进度条停在半路；
 * 通过后仍可再次拖动会让用户重复提交；isSlot 模式误判通过或未把宽度交给父级会让旋转验证码
 * 状态错乱；触摸事件未换算触点会让移动端无法拖动。
 *
 * 用例真实挂载组件、真实派发鼠标与触摸事件序列、真实执行复位与回零定时器，只注入浏览器布局
 * 尺寸（happy-dom 不计算 offsetWidth），不替换组件内部逻辑。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { $t } from '@vben/locales';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SliderCaptcha from '../index.vue';

/** 轨道（组件根元素）在浏览器中的像素宽度。 */
const WRAPPER_WIDTH = 300;

/** 滑块按钮在浏览器中的像素宽度。 */
const ACTION_WIDTH = 40;

/** 轨道宽度减去滑块宽度再减 6 像素后的可用行程，超过即判定通过。 */
const OFFSET = WRAPPER_WIDTH - ACTION_WIDTH - 6;

/** 按下时的页面横坐标，相对滑块初始位置 0。 */
const PRESS_PAGE_X = 100;

/** 拖动到的页面横坐标，对应 100 像素的滑块位移。 */
const MOVE_PAGE_X = 200;

/** 远超右端点的页面横坐标，用于验证位移夹紧与判定通过。 */
const OVERSHOOT_PAGE_X = 5000;

/** 复位后宽度回零的过渡时长，与组件声明的 300 毫秒保持一致。 */
const RESET_DELAY = 300;

/** 通过判定回传的耗时格式：一位小数秒。 */
const SUCCESS_TIME_PATTERN = /^\d+\.\d$/;

/**
 * 给轨道与滑块注入受控布局尺寸。
 * @param wrapper 已挂载的滑块包装器。
 */
function layoutSlider(wrapper: ReturnType<typeof mount>) {
  // happy-dom 不计算布局，这里按浏览器契约注入轨道与滑块的真实宽度。
  Object.defineProperty(wrapper.element, 'offsetWidth', {
    configurable: true,
    value: WRAPPER_WIDTH,
  });
  Object.defineProperty(actionElement(wrapper), 'offsetWidth', {
    configurable: true,
    value: ACTION_WIDTH,
  });
}

/**
 * 取出滑块按钮元素。
 * @param wrapper 已挂载的滑块包装器。
 * @returns 滑块按钮元素，按真实 DOM 元素读取行内样式。
 */
function actionElement(wrapper: ReturnType<typeof mount>): HTMLElement {
  return wrapper.find<HTMLElement>('[name="captcha-action"]').element;
}

/**
 * 取出滑块按钮的包装器。
 * @param wrapper 已挂载的滑块包装器。
 * @returns 滑块按钮包装器。
 */
function actionWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[name="captcha-action"]');
}

/**
 * 取出拖动进度条。
 * @param wrapper 已挂载的滑块包装器。
 * @returns 进度条包装器，元素类型按真实 DOM 元素标注。
 */
function barWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find<HTMLElement>('.bg-success');
}

/**
 * 取出文案内容层。
 * @param wrapper 已挂载的滑块包装器。
 * @returns 内容层包装器。
 */
function contentWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.select-none');
}

/**
 * 构造带触摸点信息的触摸事件。
 * @param type 触摸事件类型，例如 touchstart 或 touchmove。
 * @param pageX 触摸点相对页面左边缘的横坐标；缺省表示本次触摸没有触点。
 * @returns 已注入触摸点的可派发事件。
 */
function touchEvent(type: string, pageX?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  // happy-dom 不提供 TouchEvent 构造器，这里按浏览器契约注入触摸点列表。
  Object.defineProperty(event, 'touches', {
    value: pageX === undefined ? [] : [{ pageX }],
  });
  return event;
}

/**
 * 挂载滑块验证码并注入受控布局尺寸。
 * @param props 传给组件的展示与模式配置。
 * @param slots 传给组件的插槽内容。
 * @returns 已挂载的滑块包装器。
 */
function mountSlider(
  props: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) {
  const wrapper = mount(SliderCaptcha, { props, slots });
  layoutSlider(wrapper);
  return wrapper;
}

/**
 * 执行一次完整的按下与拖动。
 * @param wrapper 已挂载的滑块包装器。
 * @param movePageX 拖动到的页面横坐标。
 */
async function drag(wrapper: ReturnType<typeof mount>, movePageX: number) {
  await actionWrapper(wrapper).trigger('mousedown', { pageX: PRESS_PAGE_X });
  await wrapper.trigger('mousemove', { pageX: movePageX });
}

beforeEach(
  /** 每例启用受控时钟，避免真实等待 300 毫秒的回零定时器。 */ () => {
    vi.useFakeTimers();
  },
);

afterEach(
  /** 恢复真实时钟，避免影响其它用例的时间来源。 */ () => {
    vi.useRealTimers();
  },
);

describe('滑块验证码初始渲染', /** 文案与样式透传决定用户能否看懂提示。 */ () => {
  it('未传文案时使用默认提示与默认成功文案', /** 默认文案丢失会让用户不知道要按住滑块。 */ () => {
    const wrapper = mountSlider();

    expect(contentWrapper(wrapper).text()).toBe(
      $t('ui.captcha.sliderDefaultText'),
    );
  });

  it('调用方文案、class 与容器样式被真实透传', /** 透传丢失会让业务方无法定制文案与外观。 */ () => {
    const wrapper = mountSlider({
      class: 'DUMMY-额外类',
      successText: 'DUMMY-验证通过',
      text: 'DUMMY-请拖动滑块',
      wrapperStyle: { height: '48px' },
    });

    expect(wrapper.classes()).toContain('DUMMY-额外类');
    expect(wrapper.attributes('style')).toContain('height: 48px');
    expect(contentWrapper(wrapper).text()).toBe('DUMMY-请拖动滑块');
  });

  it('text 与 actionIcon 插槽替换默认内容', /** 插槽被默认内容顶掉会让业务方无法定制滑块。 */ () => {
    const wrapper = mountSlider(
      {},
      {
        actionIcon: '<i class="DUMMY-custom-icon"></i>',
        text: '<i class="DUMMY-custom-text"></i>',
      },
    );

    expect(wrapper.find('.DUMMY-custom-text').exists()).toBe(true);
    expect(wrapper.find('.DUMMY-custom-icon').exists()).toBe(true);
    expect(contentWrapper(wrapper).text()).toBe('');
  });
});

describe('滑块验证码拖动位移', /** 位移换算与夹紧决定滑块是否跟手以及能否滑出轨道。 */ () => {
  it('未按下时移动不产生位移', /** 未按下就跟随鼠标会让滑块在页面上乱跳。 */ async () => {
    const wrapper = mountSlider();

    await wrapper.trigger('mousemove', { pageX: MOVE_PAGE_X });

    expect(actionElement(wrapper).style.left).toBe('0px');
    expect(wrapper.emitted('move')).toBeUndefined();
  });

  it('按下后拖动按真实位移渲染滑块与进度条', /** 未减去按下位置会让滑块与鼠标错位。 */ async () => {
    const wrapper = mountSlider();

    await drag(wrapper, MOVE_PAGE_X);

    expect(actionElement(wrapper).style.left).toBe(
      `${MOVE_PAGE_X - PRESS_PAGE_X}px`,
    );
    expect(barWrapper(wrapper).element.style.width).toBe(
      `${MOVE_PAGE_X - PRESS_PAGE_X + ACTION_WIDTH / 2}px`,
    );
    expect(wrapper.emitted('start')).toHaveLength(1);
    expect(wrapper.emitted('move')?.[0]?.[0]).toMatchObject({
      moveDistance: PRESS_PAGE_X,
      moveX: MOVE_PAGE_X - PRESS_PAGE_X,
    });
  });

  it('向左拖出起点时不产生负位移', /** 未拦截负位移会让滑块压到轨道左侧外。 */ async () => {
    const wrapper = mountSlider();

    await drag(wrapper, 0);

    expect(actionElement(wrapper).style.left).toBe('0px');
    expect(barWrapper(wrapper).element.style.width).toBe('0px');
  });

  it('拖动越过右端时夹紧并把宽度交给父级', /** 未夹紧会让滑块滑出可视区，宽度错算会让进度条超出轨道。 */ async () => {
    const wrapper = mountSlider();

    await drag(wrapper, OVERSHOOT_PAGE_X);

    expect(actionElement(wrapper).style.left).toBe(
      `${WRAPPER_WIDTH - ACTION_WIDTH}px`,
    );
    expect(barWrapper(wrapper).element.style.width).toBe(
      `${WRAPPER_WIDTH - ACTION_WIDTH / 2}px`,
    );
    // 夹紧位置与可用行程的关系：右端点减去 6 像素的轨道内边距。
    expect(WRAPPER_WIDTH - ACTION_WIDTH).toBe(OFFSET + 6);
  });

  it('触摸拖动按触点横坐标换算位移', /** 只支持鼠标会让移动端无法拖动滑块。 */ async () => {
    const wrapper = mountSlider();

    actionElement(wrapper).dispatchEvent(
      touchEvent('touchstart', PRESS_PAGE_X),
    );
    wrapper.element.dispatchEvent(touchEvent('touchmove', MOVE_PAGE_X));
    await nextTick();

    expect(actionElement(wrapper).style.left).toBe(
      `${MOVE_PAGE_X - PRESS_PAGE_X}px`,
    );
  });
});

describe('滑块验证码校验结果', /** 通过判定与复位决定能否拿到凭据以及能否重新验证。 */ () => {
  it('拖动越过右端判定通过并回传耗时', /** 越界未判定通过会让用户永远验证不过，耗时格式错会让业务方拿到脏数据。 */ async () => {
    const wrapper = mountSlider();

    await actionWrapper(wrapper).trigger('mousedown', { pageX: PRESS_PAGE_X });
    vi.advanceTimersByTime(1000);
    await wrapper.trigger('mousemove', { pageX: OVERSHOOT_PAGE_X });

    const success = wrapper.emitted('success')?.[0]?.[0] as {
      isPassing: boolean;
      time: string;
    };
    expect(success.isPassing).toBe(true);
    expect(success.time).toBe('1.0');
    expect(success.time).toMatch(SUCCESS_TIME_PATTERN);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('松开时越过右端同样判定通过', /** 只在移动时判定会让快速甩动松手的用户验证不过。 */ async () => {
    const wrapper = mountSlider();

    await actionWrapper(wrapper).trigger('mousedown', { pageX: PRESS_PAGE_X });
    await wrapper.trigger('mouseup', { pageX: OVERSHOOT_PAGE_X });

    expect(wrapper.emitted('success')).toHaveLength(1);
    expect(actionElement(wrapper).style.left).toBe(
      `${WRAPPER_WIDTH - ACTION_WIDTH}px`,
    );
  });

  it('通过后不再响应新的拖动', /** 通过后仍可拖动会让用户重复提交校验。 */ async () => {
    const wrapper = mountSlider();

    await drag(wrapper, OVERSHOOT_PAGE_X);
    await actionWrapper(wrapper).trigger('mousedown', { pageX: PRESS_PAGE_X });

    expect(wrapper.emitted('start')).toHaveLength(1);
  });

  it('未越过右端松开时复位滑块与进度条', /** 未复位会让下一轮从错误位置开始拖动。 */ async () => {
    const wrapper = mountSlider();

    await drag(wrapper, MOVE_PAGE_X);
    await wrapper.trigger('mouseup', { pageX: MOVE_PAGE_X });

    expect(contentWrapper(wrapper).attributes('style')).toContain(
      'width: 100%',
    );
    expect(barWrapper(wrapper).classes()).toContain('transition-width');
    expect(wrapper.emitted('end')).toHaveLength(1);
    expect(wrapper.emitted('success')).toBeUndefined();

    vi.advanceTimersByTime(RESET_DELAY);
    await nextTick();

    expect(actionElement(wrapper).style.left).toBe('0px');
    expect(barWrapper(wrapper).element.style.width).toBe('0px');
    expect(barWrapper(wrapper).classes()).not.toContain('transition-width');
  });

  it('鼠标移出轨道时按松开处理并复位', /** 移出轨道未复位会让滑块卡在半路。 */ async () => {
    const wrapper = mountSlider();

    await drag(wrapper, MOVE_PAGE_X);
    await wrapper.trigger('mouseleave', { pageX: MOVE_PAGE_X });

    expect(contentWrapper(wrapper).attributes('style')).toContain(
      'width: 100%',
    );
    expect(barWrapper(wrapper).classes()).toContain('transition-width');
  });

  it('触摸松开时触点清空仍能复位', /** 触摸抬起没有触点时未兜底会让移动端滑块卡住。 */ async () => {
    const wrapper = mountSlider();

    actionElement(wrapper).dispatchEvent(
      touchEvent('touchstart', PRESS_PAGE_X),
    );
    wrapper.element.dispatchEvent(touchEvent('touchmove', MOVE_PAGE_X));
    await nextTick();
    wrapper.element.dispatchEvent(touchEvent('touchend'));
    await nextTick();

    expect(wrapper.emitted('end')).toHaveLength(1);
    expect(contentWrapper(wrapper).attributes('style')).toContain(
      'width: 100%',
    );
  });
});

describe('滑块验证码插槽联动模式', /** isSlot 模式由父级决定通过，组件只负责位移与宽度交接。 */ () => {
  it('越过右端松开时不自行判定通过', /** 联动模式误判通过会让旋转验证码直接放行。 */ async () => {
    const wrapper = mountSlider({ isSlot: true });

    await drag(wrapper, OVERSHOOT_PAGE_X);
    await wrapper.trigger('mouseup', { pageX: OVERSHOOT_PAGE_X });

    expect(wrapper.emitted('success')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(barWrapper(wrapper).classes()).toContain('transition-width');
  });

  it('父级在松开时判定通过则把进度宽度交给内容层', /** 宽度未交接会让旋转验证码的进度条与内容层错位。 */ async () => {
    let slider: ReturnType<typeof mount>;
    /** 父级在松开事件里同步置位，模拟旋转验证码判定通过。 */
    const onEnd = () => {
      void slider.setProps({ modelValue: true });
    };
    slider = mountSlider({ isSlot: true, modelValue: false, onEnd });

    await drag(slider, MOVE_PAGE_X);
    await slider.trigger('mouseup', { pageX: MOVE_PAGE_X });
    vi.advanceTimersByTime(1);
    await nextTick();

    // 内容层宽度取进度条的真实宽度，即滑块位移加上半个滑块宽度。
    expect(contentWrapper(slider).attributes('style')).toContain(
      `width: ${MOVE_PAGE_X - PRESS_PAGE_X + ACTION_WIDTH / 2}px`,
    );
    expect(barWrapper(slider).classes()).not.toContain('transition-width');
  });

  it('父级未判定通过时按复位处理', /** 未复位会让联动组件的滑块停在中途。 */ async () => {
    const wrapper = mountSlider({ isSlot: true, modelValue: false });

    await drag(wrapper, MOVE_PAGE_X);
    await wrapper.trigger('mouseup', { pageX: MOVE_PAGE_X });
    vi.advanceTimersByTime(1);
    await nextTick();

    expect(contentWrapper(wrapper).attributes('style')).toContain(
      'width: 100%',
    );
    expect(barWrapper(wrapper).classes()).toContain('transition-width');
  });
});
