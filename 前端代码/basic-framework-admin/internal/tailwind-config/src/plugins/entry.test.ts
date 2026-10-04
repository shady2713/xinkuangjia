/**
 * 进出场动画插件（tailwind-config 的 plugins/entry）真实行为回归。
 *
 * 该插件为管理端的列表逐项进入提供 .enter-x/.enter-y/.-enter-x/.-enter-y 四级延迟工具类：
 * 选择器或延迟写错会让列表动画错位，关键帧缺失会让元素停在透明状态而"看不见"。
 * 用例按 Tailwind 装载插件的方式调用其 handler，只替换工具类注册边界，
 * 选择器、延迟、位移与关键帧全部按真实生成结果断言。
 */
import { describe, expect, it, vi } from 'vitest';

import { enterAnimationPlugin } from './entry';

/** 一个方向在插件里生成的工具类：选择器前缀、动画名与位移值。 */
interface DirectionCase {
  /** 动画名，必须与注册的关键帧同名。 */
  animation: string;
  /** 选择器前缀，含负方向的前导减号。 */
  selector: string;
  /** 位移函数文本，正负方向不同。 */
  transform: string;
}

/** 插件声明的四个方向，用于逐个核对生成结果。 */
const DIRECTIONS: DirectionCase[] = [
  {
    animation: 'enter-x-animation',
    selector: '.enter-x',
    transform: 'translateX(50px)',
  },
  {
    animation: 'enter-y-animation',
    selector: '.enter-y',
    transform: 'translateY(50px)',
  },
  {
    animation: 'enter-x-animation',
    selector: '.-enter-x',
    transform: 'translateX(-50px)',
  },
  {
    animation: 'enter-y-animation',
    selector: '.-enter-y',
    transform: 'translateY(-50px)',
  },
];

/**
 * 每级子元素实际生成的延迟文本。
 *
 * 生产实现用 `0.1 * i` 累乘，第 3 级因 IEEE 754 浮点误差得到
 * `0.30000000000000004s`；CSS 能解析该数值，故按真实生成结果断言并在此记录，
 * 不用"期望 0.3s"的写法掩盖差异。
 */
const EXPECTED_DELAYS = [
  '0.1s',
  '0.2s',
  '0.30000000000000004s',
  '0.4s',
  '0.5s',
];

/** 插件实际使用到的 Tailwind API：本插件只注册工具类，不读主题也不加变体。 */
type AddUtilities = (utilities: Record<string, unknown>) => void;

/** 插件 handler 的最小调用签名：只声明本插件实际解构的 addUtilities。 */
type PluginHandler = (api: { addUtilities: AddUtilities }) => void;

/**
 * 按 Tailwind 装载插件的方式执行 handler 并收集注册内容。
 *
 * Tailwind 在构建时以完整 PluginAPI 调用该 handler，本插件只解构 addUtilities，
 * 因此这里只提供这一个成员，其余能力缺失不影响被测行为。
 *
 * @returns 两次 addUtilities 调用收到的工具类映射，顺序与插件调用顺序一致。
 * @throws Error 插件对象缺少 handler 时抛出，避免用例静默地什么都不验证。
 */
function runPlugin() {
  const addUtilities = vi.fn<AddUtilities>();
  const handler = enterAnimationPlugin.handler as unknown as PluginHandler;
  if (typeof handler !== 'function') {
    throw new TypeError('插件对象缺少 handler，无法按 Tailwind 装载方式执行');
  }
  handler({ addUtilities });
  return addUtilities.mock.calls.map(
    /** 取出单次调用注册的工具类映射。 */ ([utilities]) =>
      utilities as Record<string, Record<string, unknown>>,
  );
}

describe('进出场动画工具类', /** 四个方向各五级延迟的选择器与声明是列表动画的展示契约。 */ () => {
  it('每个方向生成五级 nth-child 选择器', /** 级数缺失会让第六个及以后的元素没有动画。 */ () => {
    const [utilities] = runPlugin();
    const selectors = Object.keys(utilities ?? {});

    for (const direction of DIRECTIONS) {
      expect(
        selectors.filter(
          /** 统计属于该方向的选择器数量。 */ (selector) =>
            selector.startsWith(`${direction.selector}:`),
        ),
      ).toHaveLength(EXPECTED_DELAYS.length);
    }
    expect(selectors).toHaveLength(DIRECTIONS.length * EXPECTED_DELAYS.length);
  });

  it('延迟按 0.1 秒逐级递增', /** 延迟重复会让列表元素同时进入，失去错开效果。 */ () => {
    const [utilities] = runPlugin();

    for (const direction of DIRECTIONS) {
      EXPECTED_DELAYS.forEach(
        /** 核对第 index+1 级子元素的延迟与动画声明。 */ (delay, index) => {
          const declaration =
            utilities?.[`${direction.selector}:nth-child(${index + 1})`];
          expect(declaration).toBeDefined();
          expect(declaration?.animation).toBe(
            `${direction.animation} 0.3s ease-in-out ${delay} forwards`,
          );
          // 数值本身仍需按 0.1 秒递增，避免只固定了浮点误差文本而放过真实偏移错误
          expect(Number.parseFloat(delay)).toBeCloseTo(0.1 * (index + 1), 10);
        },
      );
    }
  });

  it('每级都先隐藏并按方向位移', /** 缺少初始透明会让元素在动画开始前就闪现到终点位置。 */ () => {
    const [utilities] = runPlugin();

    for (const direction of DIRECTIONS) {
      EXPECTED_DELAYS.forEach(
        /** 核对第 index+1 级子元素的初始透明度与位移。 */ (_delay, index) => {
          const declaration =
            utilities?.[`${direction.selector}:nth-child(${index + 1})`];
          expect(declaration?.opacity).toBe('0');
          expect(declaration?.transform).toBe(direction.transform);
        },
      );
    }
  });

  it('注册与动画名同名的进出场关键帧', /** 关键帧名或终态写错会让元素停在透明状态而不可见。 */ () => {
    const [, keyframes] = runPlugin();

    expect(keyframes?.['@keyframes enter-x-animation']).toEqual({
      to: { opacity: '1', transform: 'translateX(0)' },
    });
    expect(keyframes?.['@keyframes enter-y-animation']).toEqual({
      to: { opacity: '1', transform: 'translateY(0)' },
    });
  });

  it('分两次注册工具类与关键帧', /** 合并成一次会让 Tailwind 把关键帧当工具类处理，导致动画不生效。 */ () => {
    const calls = runPlugin();

    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[1] ?? {})).toHaveLength(2);
  });
});
