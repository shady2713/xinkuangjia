/**
 * BEM 命名与 CSS 变量工具（@core/composables 的 use-namespace）真实行为回归。
 *
 * `useNamespace` 是组件类名与 CSS 变量的唯一拼装入口：块后缀、元素、修饰符三者的连接符
 * 或省略规则写错，会让样式选择器与模板类名不一致；`cssVar*` 系列对空值的过滤写错，
 * 会把空 CSS 变量写进内联样式。用例按真实调用方式断言每个工厂方法的返回值，
 * 并覆盖"缺参返回空串"与"空值被过滤"两类边界。
 */

import { DEFAULT_NAMESPACE } from '@vben-core/shared/constants';

import { describe, expect, it } from 'vitest';

import { useNamespace } from '../use-namespace';

describe('useNamespace', /** 类名与 CSS 变量的拼装契约。 */ () => {
  const ns = useNamespace('button');

  it('暴露全局命名空间常量', /** 命名空间被局部覆盖会让所有组件类名与样式表脱节。 */ () => {
    expect(ns.namespace).toBe(DEFAULT_NAMESPACE);
    expect(ns.namespace).toBe('vben');
  });

  it('块名带后缀时用连字符连接', /** 块后缀是同一组件多套皮肤的区分位，连接符错误会导致样式失配。 */ () => {
    expect(ns.b()).toBe('vben-button');
    expect(ns.b('group')).toBe('vben-button-group');
  });

  it('元素名用双下划线连接，缺省返回空串', /** 缺省返回空串才能安全拼进 class 数组，返回块名会污染类名。 */ () => {
    expect(ns.e()).toBe('');
    expect(ns.e('icon')).toBe('vben-button__icon');
  });

  it('修饰符用双连字符连接，缺省返回空串', /** 修饰符缺省返回空串可避免出现只有分隔符的无效类名。 */ () => {
    expect(ns.m()).toBe('');
    expect(ns.m('primary')).toBe('vben-button--primary');
  });

  it('be 需要块后缀与元素同时存在', /** 缺任一段时返回空串，避免产出 `vben-button-__icon` 这类无效类名。 */ () => {
    expect(ns.be()).toBe('');
    expect(ns.be('group')).toBe('');
    expect(ns.be(undefined, 'icon')).toBe('');
    expect(ns.be('group', 'icon')).toBe('vben-button-group__icon');
  });

  it('em 需要元素与修饰符同时存在', /** 两段缺一就返回空串，避免只拼出元素段。 */ () => {
    expect(ns.em()).toBe('');
    expect(ns.em('icon')).toBe('');
    expect(ns.em(undefined, 'primary')).toBe('');
    expect(ns.em('icon', 'primary')).toBe('vben-button__icon--primary');
  });

  it('bm 需要块后缀与修饰符同时存在', /** 段序必须是"块-后缀--修饰符"，段序错误会让 BEM 选择器失效。 */ () => {
    expect(ns.bm()).toBe('');
    expect(ns.bm('group')).toBe('');
    expect(ns.bm(undefined, 'primary')).toBe('');
    expect(ns.bm('group', 'primary')).toBe('vben-button-group--primary');
  });

  it('bem 需要三段同时存在', /** 三段齐全才产出完整类名，缺段时返回空串而不是部分拼接。 */ () => {
    expect(ns.bem()).toBe('');
    expect(ns.bem('group', 'icon')).toBe('');
    expect(ns.bem(undefined, 'icon', 'primary')).toBe('');
    expect(ns.bem('group', 'icon', 'primary')).toBe(
      'vben-button-group__icon--primary',
    );
  });

  it('cssVar 过滤空值并加全局命名空间前缀', /** 空值会覆盖上层主题变量，必须按真实实现跳过。 */ () => {
    expect(ns.cssVar({ color: 'red', empty: '' })).toEqual({
      '--vben-color': 'red',
    });
    expect(ns.cssVar({})).toEqual({});
  });

  it('cssVarBlock 额外带上块名并过滤空值', /** 块级变量写错会让同一变量的不同组件取值互相覆盖。 */ () => {
    expect(ns.cssVarBlock({ color: 'red', empty: '' })).toEqual({
      '--vben-button-color': 'red',
    });
    expect(ns.cssVarBlock({})).toEqual({});
  });

  it('变量名工厂与直接拼装结果一致', /** 变量名工厂用于运行时读取样式，前缀不一致会读不到值。 */ () => {
    expect(ns.cssVarName('color')).toBe('--vben-color');
    expect(ns.cssVarBlockName('color')).toBe('--vben-button-color');
  });

  it('is 状态类名按真假值取舍', /** 只传名字时默认视为真，传假值或空名字必须返回空串。 */ () => {
    expect(ns.is('disabled')).toBe('is-disabled');
    expect(ns.is('disabled', true)).toBe('is-disabled');
    expect(ns.is('disabled', false)).toBe('');
    expect(ns.is('disabled', undefined)).toBe('');
    expect(ns.is('')).toBe('');
  });
});
