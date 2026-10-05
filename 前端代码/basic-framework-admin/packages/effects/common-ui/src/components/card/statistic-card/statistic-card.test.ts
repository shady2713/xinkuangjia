/**
 * 统计卡片（common-ui 的 components/card/statistic-card/statistic-card）真实行为回归。
 *
 * 卡片展示单项指标与环比：数值、小数位与前缀写错会让运营读到错误的经营数字，环比正负
 * 判断反了会让上涨显示成下跌（并配错颜色与箭头），缺失小数位或前缀未兜底会让指标格式
 * 与其它卡片不一致，提示信息未按需渲染会让卡片多出一个无意义的问号。用例真实挂载卡片、
 * 真实打开提示气泡、真实等待数字滚动结束，并断言真实 DOM 中的数值、配色与箭头。
 *
 * 远程或内置的 Iconify 图标集合与数字滚动动画是外部边界：测试环境不应联网取图标，因此把
 * 用到的三个 lucide 图标离线登记并给每个图标一个专属形状，用于核对卡片到底选了哪个箭头。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { addIcon } from '@vben/icons';

import { afterEach, describe, expect, it, vi } from 'vitest';

import StatisticCard from './statistic-card.vue';

/** 离线登记的图标名到专属形状类名的映射，形状类名用于断言卡片选择了哪个图标。 */
const ICON_BODY_CLASS: Record<string, string> = {
  'lucide:circle-alert': 'DUMMY-icon-alert',
  'lucide:trending-down': 'DUMMY-icon-down',
  'lucide:trending-up': 'DUMMY-icon-up',
};

for (const [name, className] of Object.entries(ICON_BODY_CLASS)) {
  addIcon(name, {
    body: `<path class="${className}" d="M0 0h1v1z"></path>`,
    height: 24,
    width: 24,
  });
}

afterEach(
  /** 清理提示气泡的传送节点，避免残留影响后续用例。 */ () => {
    document.body.innerHTML = '';
  },
);

describe('统计卡片数值展示', /** 数值格式决定运营读到的是不是真实经营数据。 */ () => {
  it('按前缀与小数位滚动到结束值', /** 前缀或小数位丢失会让指标金额少算精度。 */ async () => {
    const wrapper = mount(StatisticCard, {
      props: {
        decimals: 2,
        percent: 12.345,
        prefix: '¥',
        title: 'DUMMY-销售额',
        value: 1234.5,
      },
    });

    await vi.waitFor(
      /** 等待滚动动画把数值带到结束值，再核对前缀与小数位。 */ () => {
        expect(wrapper.text()).toContain('¥1,234.50');
      },
      { timeout: 5000 },
    );
    expect(wrapper.text()).toContain('DUMMY-销售额');
    // 环比按两位小数展示绝对值，正负由箭头与颜色表达。
    expect(wrapper.text()).toContain('12.35%');
    // 未传环比标签时使用组件默认的「环比」。
    expect(wrapper.text()).toContain('环比');
    wrapper.unmount();
  });

  it('未传入数值与小数位时按零渲染', /** 缺失数值未兜底会让卡片显示 undefined 或空白。 */ () => {
    const wrapper = mount(StatisticCard, { props: { title: 'DUMMY-访问量' } });

    expect(wrapper.text()).toContain('0');
    // 未传环比时按 0 处理，不显示成 NaN。
    expect(wrapper.text()).toContain('0.00%');
    expect(wrapper.text()).not.toContain('NaN');
    wrapper.unmount();
  });

  it('按调用方传入的标签展示环比名称', /** 标签写死会让同比等口径显示成环比。 */ () => {
    const wrapper = mount(StatisticCard, {
      props: { percent: 1, percentLabel: 'DUMMY-同比', title: 'DUMMY-访问量' },
    });

    expect(wrapper.text()).toContain('DUMMY-同比');
    expect(wrapper.text()).not.toContain('环比');
    wrapper.unmount();
  });
});

describe('统计卡片环比方向', /** 方向决定运营判断指标是在变好还是变差。 */ () => {
  it('环比为正时显示上涨箭头与警示配色', /** 方向判断反了会让上涨显示成下跌。 */ async () => {
    const wrapper = mount(StatisticCard, {
      props: { percent: 8, title: 'DUMMY-访问量', value: 10 },
    });

    await nextTick();
    await vi.waitFor(
      /** 等待上涨箭头渲染，确认方向与图标一致。 */ () => {
        expect(wrapper.find('.DUMMY-icon-up').exists()).toBe(true);
      },
    );
    expect(wrapper.find('.DUMMY-icon-down').exists()).toBe(false);
    expect(wrapper.find('span.text-destructive').exists()).toBe(true);
    wrapper.unmount();
  });

  it('环比为负时显示下跌箭头与安全配色', /** 方向判断反了会让下跌显示成上涨。 */ async () => {
    const wrapper = mount(StatisticCard, {
      props: { percent: -7.5, title: 'DUMMY-访问量', value: 10 },
    });

    await nextTick();
    await vi.waitFor(
      /** 等待下跌箭头渲染，确认方向与图标一致。 */ () => {
        expect(wrapper.find('.DUMMY-icon-down').exists()).toBe(true);
      },
    );
    expect(wrapper.find('.DUMMY-icon-up').exists()).toBe(false);
    expect(wrapper.find('span.text-emerald-600').exists()).toBe(true);
    // 负数按绝对值展示并统一保留两位小数，符号交给箭头表达。
    expect(wrapper.text()).toContain('7.50%');
    expect(wrapper.text()).not.toContain('-7.50%');
    wrapper.unmount();
  });

  it('环比字符串同样参与数值判断', /** 后端返回字符串时判断失效会让环比永远显示为下跌。 */ async () => {
    const wrapper = mount(StatisticCard, {
      props: { percent: '3.5', title: 'DUMMY-访问量', value: 10 },
    });

    await nextTick();
    await vi.waitFor(
      /** 等待字符串环比也渲染出上涨箭头。 */ () => {
        expect(wrapper.find('.DUMMY-icon-up').exists()).toBe(true);
      },
    );
    expect(wrapper.text()).toContain('3.50%');
    wrapper.unmount();
  });
});

describe('统计卡片提示信息', /** 提示信息决定用户能否看懂指标口径。 */ () => {
  it('传入提示信息时渲染问号入口并在打开后显示提示文案', /** 提示内容未渲染会让用户看不到指标口径。 */ async () => {
    const wrapper = mount(StatisticCard, {
      props: {
        title: 'DUMMY-访问量',
        tooltip: 'DUMMY-统计口径为去重后的独立访客',
        value: 10,
      },
    });

    const trigger = wrapper.find('button');
    expect(trigger.exists()).toBe(true);
    await nextTick();
    await vi.waitFor(
      /** 等待问号图标渲染，确认提示入口真实存在。 */ () => {
        expect(wrapper.find('.DUMMY-icon-alert').exists()).toBe(true);
      },
    );

    // 提示气泡挂在传送节点上，用真实焦点事件打开后再读取真实文案。
    await trigger.trigger('focus');
    await vi.waitFor(
      /** 等待提示气泡渲染出真实文案。 */ () => {
        expect(document.body.textContent).toContain(
          'DUMMY-统计口径为去重后的独立访客',
        );
      },
    );
    wrapper.unmount();
  });

  it('未传入提示信息时不渲染问号入口', /** 无口径说明却渲染问号会让用户点开一个空气泡。 */ () => {
    const wrapper = mount(StatisticCard, {
      props: { title: 'DUMMY-访问量', value: 10 },
    });

    expect(wrapper.find('button').exists()).toBe(false);
    // 环比行本身仍会渲染方向箭头，这里只确认没有多出提示入口。
    expect(wrapper.find('.DUMMY-icon-alert').exists()).toBe(false);
    wrapper.unmount();
  });
});
