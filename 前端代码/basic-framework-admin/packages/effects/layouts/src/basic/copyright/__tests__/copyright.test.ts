/** 页脚版权与备案信息展示测试：验证公司名、备案号与链接在各类配置下的真实渲染。 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Copyright from '../copyright.vue';

describe('copyright', /** 页脚展示由配置驱动，链接与兜底文案必须与配置一一对应。 */ () => {
  it('renders the company name as plain text when no companySiteLink is provided', () => {
    const wrapper = mount(Copyright, {
      props: {
        companyName: '基础框架',
        companySiteLink: '',
      },
    });

    expect(wrapper.text()).toContain('基础框架');
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('renders the company name as a link when companySiteLink is provided', () => {
    const wrapper = mount(Copyright, {
      props: {
        companyName: '基础框架',
        companySiteLink: 'https://example.com',
      },
    });

    const link = wrapper.find('a');

    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('基础框架');
    expect(link.attributes('href')).toBe('https://example.com');
  });

  it('备案号缺少跳转链接时使用无跳转占位地址', /** 备案信息必须展示，但没有链接时不能让浏览器跳到空地址或当前页。 */ () => {
    const wrapper = mount(Copyright, {
      props: {
        companyName: '基础框架',
        icp: '京ICP备00000000号',
      },
    });

    const link = wrapper.find('a');

    expect(link.text()).toBe('京ICP备00000000号');
    expect(link.attributes('href')).toBe('javascript:void(0)');
    expect(link.attributes('target')).toBe('_blank');
  });

  it('备案号带有跳转链接时使用真实地址', /** 工信部备案查询地址必须原样输出，不能被占位地址覆盖。 */ () => {
    const wrapper = mount(Copyright, {
      props: {
        companyName: '基础框架',
        icp: '京ICP备00000000号',
        icpLink: 'https://beian.miit.gov.cn/',
      },
    });

    expect(wrapper.find('a').attributes('href')).toBe(
      'https://beian.miit.gov.cn/',
    );
  });

  it('未配置备案号时不渲染备案链接', /** 无备案号的国家或环境不能出现死链接。 */ () => {
    const wrapper = mount(Copyright, { props: { companyName: '基础框架' } });

    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('缺少公司名称时不渲染公司与备案区块，只保留版权年份', /** 公司名与地址成对出现，缺名称时不能输出空白区域。 */ () => {
    const wrapper = mount(Copyright, {
      props: {
        companyName: '',
        companySiteLink: 'https://example.com',
        date: '2026',
      },
    });

    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).toContain('2026');
  });
});
