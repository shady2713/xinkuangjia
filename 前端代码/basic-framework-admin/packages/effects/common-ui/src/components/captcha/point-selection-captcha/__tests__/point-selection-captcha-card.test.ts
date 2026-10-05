/**
 * 点选验证码卡片（point-selection-captcha/point-selection-captcha-card）真实行为回归。
 *
 * 该卡片是点选验证码的外壳：按调用方给的宽高与内边距换算根容器与图片的真实像素尺寸，按是否传
 * title 插槽决定展示插槽还是 title 属性，并把图片上的原生点击原样交给父级去做坐标采集。
 * 尺寸换算写错会让图片区与提示条错位、点击坐标整体偏移；无长度单位的坏值不回退会让样式出现
 * NaN 而整块卡片塌陷；标题分支写反会让业务方传的标题或插槽失效；点击事件未透传会让点选验证码
 * 永远收不到用户点击；extra 与 footer 插槽未渲染会让刷新按钮与提示图无处安放。
 *
 * 用例真实挂载组件、真实派发点击并读取渲染后的真实 DOM 与事件载荷，不替换任何依赖。
 */
import { mount } from '@vue/test-utils';

import { $t } from '@vben/locales';

import { describe, expect, it } from 'vitest';

import PointSelectionCaptchaCard from '../point-selection-captcha-card.vue';

/** 验证码图片占位地址：只用于核对渲染出的图片地址。 */
const CAPTCHA_IMAGE = 'DUMMY-CAPTCHA-IMAGE';

/** 卡片标题占位文案：未提供 title 插槽时应展示该属性。 */
const TITLE_TEXT = 'DUMMY-请按图依次点击';

describe('点选验证码卡片', /** 尺寸换算与插槽分支决定图片区、标题区和点击链路是否正确。 */ () => {
  it('按调用方尺寸换算根内边距与图片尺寸，坏长度回退为零', /** 未换算或未回退会让图片区与提示条错位、样式出现 NaN。 */ () => {
    const wrapper = mount(PointSelectionCaptchaCard, {
      props: {
        captchaImage: CAPTCHA_IMAGE,
        // 数字高度直接使用，字符串宽度按像素解析，非法内边距回退为 0。
        height: 220,
        paddingY: 'DUMMY-非法长度',
        title: TITLE_TEXT,
        width: '300px',
      },
    });

    expect(wrapper.attributes('style')).toContain('padding: 0px 12px');
    expect(wrapper.attributes('style')).toContain('width: 324px');
    expect(wrapper.attributes('aria-labelledby')).toBe('captcha-title');
    expect(wrapper.attributes('role')).toBe('region');

    const image = wrapper.find('img');
    expect(image.attributes('src')).toBe(CAPTCHA_IMAGE);
    expect(image.attributes('alt')).toBe($t('ui.captcha.alt'));
    expect(image.attributes('style')).toContain('height: 220px');
    expect(image.attributes('style')).toContain('width: 300px');
  });

  it('未提供 title 插槽时展示 title 属性', /** 标题分支写反会让调用方传入的标题失效。 */ () => {
    const wrapper = mount(PointSelectionCaptchaCard, {
      props: { captchaImage: CAPTCHA_IMAGE, title: TITLE_TEXT },
    });

    expect(wrapper.find('#captcha-title').text()).toBe(TITLE_TEXT);
  });

  it('提供 title 插槽时改用插槽内容', /** 插槽被 title 属性顶掉会让业务方无法定制标题。 */ () => {
    const wrapper = mount(PointSelectionCaptchaCard, {
      props: { captchaImage: CAPTCHA_IMAGE, title: TITLE_TEXT },
      slots: { title: '<b class="DUMMY-title-slot">DUMMY-插槽标题</b>' },
    });

    expect(wrapper.find('.DUMMY-title-slot').exists()).toBe(true);
    expect(wrapper.find('#captcha-title').text()).toBe('DUMMY-插槽标题');
    expect(wrapper.text()).not.toContain(TITLE_TEXT);
  });

  it('点击图片把原生事件原样交给父级', /** 点击未透传会让点选验证码永远采集不到坐标。 */ async () => {
    const wrapper = mount(PointSelectionCaptchaCard, {
      props: { captchaImage: CAPTCHA_IMAGE },
    });

    await wrapper.find('img').trigger('click', { clientX: 111, clientY: 22 });

    const clicks = wrapper.emitted('click');
    expect(clicks).toHaveLength(1);
    expect((clicks?.[0]?.[0] as MouseEvent).clientX).toBe(111);
    expect((clicks?.[0]?.[0] as MouseEvent).clientY).toBe(22);
  });

  it('渲染 extra 与 footer 插槽内容', /** 插槽未渲染会让刷新按钮与提示图无处安放。 */ () => {
    const wrapper = mount(PointSelectionCaptchaCard, {
      props: { captchaImage: CAPTCHA_IMAGE },
      slots: {
        extra: '<i class="DUMMY-extra-slot"></i>',
        footer: '<i class="DUMMY-footer-slot"></i>',
      },
    });

    expect(wrapper.find('.DUMMY-extra-slot').exists()).toBe(true);
    expect(wrapper.find('.DUMMY-footer-slot').exists()).toBe(true);
  });

  it('未传验证码图片时隐藏图片节点', /** 无图时仍显示空图片框会让面板留下破图占位。 */ () => {
    const wrapper = mount(PointSelectionCaptchaCard, {
      props: { captchaImage: '' },
    });

    expect(wrapper.find('img').attributes('style')).toContain('display: none');
  });
});
