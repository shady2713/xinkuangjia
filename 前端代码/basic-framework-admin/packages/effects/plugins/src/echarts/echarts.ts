/**
 * ECharts 按需装配：注册柱状、折线、漏斗、仪表盘、地图、饼图、雷达等图表，
 * 以及标题、提示框、数据集、缩放、图例、工具栏、视觉映射等组件与画布渲染器。
 * 同时导出组合后的 ECOption 类型；业务侧应复用本模块实例，不要重复注册。
 */
import type {
  // 系列类型的定义后缀都为 SeriesOption
  BarSeriesOption,
  GaugeSeriesOption,
  LineSeriesOption,
  MapSeriesOption,
} from 'echarts/charts';
import type {
  DatasetComponentOption,
  DataZoomComponentOption,
  GeoComponentOption,
  GridComponentOption,
  // 组件类型的定义后缀都为 ComponentOption
  TitleComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components';
import type { ComposeOption } from 'echarts/core';

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
  // 数据集组件
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
  // 内置数据转换器组件 (filter, sort)
  TransformComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

/** 本项目按需打包的 ECharts 图表配置类型：只包含已注册的图表与组件，避免全量引入 echarts。 */
// 通过 ComposeOption 来组合出一个只有必须组件和图表的 Option 类型
export type ECOption = ComposeOption<
  | BarSeriesOption
  | DatasetComponentOption
  | DataZoomComponentOption
  | GaugeSeriesOption
  | GeoComponentOption
  | GridComponentOption
  | LineSeriesOption
  | MapSeriesOption
  | TitleComponentOption
  | TooltipComponentOption
  | VisualMapComponentOption
>;

// 注册必须的组件
echarts.use([
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
]);

export default echarts;
