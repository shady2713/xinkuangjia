/**
 * 文档提醒条（common-ui 的 components/doc-alert/doc-alert）真实行为回归。
 *
 * 提醒条按运行时配置的文档提醒开关决定是否出现，并把标题与文档地址展示给用户：开关判断
 * 写反会让不该出现的提示天天挡在页面顶部，地址点击不打开新窗口会让用户无法跳转文档，
 * 关闭按钮失效会让提示无法收起。用例真实挂载组件、真实点击文档地址与关闭图标，并断言
 * 真实 DOM 与浏览器开窗调用。
 *
 * 远程 Iconify 图标集合与浏览器开窗是本组件仅有的两个外部边界：测试环境不应联网取图标，
 * 因此把用到的两个图标离线登记；开窗只能观察到调用参数，所以接管 window.open。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { addIcon } from '@vben/icons';

import { afterEach, describe, expect, it, vi } from 'vitest';

import DocAlert from './doc-alert.vue';

// 离线登记组件用到的 mdi 图标，图标体用带专属类名的形状以便断言图标真的渲染出来。
addIcon('mdi:information-outline', {
  body: '<path class="DUMMY-icon-info" d="M0 0h1v1z"></path>',
  height: 24,
  width: 24,
});
addIcon('mdi:close', {
  body: '<path class="DUMMY-icon-close" d="M0 0h1v1z"></path>',
  height: 24,
  width: 24,
});

/**
 * 设置运行时文档提醒开关。
 * 组件在渲染期直接读取该运行时配置，因此每个用例必须按场景设置后再挂载。
 * @param enabled 文档提醒是否开启。
 */
function setDocAlertEnabled(enabled: boolean): void {
  (
    window as unknown as { _VBEN_ADMIN_PRO_APP_CONF_?: Record<string, string> }
  )._VBEN_ADMIN_PRO_APP_CONF_ = {
    VITE_APP_DOCALERT_ENABLE: String(enabled),
  };
}

afterEach(
  /** 清理运行时配置与开窗替身，避免影响其他用例。 */ () => {
    delete (window as { _VBEN_ADMIN_PRO_APP_CONF_?: unknown })
      ._VBEN_ADMIN_PRO_APP_CONF_;
    vi.restoreAllMocks();
  },
);

describe('文档提醒条渲染', /** 开关与内容决定用户能否看到并读懂文档入口。 */ () => {
  it('开关开启时渲染标题、文档地址与两个图标', /** 标题或地址丢字会让用户不知道这条提示指向哪份文档。 */ async () => {
    setDocAlertEnabled(true);
    const wrapper = mount(DocAlert, {
      props: {
        title: 'DUMMY-使用手册',
        url: 'https://DUMMY-doc.example.com/guide',
      },
    });

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('【DUMMY-使用手册】');
    expect(alert.text()).toContain(
      '文档地址：https://DUMMY-doc.example.com/guide',
    );
    // 地址是悬停提示的来源，缺失会让用户无法在点击前确认跳转目标。
    expect(wrapper.find('a').attributes('title')).toBe(
      'https://DUMMY-doc.example.com/guide',
    );
    // 图标在挂载后一个更新周期内取到数据，两个离线图标都必须真实渲染成 SVG。
    await nextTick();
    await vi.waitFor(
      /** 等待图标数据写入渲染结果，确认提醒条不是只剩文字。 */ () => {
        expect(wrapper.findAll('svg.iconify--mdi')).toHaveLength(2);
      },
    );
    expect(wrapper.find('.DUMMY-icon-info').exists()).toBe(true);
    expect(wrapper.find('.DUMMY-icon-close').exists()).toBe(true);
    wrapper.unmount();
  });

  it('开关关闭时整条提醒不渲染', /** 开关失效会让部署方无法关掉这条提示。 */ () => {
    setDocAlertEnabled(false);
    const wrapper = mount(DocAlert, {
      props: {
        title: 'DUMMY-使用手册',
        url: 'https://DUMMY-doc.example.com/guide',
      },
    });

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
    wrapper.unmount();
  });

  it('运行时未声明开关时不渲染', /** 缺少配置项时不得按开启处理，否则老部署会平白多出提示。 */ () => {
    const wrapper = mount(DocAlert, {
      props: {
        title: 'DUMMY-使用手册',
        url: 'https://DUMMY-doc.example.com/guide',
      },
    });

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('文档提醒条交互', /** 跳转与收起决定用户能否用这条提示继续工作。 */ () => {
  it('点击文档地址在新窗口打开该地址', /** 地址点击无响应会让用户以为文档链接坏了。 */ async () => {
    setDocAlertEnabled(true);
    const openSpy = vi
      .spyOn(window, 'open')
      .mockImplementation(
        /** 浏览器开窗无法在测试环境真实观察，只记录调用参数。 */ () => null,
      );
    const wrapper = mount(DocAlert, {
      props: {
        title: 'DUMMY-使用手册',
        url: 'https://DUMMY-doc.example.com/guide',
      },
    });

    await wrapper.find('a').trigger('click');

    // 走真实的 openWindow 链路：新窗口且带 noopener/noreferrer 防钓鱼跳转。
    expect(openSpy).toHaveBeenCalledWith(
      'https://DUMMY-doc.example.com/guide',
      '_blank',
      'noopener=yes,noreferrer=yes',
    );
    wrapper.unmount();
  });

  it('点击关闭图标后提醒条消失且不再响应开窗', /** 关闭无效会让提示永久占位，用户只能刷新页面。 */ async () => {
    setDocAlertEnabled(true);
    const openSpy = vi
      .spyOn(window, 'open')
      .mockImplementation(
        /** 浏览器开窗无法在测试环境真实观察，只记录调用参数。 */ () => null,
      );
    const wrapper = mount(DocAlert, {
      props: {
        title: 'DUMMY-使用手册',
        url: 'https://DUMMY-doc.example.com/guide',
      },
    });

    // 关闭图标在挂载后的更新周期才会渲染出图元，先等它出现再点击。
    await nextTick();
    await vi.waitFor(
      /** 等待关闭图标渲染，确保点击的是用户真正看到的元素。 */ () => {
        expect(wrapper.find('.DUMMY-icon-close').exists()).toBe(true);
      },
    );
    await wrapper.find('.DUMMY-icon-close').trigger('click');

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
    expect(openSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
