/**
 * 主题切换按钮（widgets/theme-toggle/theme-button.vue）真实主题写入与视图过渡编排回归。
 *
 * 该按钮是顶栏深浅色切换的唯一入口，它直接改写 `v-model` 绑定的主题状态，并在浏览器支持视图过渡时
 * 用圆形扩散动画过渡。绑定写错会让用户点了没反应；按钮形态判断错会让图标按钮带上文字按钮的内边距；
 * 视图过渡替身相关判断写错会让动画方向相反、画面被二次淡出，或在用户要求减弱动效时仍然播放全屏动画。
 * 用例挂载真实按钮与真实主题面板，用真实偏好设置写入与真实 DOM 类名断言，只替换外部边界：
 * 浏览器视图过渡 API（内联样式动画属于浏览器能力，测试环境不实现）与系统减弱动效查询。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { preferences, resetPreferences } from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ThemeButton from './theme-button.vue';
import ThemeToggle from './theme-toggle.vue';

/** 按钮向外抛出的主题值，用例按点击顺序断言。 */
const modelValues: boolean[] = [];

/** 自绘动画收尾回调的签名。 */
type AnimationFinishHandler = () => void;

/** 视图过渡回调的签名：真实实现会同步调用它翻转主题。 */
type ViewTransitionCallback = () => Promise<void> | void;

/** 圆形扩散动画替身捕获到的收尾回调；用例手动触发以核对跳过默认过渡。 */
let animateFinish: AnimationFinishHandler | undefined;

/** View Transition 替身的调用记录。 */
const transitionProbe = {
  /** document.documentElement.animate 收到的参数。 */
  animateArgs: [] as unknown[],
  /** 视图过渡收到的回调；用例调用它触发真实主题翻转。 */
  callback: undefined as undefined | ViewTransitionCallback,
  /** skipTransition 的真实调用次数。 */
  skipped: 0,
};

vi.mock(
  '@vben/locales',
  /** 语言包是外部边界：固定返回键名，避免用例依赖真实翻译内容。 */ () => ({
    /**
     * 返回文案键本身。
     * @param key 组件请求的文案键。
     * @returns 原样返回的文案键。
     */
    $t: (key: string) => key,
  }),
);

/**
 * 挂载主题切换按钮，并把抛出值像主题面板一样写回真实绑定状态。
 * 按钮读取的是受控属性，因此必须由外层真实回写，主题方向才与生产一致。
 * @param initial 初始主题状态，true 表示深色。
 * @param type 按钮形态；省略表示默认的普通按钮。
 * @returns 已挂载的宿主组件包装器。
 */
function mountThemeButton(initial: boolean, type?: 'icon' | 'normal') {
  const isDark = ref(initial);
  const Host = defineComponent({
    name: 'ThemeButtonHost',
    /**
     * 渲染真实按钮并把抛出值写回本地状态。
     * @returns 渲染函数。
     */
    setup() {
      return /** 渲染受控的真实主题按钮。 */ () =>
        h(ThemeButton, {
          modelValue: isDark.value,
          /** 记录并把抛出的主题值写回绑定状态。 */
          'onUpdate:modelValue': (value: boolean | undefined) => {
            modelValues.push(value ?? false);
            isDark.value = value ?? false;
          },
          ...(type === undefined ? {} : { type }),
        });
    },
  });
  return mount(Host);
}

/**
 * 安装视图过渡替身：真实视图过渡是浏览器能力，测试环境不实现，
 * 替换后才能核对圆形扩散动画的圆心、方向与收尾。
 * @returns 动画与过渡替身，以及卸载替身的清理函数。
 */
function stubViewTransition() {
  const startViewTransition = vi.fn(
    /** 立即执行视图过渡回调（与真实实现一致）并返回可结算的过渡对象。 */ (
      callback: ViewTransitionCallback,
    ) => {
      transitionProbe.callback = callback;
      return {
        ready: Promise.resolve(callback()),
        /** 记录跳过默认过渡的调用。 */
        skipTransition: () => {
          transitionProbe.skipped += 1;
        },
      };
    },
  );
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: startViewTransition,
    writable: true,
  });
  const animate = vi.fn(
    /** 记录动画参数并捕获收尾回调。 */ (...args: unknown[]) => {
      transitionProbe.animateArgs = args;
      return {
        /**
         * 读回当前登记的动画收尾回调，供断言确认真实注册过。
         * @returns 已登记的收尾回调；尚未登记时为 undefined。
         */
        get onfinish(): AnimationFinishHandler | undefined {
          return animateFinish;
        },
        /**
         * 接收组件赋值的动画收尾回调。
         * @param handler 自绘动画播完后要执行的收尾动作。
         */
        set onfinish(handler: AnimationFinishHandler) {
          animateFinish = handler;
        },
      };
    },
  );
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    value: animate,
    writable: true,
  });
  return {
    animate,
    /** 删除两个浏览器 API 替身。 */
    cleanup: () => {
      delete (document as { startViewTransition?: unknown })
        .startViewTransition;
      delete (document.documentElement as { animate?: unknown }).animate;
      animateFinish = undefined;
    },
    /** 视图过渡入口替身，供兜底用例复用。 */
    startViewTransition,
  };
}

beforeEach(
  /** 清空抛出的主题值与替身记录，避免用例之间互相影响。 */ () => {
    resetPreferences();
    modelValues.length = 0;
    transitionProbe.animateArgs = [];
    transitionProbe.callback = undefined;
    transitionProbe.skipped = 0;
    animateFinish = undefined;
    // 固定视口尺寸，使圆形扩散半径可精确断言。
    vi.stubGlobal('innerHeight', 768);
    vi.stubGlobal('innerWidth', 1024);
  },
);

afterEach(
  /** 恢复偏好设置并清空全局替身。 */ () => {
    resetPreferences();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe('主题按钮形态', /** 形态判断错误会让图标按钮出现文字按钮的内边距，图标被压扁。 */ () => {
  it('普通形态使用重型按钮样式并按主题暴露无障碍文案', /** 无障碍文案与主题相反会让读屏用户切错主题。 */ () => {
    const wrapper = mountThemeButton(false);

    const button = wrapper.get('button');
    // 当前是浅色，按钮语义是“切到深色”。
    expect(button.attributes('aria-label')).toBe('dark');
    expect(button.attributes('aria-live')).toBe('polite');
    expect(wrapper.get('button').classes()).toContain('is-dark');
    expect(wrapper.get('button').classes()).toContain('hover:bg-heavy');
    expect(wrapper.get('button').classes()).not.toContain('rounded-full');
  });

  it('图标形态使用圆形图标按钮样式', /** 图标形态缺少圆形与内边距会让顶栏按钮与相邻图标错位。 */ () => {
    const wrapper = mountThemeButton(true, 'icon');

    const button = wrapper.get('button');
    expect(button.attributes('aria-label')).toBe('light');
    expect(button.classes()).toContain('is-light');
    expect(button.classes()).toContain('rounded-full');
    expect(button.classes()).toContain('w-8');
    expect(button.attributes('style')).toContain('padding: 7px');
  });
});

describe('主题按钮切换', /** 点击后主题必须真的翻转，否则用户以为切换失效。 */ () => {
  it('浏览器不支持视图过渡时直接翻转主题', /** 兜底分支失效会让不支持该能力的浏览器点了没反应。 */ async () => {
    const wrapper = mountThemeButton(false);

    await wrapper.get('button').trigger('click');

    expect(modelValues).toStrictEqual([true]);
  });

  it('浅色切深色时按下沉的圆形扩散方向播放动画', /** 深浅方向判断反了会让扩散动画从错误方向掠过屏幕。 */ async () => {
    const stub = stubViewTransition();
    const wrapper = mountThemeButton(false);

    await wrapper.get('button').trigger('click', { clientX: 12, clientY: 34 });
    await flushPromises();

    expect(modelValues).toStrictEqual([true]);
    expect(stub.animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = transitionProbe.animateArgs as [
      { clipPath: string[] },
      { duration: number; easing: string; pseudoElement: string },
    ];
    expect(keyframes.clipPath[1]).toBe('circle(0px at 12px 34px)');
    expect(keyframes.clipPath[0]).not.toContain('circle(0px');
    // 切到深色时旧画面在下、新画面盖住它，因此用旧画面的伪元素并反转裁剪顺序。
    expect(options.pseudoElement).toBe('::view-transition-old(root)');
    expect(options.duration).toBe(450);
    expect(stub.startViewTransition).toHaveBeenCalledTimes(1);
    stub.cleanup();
  });

  it('深色切浅色时按扩散方向播放动画并回落到新画面伪元素', /** 回切浅色时仍用旧画面会让过渡结束后残留深色快照。 */ async () => {
    const stub = stubViewTransition();
    const wrapper = mountThemeButton(true);

    await wrapper.get('button').trigger('click', { clientX: 0, clientY: 0 });
    await flushPromises();

    expect(modelValues).toStrictEqual([false]);
    const [keyframes, options] = transitionProbe.animateArgs as [
      { clipPath: string[] },
      { pseudoElement: string },
    ];
    // 切到浅色时新画面在下，裁剪顺序保持从小圆扩散到大圆。
    expect(keyframes.clipPath[0]).toBe('circle(0px at 0px 0px)');
    expect(keyframes.clipPath[1]).toContain('circle(');
    expect(options.pseudoElement).toBe('::view-transition-new(root)');
    stub.cleanup();
  });

  it('自绘动画播完后跳过视图过渡的默认收尾', /** 不跳过默认收尾会让画面在动画结束后再淡出一次。 */ async () => {
    const stub = stubViewTransition();
    const wrapper = mountThemeButton(false);

    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(transitionProbe.skipped).toBe(0);

    animateFinish?.();

    expect(transitionProbe.skipped).toBe(1);
    stub.cleanup();
  });

  it('用户要求减弱动效时不播放圆形扩散动画', /** 忽略系统减弱动效偏好会让前庭敏感用户被迫接受全屏动画。 */ async () => {
    const stub = stubViewTransition();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(
        /** 返回“用户要求减弱动效”的系统偏好。 */ () => ({ matches: true }),
      ),
    );
    const wrapper = mountThemeButton(false);

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(modelValues).toStrictEqual([true]);
    expect(stub.startViewTransition).not.toHaveBeenCalled();
    expect(stub.animate).not.toHaveBeenCalled();
    stub.cleanup();
  });

  it('能力探测之后视图过渡 API 消失时仍然直接翻转主题', /** 缺少这层保护会在 API 被撤回的浏览器上抛出异常，主题完全切不动。 */ async () => {
    const stub = stubViewTransition();
    let reads = 0;
    // 探测阶段读第一次返回真实实现，真正调用前读第二次返回 undefined，模拟 API 被撤回。
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      /** 第一次返回替身，之后返回 undefined。 */
      get: () => (reads++ === 0 ? stub.startViewTransition : undefined),
    });
    const wrapper = mountThemeButton(false);

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(modelValues).toStrictEqual([true]);
    expect(stub.animate).not.toHaveBeenCalled();
    stub.cleanup();
  });
});

describe('主题面板与真实主题写入', /** 面板与按钮联动错误会让用户看不到主题真正落库。 */ () => {
  it('点击主题按钮真实写入偏好设置并改变文档主题类名', /** 只改组件内部状态而不写偏好设置，刷新后主题会回退。 */ async () => {
    const wrapper = mount(ThemeToggle);
    await nextTick();

    // 默认主题为深色，按钮语义是“切到浅色”。
    expect(preferences.theme.mode).toBe('dark');
    expect(wrapper.get('button').classes()).toContain('is-light');

    await wrapper.get('button').trigger('click');
    await nextTick();

    expect(preferences.theme.mode).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(wrapper.get('button').classes()).toContain('is-dark');

    await wrapper.get('button').trigger('click');
    await nextTick();

    expect(preferences.theme.mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(wrapper.get('button').classes()).toContain('is-light');
    wrapper.unmount();
  });

  it('聚焦展开主题面板并真实切换三种主题模式', /** 面板选项缺失或点击不写偏好设置会让用户无法选择跟随系统或指定深浅色。 */ async () => {
    const wrapper = mount(ThemeToggle, { props: { shouldOnHover: true } });
    await nextTick();

    await wrapper.get('button').trigger('focus');
    await flushPromises();

    // 面板内容被传送到 body，按真实渲染出的三个预设选项核对顺序与选中态。
    const presets = [
      ...document.querySelectorAll<HTMLElement>('[data-reka-collection-item]'),
    ];
    expect(
      presets.map(
        /** 取出每个预设项真实渲染的主题值。 */ (item) =>
          item.getAttribute('value'),
      ),
    ).toEqual(['light', 'dark', 'auto']);
    // 当前是深色，深色项必须处于选中态。
    expect(presets[1]?.dataset.state).toBe('on');

    const autoPreset = presets[2];
    if (!autoPreset) {
      throw new Error('未找到跟随系统主题选项');
    }
    autoPreset.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(preferences.theme.mode).toBe('auto');
    const refreshed = document.querySelector<HTMLElement>('[value="auto"]');
    expect(refreshed?.dataset.state).toBe('on');
    wrapper.unmount();
  });
});
