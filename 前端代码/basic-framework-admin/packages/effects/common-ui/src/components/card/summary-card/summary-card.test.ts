/**
 * 概览统计卡片（common-ui 的 components/card/summary-card/summary-card）真实行为回归。
 *
 * 卡片展示单项指标的图标、标题、数值与涨跌：图标缺失仍渲染空色块会让卡片出现无意义的
 * 方块，数值、前缀与小数位未兜底会让指标显示成 undefined，涨跌箭头与配色判断反了会让
 * 用户把下跌看成上涨，缺失的环比未加判断会渲染出 NaN%，提示信息未按需渲染会多出一个
 * 点不开的问号。用例真实挂载卡片、真实打开提示气泡、真实等待数字滚动结束并断言真实 DOM。
 *
 * 内置 Iconify 图标集合与数字滚动动画是外部边界：测试环境不应联网取图标，因此把用到的
 * lucide 图标离线登记并给每个图标一个专属形状，用于核对卡片到底选了哪个箭头。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { addIcon } from '@vben/icons';

import { afterEach, describe, expect, it, vi } from 'vitest';

import SummaryCard from './summary-card.vue';

/** 离线登记的图标名到专属形状类名的映射，形状类名用于断言卡片选择了哪个图标。 */
const ICON_BODY_CLASS: Record<string, string> = {
  'lucide:chevron-down': 'DUMMY-icon-down',
  'lucide:chevron-up': 'DUMMY-icon-up',
  'lucide:circle-alert': 'DUMMY-icon-alert',
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

/**
 * 组件形态的图标替身。
 * 组件形态图标必须按组件渲染，这里用带专属类名的节点便于核对渲染结果。
 * @returns 图标组件的虚拟节点。
 */
function customIcon() {
  return h('span', { class: 'DUMMY-custom-icon' }, 'DUMMY-图标');
}

describe('概览卡片主体', /** 图标、标题与数值决定用户能否读懂这张卡片的指标。 */ () => {
  it('渲染图标配色、标题与带前缀小数的数值', /** 前缀或小数位丢失会让指标金额少算精度。 */ async () => {
    const wrapper = mount(SummaryCard, {
      props: {
        decimals: 2,
        icon: 'lucide:activity',
        iconBgColor: 'DUMMY-图标底色',
        iconColor: 'DUMMY-图标颜色',
        prefix: '¥',
        title: 'DUMMY-销售额',
        value: 1234.5,
      },
    });

    const iconBox = wrapper.find('div.flex.h-12');
    expect(iconBox.classes()).toContain('DUMMY-图标颜色');
    expect(iconBox.classes()).toContain('DUMMY-图标底色');
    expect(wrapper.text()).toContain('DUMMY-销售额');
    await vi.waitFor(
      /** 等待滚动动画把数值带到结束值，再核对前缀与小数位。 */ () => {
        expect(wrapper.text()).toContain('¥1,234.50');
      },
      { timeout: 5000 },
    );
    // 字符串图标必须渲染出真实图元。
    expect(iconBox.find('svg.iconify--lucide').exists()).toBe(true);
    wrapper.unmount();
  });

  it('图标为组件形态时渲染调用方传入的组件', /** 组件形态图标被当成字符串处理会让图标整块消失。 */ () => {
    const wrapper = mount(SummaryCard, {
      props: {
        icon: customIcon,
        title: 'DUMMY-销售额',
        value: 1,
      },
    });

    expect(wrapper.find('.DUMMY-custom-icon').text()).toBe('DUMMY-图标');
    wrapper.unmount();
  });

  it('未传入图标时不渲染图标容器', /** 无图标仍渲染空色块会让卡片出现无意义的方块。 */ () => {
    const wrapper = mount(SummaryCard, {
      props: { title: 'DUMMY-销售额', value: 1 },
    });

    expect(wrapper.find('div.flex.h-12').exists()).toBe(false);
    expect(wrapper.text()).toContain('DUMMY-销售额');
    wrapper.unmount();
  });

  it('未传入数值与小数位时按零渲染', /** 缺失数值未兜底会让卡片显示 undefined。 */ () => {
    const wrapper = mount(SummaryCard, { props: { title: 'DUMMY-销售额' } });

    expect(wrapper.text()).toContain('0');
    expect(wrapper.text()).not.toContain('NaN');
    expect(wrapper.text()).not.toContain('undefined');
    wrapper.unmount();
  });
});

describe('概览卡片涨跌', /** 涨跌判断与颜色决定用户对指标趋势的第一印象。 */ () => {
  it('涨跌为正时显示上涨箭头与警示配色', /** 方向判断反了会让上涨显示成下跌。 */ async () => {
    const wrapper = mount(SummaryCard, {
      props: { percent: 5, title: 'DUMMY-销售额', value: 10 },
    });

    await nextTick();
    await vi.waitFor(
      /** 等待上涨箭头渲染，确认方向与图标一致。 */ () => {
        expect(wrapper.find('.DUMMY-icon-up').exists()).toBe(true);
      },
    );
    expect(wrapper.find('.DUMMY-icon-down').exists()).toBe(false);
    expect(wrapper.find('span.text-destructive').exists()).toBe(true);
    expect(wrapper.text()).toContain('5%');
    wrapper.unmount();
  });

  it('涨跌为负时显示下跌箭头并按绝对值展示', /** 负数带上负号又配下跌箭头会让人重复计算跌幅。 */ async () => {
    const wrapper = mount(SummaryCard, {
      props: { percent: -7.5, title: 'DUMMY-销售额', value: 10 },
    });

    await nextTick();
    await vi.waitFor(
      /** 等待下跌箭头渲染，确认方向与图标一致。 */ () => {
        expect(wrapper.find('.DUMMY-icon-down').exists()).toBe(true);
      },
    );
    expect(wrapper.find('.DUMMY-icon-up').exists()).toBe(false);
    expect(wrapper.find('span.text-emerald-600').exists()).toBe(true);
    expect(wrapper.text()).toContain('7.5%');
    expect(wrapper.text()).not.toContain('-7.5%');
    wrapper.unmount();
  });

  it('涨跌为零时按持平方向渲染', /** 零被当成上涨会让持平的指标显示成增长。 */ async () => {
    const wrapper = mount(SummaryCard, {
      props: { percent: 0, title: 'DUMMY-销售额', value: 10 },
    });

    await nextTick();
    await vi.waitFor(
      /** 等待持平方向箭头渲染。 */ () => {
        expect(wrapper.find('.DUMMY-icon-down').exists()).toBe(true);
      },
    );
    expect(wrapper.find('.DUMMY-icon-up').exists()).toBe(false);
    expect(wrapper.text()).toContain('0%');
    wrapper.unmount();
  });

  it('未传入涨跌时不渲染环比', /** 缺失环比未加判断会渲染出 NaN% 或一个空箭头。 */ () => {
    const wrapper = mount(SummaryCard, {
      props: { title: 'DUMMY-销售额', value: 10 },
    });

    expect(wrapper.find('.DUMMY-icon-up').exists()).toBe(false);
    expect(wrapper.find('.DUMMY-icon-down').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('%');
    wrapper.unmount();
  });
});

describe('概览卡片提示信息', /** 提示信息决定用户能否看懂指标口径。 */ () => {
  it('传入提示信息时渲染问号入口并在打开后显示提示文案', /** 提示内容未渲染会让用户看不到指标口径。 */ async () => {
    const wrapper = mount(SummaryCard, {
      props: {
        title: 'DUMMY-销售额',
        tooltip: 'DUMMY-统计口径为已支付订单金额',
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
          'DUMMY-统计口径为已支付订单金额',
        );
      },
    );
    wrapper.unmount();
  });

  it('未传入提示信息时不渲染问号入口', /** 无口径说明却渲染问号会让用户点开一个空气泡。 */ () => {
    const wrapper = mount(SummaryCard, {
      props: { title: 'DUMMY-销售额', value: 10 },
    });

    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('.DUMMY-icon-alert').exists()).toBe(false);
    wrapper.unmount();
  });
});
