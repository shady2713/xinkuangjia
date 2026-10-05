/**
 * 偏好设置-版权区块（preferences/blocks/layout/copyright.vue）真实交互回归。
 *
 * 版权区块用一个开关加五个输入项维护页脚版权信息：开关写回断开会让版权栏开关点了没反应，
 * 输入项写回断开会让用户填的公司名、备案号丢失，禁用联动失效会让版权未开启时仍能改动无效字段。
 * 用例真实点击开关行、在真实输入框里逐个输入并断言写回载荷、输入框取值与禁用联动。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import InputItem from '../input-item.vue';
import SwitchItem from '../switch-item.vue';
import Copyright from './copyright.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：该宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

beforeAll(
  /** 按真实 API 装载中文语言包，输入项文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起六个版权偏好。
 * @param enable 初始是否启用版权。
 * @returns 六个偏好项的本地状态与已挂载宿主。
 */
function mountCopyright(enable = false) {
  const copyrightEnable = ref(enable);
  const copyrightCompanyName = ref('');
  const copyrightCompanySiteLink = ref('');
  const copyrightDate = ref('2024');
  const copyrightIcp = ref('');
  const copyrightIcpLink = ref('');
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的版权区块。
       * @returns 渲染函数，返回绑定到本地状态的版权区块。
       */
      setup() {
        return /** 返回绑定到本地状态的版权区块。 */ () =>
          h(Copyright, {
            copyrightCompanyName: copyrightCompanyName.value,
            copyrightCompanySiteLink: copyrightCompanySiteLink.value,
            copyrightDate: copyrightDate.value,
            copyrightEnable: copyrightEnable.value,
            copyrightIcp: copyrightIcp.value,
            copyrightIcpLink: copyrightIcpLink.value,
            /** 写回启用版权开关。 */
            'onUpdate:copyrightEnable': (value: boolean | undefined) => {
              copyrightEnable.value = value ?? false;
            },
            /** 写回公司名。 */
            'onUpdate:copyrightCompanyName': (value: string | undefined) => {
              copyrightCompanyName.value = value ?? '';
            },
            /** 写回公司主页。 */
            'onUpdate:copyrightCompanySiteLink': (
              value: string | undefined,
            ) => {
              copyrightCompanySiteLink.value = value ?? '';
            },
            /** 写回版权日期。 */
            'onUpdate:copyrightDate': (value: string | undefined) => {
              copyrightDate.value = value ?? '2024';
            },
            /** 写回 ICP 备案号。 */
            'onUpdate:copyrightIcp': (value: string | undefined) => {
              copyrightIcp.value = value ?? '';
            },
            /** 写回 ICP 网站链接。 */
            'onUpdate:copyrightIcpLink': (value: string | undefined) => {
              copyrightIcpLink.value = value ?? '';
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return {
    copyrightCompanyName,
    copyrightCompanySiteLink,
    copyrightDate,
    copyrightEnable,
    copyrightIcp,
    copyrightIcpLink,
    wrapper,
  };
}

describe('版权偏好', /** 开关、输入与禁用联动决定页脚版权信息能否被正确维护。 */ () => {
  it('渲染一个开关与五个输入项并显示真实取值', /** 输入项漏渲染会让用户改不了对应的版权字段。 */ () => {
    const { wrapper } = mountCopyright(true);
    const rows = wrapper.findAllComponents(SwitchItem);
    const items = wrapper.findAllComponents(InputItem);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.text()).toBe('启用版权');
    expect(items).toHaveLength(5);
    expect(items[0]?.text()).toContain('公司名');
    expect(items[1]?.text()).toContain('公司主页');
    expect(items[2]?.text()).toContain('日期');
    expect(items[3]?.text()).toContain('ICP 备案号');
    expect(items[4]?.text()).toContain('ICP 网站链接');
    expect(
      (wrapper.findAll('input')[2]?.element as HTMLInputElement).value,
    ).toBe('2024');
  });

  it('版权未开启时五个输入项全部置灰', /** 禁用失效会让用户改动不会随页面展示的版权字段。 */ () => {
    const { wrapper } = mountCopyright(false);
    const rows = wrapper.findAllComponents(SwitchItem);
    const items = wrapper.findAllComponents(InputItem);

    expect(rows[0]?.classes()).not.toContain('pointer-events-none');
    expect(
      items.map(
        /** 收集每个输入项的禁用样式类，逐项核对。 */ (item) =>
          item.classes().includes('pointer-events-none'),
      ),
    ).toEqual([true, true, true, true, true]);
  });

  it('点击开关开启版权并解除输入项置灰', /** 写回断开会让用户打开版权后仍填不了任何字段。 */ async () => {
    const { copyrightEnable, wrapper } = mountCopyright(false);
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[0]?.trigger('click');

    expect(copyrightEnable.value).toBe(true);
    expect(wrapper.findAllComponents(InputItem)[0]?.classes()).not.toContain(
      'pointer-events-none',
    );
  });

  it('在五个输入框里输入并写回各自取值', /** 输入不回写会让用户填写的版权信息全部丢失。 */ async () => {
    const {
      copyrightCompanyName,
      copyrightCompanySiteLink,
      copyrightDate,
      copyrightIcp,
      copyrightIcpLink,
      wrapper,
    } = mountCopyright(true);
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(5);
    await inputs[0]?.setValue('DUMMY-公司名');
    await inputs[1]?.setValue('https://DUMMY.example.com');
    await inputs[2]?.setValue('2025');
    await inputs[3]?.setValue('DUMMY-ICP备案号');
    await inputs[4]?.setValue('https://DUMMY.beian.example.com');

    expect(copyrightCompanyName.value).toBe('DUMMY-公司名');
    expect(copyrightCompanySiteLink.value).toBe('https://DUMMY.example.com');
    expect(copyrightDate.value).toBe('2025');
    expect(copyrightIcp.value).toBe('DUMMY-ICP备案号');
    expect(copyrightIcpLink.value).toBe('https://DUMMY.beian.example.com');
    expect(
      (wrapper.findAll('input')[3]?.element as HTMLInputElement).value,
    ).toBe('DUMMY-ICP备案号');
  });

  it('父级禁用时开关与输入项都置灰', /** 不适用版权的布局里仍可编辑会让用户改出无效配置。 */ () => {
    const wrapper = mount(Copyright, {
      props: { copyrightEnable: true, disabled: true },
    });
    mounted = wrapper;
    const rows = wrapper.findAllComponents(SwitchItem);
    const items = wrapper.findAllComponents(InputItem);

    expect(rows[0]?.classes()).toContain('pointer-events-none');
    expect(items[0]?.classes()).toContain('pointer-events-none');
    expect(items[4]?.classes()).toContain('pointer-events-none');
  });
});
