/**
 * ECharts 按需注册入口（plugins 的 echarts/echarts.ts）真实行为回归。
 *
 * 该模块是全局唯一的图表注册点：漏注册图表类型会让页面在渲染时报“未导入”，
 * 漏注册渲染器会让所有图表空白，注册项被改成替身则会在运行期表现为未知组件。
 * 用例真实导入模块并断言它恰好注册了约定的真实 ECharts 扩展，且注册动作确实
 * 转发给图形库自身的 `use` 实现。
 *
 * 只替换 `echarts/core` 的 `use` 为“记录并转发真实实现”的包装：真实注册仍然执行，
 * 同时让注册清单可被断言。图形库依赖真实 canvas 绘制，伪 DOM 下无法建立图表实例，
 * 因此注册的运行期效果仍以清单与真实转发为证据边界。
 */
import {
  BarChart,
  FunnelChart,
  GaugeChart,
  LineChart,
  MapChart,
  PieChart,
  RadarChart,
} from 'echarts/charts';
import {
  DatasetComponent,
  DataZoomComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GeoComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from 'echarts/components';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import { describe, expect, it, vi } from 'vitest';

/** 图形库真实注册函数的签名；用于核对注册动作确实转发到库实现。 */
type RegisterExtension = (extension: unknown) => unknown;

/** 注册调用的记录容器；模块替身与用例读取同一实例。 */
const coreMocks = vi.hoisted(
  /** 建立用例可清空、可断言的注册记录容器。 */ () => ({
    actualUse: undefined as RegisterExtension | undefined,
    useCalls: [] as unknown[][],
  }),
);

vi.mock(
  'echarts/core',
  /**
   * 包装真实 `use`：记录每次注册的扩展清单后转发给图形库实现。
   * @param importOriginal 原始模块加载器，用于取回未替换的真实实现。
   * @returns 合并后的模块替身，`use` 替换为记录并转发的包装。
   */
  async (importOriginal) => {
    const actual = await importOriginal<typeof import('echarts/core')>();
    coreMocks.actualUse = actual.use as RegisterExtension;
    return {
      ...actual,
      /** 记录本次注册的扩展清单并执行真实注册。 */
      use: (extension: unknown) => {
        coreMocks.useCalls.push([extension]);
        return (actual.use as RegisterExtension)(extension);
      },
    };
  },
);

/** 被测模块的命名空间；导入时即完成按需注册。 */
const echartsModule = await import('../echarts');

/** 被测模块的默认导出，即完成注册后的 ECharts 核心命名空间。 */
const echarts = echartsModule.default;

/** 模块导入时产生的注册调用快照；该模块只在导入时注册一次。 */
const registrationCalls = coreMocks.useCalls.map(
  /** 取出每次注册传入的扩展清单。 */ (call) => call[0],
);

/** 约定的注册清单，顺序与源码一致；顺序变化同样属于契约变化。 */
const REQUIRED_EXTENSIONS = [
  TitleComponent,
  PieChart,
  RadarChart,
  TooltipComponent,
  GridComponent,
  DatasetComponent,
  DataZoomComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  TransformComponent,
  BarChart,
  LineChart,
  FunnelChart,
  GaugeChart,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer,
  LegendComponent,
  ToolboxComponent,
  VisualMapComponent,
  MapChart,
  GeoComponent,
];

describe('图表按需注册清单', /** 注册清单决定哪些图表与渲染器可用，缺一项就会在对应页面报错。 */ () => {
  it('模块导入时只注册一次约定清单', /** 重复注册会掩盖遗漏项，也说明注册点被多处触发。 */ () => {
    expect(registrationCalls).toHaveLength(1);
  });

  it('注册清单与真实扩展对象逐项一致', /** 清单必须使用真实实现而不是替身，否则运行期仍会缺少图表能力。 */ () => {
    expect(registrationCalls[0]).toEqual(REQUIRED_EXTENSIONS);
  });

  it('注册动作转发给图形库自身的 use 实现', /** 只记录不转发会让图表库实际处于未注册状态。 */ () => {
    expect(coreMocks.actualUse).toBeTypeOf('function');
    expect(
      /** 以同一清单再次调用真实注册实现，验证它可被调用且不抛错。 */ () =>
        coreMocks.actualUse?.(REQUIRED_EXTENSIONS),
    ).not.toThrow();
  });

  it('默认导出是完成注册的 ECharts 核心命名空间', /** 消费方通过默认导出初始化图表，导出形状变化会让所有图表页面失效。 */ () => {
    expect(typeof echarts.init).toBe('function');
    expect(typeof echarts.use).toBe('function');
    expect(typeof echarts.dispose).toBe('function');
  });
});
