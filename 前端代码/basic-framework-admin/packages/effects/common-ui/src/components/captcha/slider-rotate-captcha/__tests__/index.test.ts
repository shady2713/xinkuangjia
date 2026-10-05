/**
 * 旋转验证码（common-ui 的 captcha/slider-rotate-captcha）真实行为回归。
 *
 * 组件把滑块位移换算成图片旋转角度：图片加载后随机一个目标角度，用户拖动滑块旋转图片，
 * 松手时角度差在容差内判定通过并抛出耗时与凭据，超出容差则把图片转回目标角度并提示重试；
 * 点击图片可以复位到未验证状态。角度换算漏乘或容差判断写反会让用户永远验证不过，复位逻辑
 * 失效会让失败后无法重试，通过结果未回写 v-model 会让父级拿不到验证状态。
 *
 * 用例真实挂载组件、真实派发按下/移动/松开鼠标序列与图片加载事件，只在验证码依赖外部资源时
 * 固定随机数与图片加载时序；滑块轨道在 happy-dom 中不参与角度换算，因此不注入任何布局尺寸。
 *
 * 复位入口有两处必须单独固定：一是"滑块条组件已不存在"时的早退守卫（组件卸载后仍被调用
 * resume 的时序），二是滑块条回写 v-model 时父级的验证状态更新。前者用真实卸载后的受控时序
 * 驱动，后者用滑块条自身声明的 `update:modelValue` 事件契约驱动。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { $t } from '@vben/locales';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SliderCaptcha from '../../slider-captcha/index.vue';
import SliderRotateCaptcha from '../index.vue';

/** 组件默认的图片边长，位移按它归一化。 */
const IMAGE_SIZE = 260;

/** 组件默认的最大旋转角度。 */
const MAX_DEGREE = 300;

/** 组件默认的最小旋转角度，也是随机目标角度的下界。 */
const MIN_DEGREE = 120;

/** 固定随机数后生成的随机目标角度。 */
const RANDOM_DEGREE = MIN_DEGREE;

/** 容差内的一次拖动位移：换算后角度与目标角度相差 2 度。 */
const MATCH_MOVE_X = 70;

/** 复位动画时长，与组件声明的 300 毫秒保持一致。 */
const ORIGIN_DELAY = 300;

/**
 * 取滑块按钮元素。
 * @param wrapper 已挂载的验证码包装器。
 * @returns 滑块按钮元素。
 */
function actionWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[name="captcha-action"]');
}

/**
 * 取滑块轨道元素，拖动过程中的移动与松开事件都派发在它上面。
 * @param wrapper 已挂载的验证码包装器。
 * @returns 轨道元素包装器。
 */
function barWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.h-10');
}

/**
 * 取验证码图片元素。
 * @param wrapper 已挂载的验证码包装器。
 * @returns 图片元素包装器。
 */
function imageWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('img');
}

/**
 * 触发一次图片加载完成，模拟浏览器把图片数据读进来的时机。
 * @param wrapper 已挂载的验证码包装器。
 */
async function loadImage(wrapper: ReturnType<typeof mount>) {
  await imageWrapper(wrapper).trigger('load');
}

/**
 * 完成一次完整的按下、拖动与松开。
 * @param wrapper 已挂载的验证码包装器。
 * @param movePageX 拖动到的页面横坐标，相对按下位置的位移即由它决定。
 */
async function dragTo(wrapper: ReturnType<typeof mount>, movePageX: number) {
  await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
  await barWrapper(wrapper).trigger('mousemove', { pageX: movePageX });
  await barWrapper(wrapper).trigger('mouseup', { pageX: movePageX });
}

beforeEach(
  /** 固定随机数并启用受控时钟，让目标角度与复位动画都可预期。 */ () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.useFakeTimers();
  },
);

afterEach(
  /** 恢复随机数与真实时钟，避免影响其它用例。 */ () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  },
);

describe('旋转验证码渲染', /** 图片、提示与容器尺寸决定用户能否看懂要做什么。 */ () => {
  it('按图片尺寸渲染容器并透传自定义样式', /** 尺寸或自定义样式丢失会让验证码在弹窗里错位。 */ () => {
    const wrapper = mount(SliderRotateCaptcha, {
      props: {
        defaultTip: 'DUMMY-请把图片转正',
        imageSize: 200,
        imageWrapperStyle: { borderColor: 'red' },
        src: 'DUMMY-captcha.png',
      },
    });

    const box = imageWrapper(wrapper).element.parentElement;
    expect(imageWrapper(wrapper).attributes('src')).toBe('DUMMY-captcha.png');
    expect(box?.getAttribute('style')).toContain('height: 200px');
    expect(box?.getAttribute('style')).toContain('width: 200px');
    expect(box?.getAttribute('style')).toContain('border-color: red');
    expect(wrapper.text()).toContain('DUMMY-请把图片转正');
  });

  it('未传提示时使用默认文案', /** 默认文案丢失会让用户不知道要拖动滑块。 */ () => {
    const wrapper = mount(SliderRotateCaptcha);

    expect(wrapper.text()).toContain($t('ui.captcha.sliderRotateDefaultTip'));
  });

  it('透传调用方插槽给滑块', /** 插槽不转发会让业务方无法定制滑块文案与图标。 */ () => {
    const wrapper = mount(SliderRotateCaptcha, {
      slots: {
        actionIcon: '<i class="DUMMY-action-icon"></i>',
        text: '<i class="DUMMY-slider-text"></i>',
      },
    });

    expect(wrapper.find('.DUMMY-action-icon').exists()).toBe(true);
    expect(wrapper.find('.DUMMY-slider-text').exists()).toBe(true);
  });
});

describe('旋转验证码角度换算', /** 角度换算决定滑块是否跟手以及目标角度是否随机。 */ () => {
  it('图片加载后生成随机目标角度并立即旋转图片', /** 不重新随机会让重放同一张图就能猜中答案。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha);
    expect(imageWrapper(wrapper).attributes('style')).toBeUndefined();

    await loadImage(wrapper);

    expect(imageWrapper(wrapper).attributes('style')).toContain(
      `rotateZ(${RANDOM_DEGREE}deg)`,
    );
  });

  it('拖动按位移换算旋转角度', /** 位移换算错误会让滑块与图片旋转不同步。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha);
    await loadImage(wrapper);

    await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
    await barWrapper(wrapper).trigger('mousemove', { pageX: MATCH_MOVE_X });

    // 位移按图片宽度归一化后乘以 1.5 倍最大角度，结果向上取整。
    const rotated = Math.ceil((MATCH_MOVE_X / IMAGE_SIZE) * 1.5 * MAX_DEGREE);
    expect(imageWrapper(wrapper).attributes('style')).toContain(
      `rotateZ(${RANDOM_DEGREE - rotated}deg)`,
    );
  });

  it('图片宽度为 0 时放弃本次角度更新', /** 除零会让图片角度变成 NaN 而整张图消失。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha, { props: { imageSize: 0 } });
    await loadImage(wrapper);
    const before = imageWrapper(wrapper).attributes('style');

    await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
    await barWrapper(wrapper).trigger('mousemove', { pageX: MATCH_MOVE_X });

    expect(imageWrapper(wrapper).attributes('style')).toBe(before);
  });

  it('最小角度等于最大角度时使用抖动的换算系数', /** 区间为零时不做抖动会让目标角度恒定而失去随机性。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha, {
      props: { maxDegree: 200, minDegree: 200 },
    });
    await loadImage(wrapper);

    await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
    await barWrapper(wrapper).trigger('mousemove', { pageX: MATCH_MOVE_X });

    // 区间为零时换算系数为 1.1，位移结果据此放大。
    const rotated = Math.ceil((MATCH_MOVE_X / IMAGE_SIZE) * 1.5 * 200 * 1.1);
    expect(imageWrapper(wrapper).attributes('style')).toContain(
      `rotateZ(${200 - rotated}deg)`,
    );
  });

  it('最小角度大于最大角度时给出告警', /** 区间反了不告警会让配置错误无法被察觉。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 忽略告警输出，仅记录调用。 */ () => {});
    const wrapper = mount(SliderRotateCaptcha, {
      props: { maxDegree: 200, minDegree: 300 },
    });
    await loadImage(wrapper);

    await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
    await barWrapper(wrapper).trigger('mousemove', { pageX: MATCH_MOVE_X });

    expect(warn).toHaveBeenCalledWith(
      'minDegree should not be greater than maxDegree',
    );
  });

  it('拖动过程中隐藏默认提示', /** 拖动时仍显示默认提示会盖住图片。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha, {
      props: { defaultTip: 'DUMMY-按住拖动' },
    });
    await loadImage(wrapper);
    expect(wrapper.text()).toContain('DUMMY-按住拖动');

    await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
    await barWrapper(wrapper).trigger('mousemove', { pageX: MATCH_MOVE_X });

    expect(wrapper.text()).not.toContain('DUMMY-按住拖动');
  });
});

describe('旋转验证码校验结果', /** 容差判定与复位决定用户能否验证通过以及失败后能否重试。 */ () => {
  it('容差内松手判定通过并回传耗时', /** 判定不通过会让用户永远拿不到凭据，耗时格式错会让业务方拿到脏数据。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha, {
      props: { diffDegree: 20 },
    });
    await loadImage(wrapper);

    await dragTo(wrapper, MATCH_MOVE_X);

    const success = wrapper.emitted('success')?.[0]?.[0] as {
      isPassing: boolean;
      time: string;
    };
    expect(success.isPassing).toBe(true);
    expect(success.time).toMatch(/^\d+\.\d$/);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
    expect(wrapper.text()).toContain(
      $t('ui.captcha.sliderRotateSuccessTip', [success.time]),
    );
  });

  it('超出容差松手转回目标角度并提示失败', /** 失败后不转回会让用户看不出正确答案在哪里。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha, { props: { diffDegree: 20 } });
    await loadImage(wrapper);

    await dragTo(wrapper, 0);

    expect(wrapper.text()).toContain($t('ui.captcha.sliderRotateFailTip'));
    expect(imageWrapper(wrapper).attributes('style')).toContain(
      `rotateZ(${RANDOM_DEGREE}deg)`,
    );
    // 转回过程带过渡类，避免角度瞬变让用户看不清。
    expect(imageWrapper(wrapper).classes()).toContain('transition-transform');

    vi.advanceTimersByTime(ORIGIN_DELAY);
    await nextTick();

    expect(imageWrapper(wrapper).classes()).not.toContain(
      'transition-transform',
    );
  });

  it('点击图片复位并重新随机目标角度', /** 不能复位会让用户在一次失败后无法重试。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha, { props: { diffDegree: 20 } });
    await loadImage(wrapper);
    await dragTo(wrapper, 0);
    expect(wrapper.text()).toContain($t('ui.captcha.sliderRotateFailTip'));

    // 第二次生成的随机角度与第一次不同，用于确认复位时真的重新随机。
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await imageWrapper(wrapper).trigger('click');

    expect(wrapper.text()).not.toContain($t('ui.captcha.sliderRotateFailTip'));
    expect(imageWrapper(wrapper).attributes('style')).toContain(
      'rotateZ(210deg)',
    );
  });

  it('已通过后点击图片可以重新验证', /** 通过后再点图片必须恢复可拖动状态，否则用户无法重新校验。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha);
    await loadImage(wrapper);
    await dragTo(wrapper, MATCH_MOVE_X);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);

    await imageWrapper(wrapper).trigger('click');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('滑块条组件已不存在时复位静默返回', /** 卸载后仍被调用复位时必须直接返回，否则会访问已销毁的滑块条而抛错。 */ async () => {
    const wrapper = mount(SliderRotateCaptcha);
    await loadImage(wrapper);
    const captcha = wrapper.vm as unknown as {
      /** 组件通过 defineExpose 暴露的复位入口。 */
      resume: () => void;
    };
    const randomSpy = vi.spyOn(Math, 'random');

    // 组件在挂载状态下：复位必须走完整条链路并重新随机目标角度。
    const callsBeforeMountedResume = randomSpy.mock.calls.length;
    captcha.resume();

    expect(randomSpy.mock.calls.length).toBe(callsBeforeMountedResume + 1);

    // 卸载后滑块条模板引用已被清空：守卫必须拦下，重新随机这一步不能被执行。
    wrapper.unmount();

    expect(
      /** 卸载后调用复位入口，守卫必须让它安全返回。 */ () => captcha.resume(),
    ).not.toThrow();
    expect(randomSpy.mock.calls.length).toBe(callsBeforeMountedResume + 1);
  });

  it('滑块条回写 v-model 时父级验证状态同步更新', /** 回写链路断开会让父级拿不到验证结果，业务方无法据此放行提交。 */ () => {
    const wrapper = mount(SliderRotateCaptcha, {
      props: { modelValue: false },
    });

    // 滑块条通过自身声明的 v-model 事件回写验证状态。
    wrapper.findComponent(SliderCaptcha).vm.$emit('update:modelValue', true);

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([true]);
  });
});
