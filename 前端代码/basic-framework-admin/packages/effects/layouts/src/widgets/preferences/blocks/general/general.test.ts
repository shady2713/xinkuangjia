/**
 * 偏好设置-通用配置（widgets/preferences/blocks/general/general.vue）真实交互回归。
 *
 * 该配置块承载语言、动态标题、水印文案与更新检查：语言选项漏传会让下拉为空，水印开关关闭时未清空
 * 文案会让已删除的水印继续显示，双向绑定写反会让用户改不动偏好。用例按真实语言包装载文案，点击与
 * 输入真实控件并断言真实取值更新、条件渲染与文案清理。
 */
import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, h } from 'vue';

import { SUPPORT_LANGUAGES } from '@vben/constants';
import { setupI18n } from '@vben/locales';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import SelectItem from '../select-item.vue';
import SwitchItem from '../switch-item.vue';
import PreferenceGeneralConfig from './general.vue';

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

/**
 * 用键盘路径打开语言选择面板：这是选择控件真实支持的无障碍交互，且不依赖 happy-dom 缺失的指针捕获能力。
 * @param wrapper 已挂载的通用配置宿主。
 * @returns 选择面板真实展开后的 Promise。
 */
async function openLocaleSelect(wrapper: ReturnType<typeof mount>) {
  const trigger = wrapper.get('[role="combobox"]');

  await trigger.trigger('keydown', { key: 'Enter' });
  await vi.waitFor(
    /** 等待传送节点真实渲染出语言选项。 */ () => {
      expect(document.querySelectorAll('[role="option"]').length).toBe(2);
    },
    { timeout: 2000 },
  );
}

beforeAll(
  /** 按真实 API 装载中文语言包，配置项文案与占位提示都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

describe('偏好设置-通用配置', /** 通用偏好是用户最常改动的设置，绑定或条件渲染出错会直接影响使用。 */ () => {
  it('渲染真实文案并使用真实支持语言作为下拉选项', /** 语言选项来源写死会让新增语言无法出现在偏好面板。 */ () => {
    const wrapper = mount(PreferenceGeneralConfig, {
      props: { appLocale: 'zh-CN' },
    });

    expect(wrapper.findAllComponents(SelectItem)[0]?.props('items')).toEqual(
      SUPPORT_LANGUAGES,
    );
    expect(wrapper.text()).toContain('语言');
    expect(wrapper.text()).toContain('动态标题');
    expect(wrapper.text()).toContain('水印');
    expect(wrapper.text()).toContain('定时检查更新');
    expect(wrapper.findAllComponents(SwitchItem)).toHaveLength(3);
    // 水印未开启时不应渲染水印文案输入框：输入框是水印文案唯一的真实承载节点。
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it('在下拉中选择英文时更新语言取值', /** 选择结果丢包会让用户选了英文但界面仍是中文。 */ async () => {
    const wrapper = mount(PreferenceGeneralConfig, {
      props: { appLocale: 'zh-CN' },
    });
    await openLocaleSelect(wrapper);

    const englishOption = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find(
      /** 定位英文选项，模拟用户点选。 */ (option) =>
        option.textContent?.includes('English'),
    );
    // 选项选择由真实键盘选中事件完成：面板被传送到 body，键盘路径无需 happy-dom 缺失的指针捕获能力。
    if (englishOption) {
      await new DOMWrapper(englishOption).trigger('keydown', { key: 'Enter' });
    }

    await vi.waitFor(
      /** 等待选择事件真实回写到语言取值。 */ () => {
        expect(wrapper.emitted('update:appLocale')?.[0]).toEqual(['en-US']);
      },
      { timeout: 2000 },
    );
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  it('水印开关关闭时清空水印文案并移除输入框', /** 只关开关不清文案会让水印内容留在配置里，重新开启后用户会看到已删除的水印。 */ async () => {
    const wrapper = mount(PreferenceGeneralConfig, {
      props: { appWatermark: true, appWatermarkContent: 'DUMMY-水印文案' },
    });
    const input = wrapper.get('input');

    expect((input.element as HTMLInputElement).value).toBe('DUMMY-水印文案');
    expect(input.attributes('placeholder')).toBe('请输入水印文案');

    await wrapper.findAllComponents(SwitchItem)[1]?.trigger('click');

    expect(wrapper.emitted('update:appWatermark')).toEqual([[false]]);
    expect(wrapper.emitted('update:appWatermarkContent')).toEqual([['']]);
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it('水印开启时输入新文案更新水印内容', /** 输入不回写会让用户填的水印内容不生效。 */ async () => {
    const wrapper = mount(PreferenceGeneralConfig, {
      props: { appWatermark: true, appWatermarkContent: 'DUMMY-旧水印' },
    });

    await wrapper.get('input').setValue('DUMMY-新水印');

    expect(wrapper.emitted('update:appWatermarkContent')?.at(-1)).toEqual([
      'DUMMY-新水印',
    ]);
  });

  it('点击动态标题与更新检查开关翻转对应取值', /** 开关绑定错位会让用户改一项却影响另一项。 */ async () => {
    const wrapper = mount(PreferenceGeneralConfig, {
      props: { appDynamicTitle: false, appEnableCheckUpdates: false },
    });
    const switches = wrapper.findAllComponents(SwitchItem);

    await switches[0]?.trigger('click');
    await switches[2]?.trigger('click');

    expect(wrapper.emitted('update:appDynamicTitle')).toEqual([[true]]);
    expect(wrapper.emitted('update:appEnableCheckUpdates')).toEqual([[true]]);
    // 水印开关未被点击，不应产生水印相关更新。
    expect(wrapper.emitted('update:appWatermark')).toBeUndefined();
  });
});
