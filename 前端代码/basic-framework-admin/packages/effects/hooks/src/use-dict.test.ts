/**
 * 字典展示取值工具（use-dict）的真实行为回归。
 *
 * 三个导出函数是业务表格与表单把字典值转成展示文本的唯一入口：它们从真实 Pinia
 * 字典 Store 读取缓存，命中返回标签或对象、未命中必须返回空串或 null（不能把
 * undefined 泄漏给模板），值类型转换按 valueType 真实执行。
 * 用例经生产路径 `initStores` 建立真实 Pinia，装载真实字典缓存后断言真实返回值，
 * 不镜像 Store 内部实现，也不替换字典 Store 本身。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h } from 'vue';

import { initStores, useDictStore } from '@vben/stores';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getDictLabel, getDictObj, getDictOptions } from './use-dict';

/** 覆盖字符串与布尔两类字典值形态的真实缓存数据。 */
const dictCache = {
  sys_user_sex: [
    { label: '男', value: '1' },
    { label: '女', value: '2' },
  ],
  sys_yes_no: [
    { label: '是', value: 'true' },
    { label: '否', value: 'false' },
  ],
};

/** 本文件共享的真实 Pinia 实例，由生产入口 `initStores` 创建并安装。 */
let pinia: Awaited<ReturnType<typeof initStores>>;

/** 最近一次挂载真实调用后收集到的取值结果，供各用例断言。 */
let results: ReturnType<typeof collectDictResults>;

vi.hoisted(
  /**
   * `initStores` 读取运行时配置里的持久化密钥，测试进程没有加载生产配置脚本，
   * 因此在导入 Stores 之前建立最小替身；该键值不参与任何真实加密。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_APP_STORE_SECURE_KEY: '',
    });
  },
);

/**
 * 在组件上下文内装载字典缓存并真实调用三个取值入口。
 * @returns 各取值入口的真实返回值，字段与用例断言一一对应。
 */
function collectDictResults() {
  useDictStore().setDictCache(dictCache);
  return {
    labelHit: getDictLabel('sys_user_sex', '1'),
    labelMissingType: getDictLabel('not_exist', '1'),
    labelMissingValue: getDictLabel('sys_user_sex', '9'),
    labelNonPrimitive: getDictLabel('sys_user_sex', { value: '1' }),
    labelNumberValue: getDictLabel('sys_user_sex', 2),
    labelUnknownValue: getDictLabel('sys_user_sex', true),
    objHit: getDictObj('sys_user_sex', 2),
    objMissingType: getDictObj('not_exist', '1'),
    objMissingValue: getDictObj('sys_user_sex', '9'),
    objNonPrimitive: getDictObj('sys_user_sex', []),
    optionsBoolean: getDictOptions('sys_yes_no', 'boolean'),
    optionsDefault: getDictOptions('sys_user_sex'),
    optionsMissing: getDictOptions('not_exist'),
    optionsNumber: getDictOptions('sys_user_sex', 'number'),
  };
}

/** 探针组件：在真实组件上下文内执行取值调用，保证 Store 注入与运行期一致。 */
const DictProbe = defineComponent({
  name: 'DictProbe',
  /**
   * 收集取值结果并渲染最小宿主节点。
   * @returns 渲染探针节点的渲染函数。
   */
  setup() {
    results = collectDictResults();
    return /** 渲染最小宿主节点，调用结果通过模块变量读取。 */ () =>
      h('div', { 'data-test': 'dict-probe' });
  },
});

/**
 * 挂载探针组件并触发真实取值调用。
 * @returns 已挂载的探针组件包装器。
 */
function mountProbe() {
  return mount(DictProbe, { global: { plugins: [pinia] } });
}

/**
 * 按生产路径创建真实 Pinia，使字典 Store 的注入上下文与运行期一致。
 * @returns 建立完成的 Promise。
 */
async function initTestStores() {
  pinia = await initStores(
    createApp({
      /** 渲染空节点，仅提供真实应用上下文。 */
      render: () => null,
    }),
    { namespace: 'dict-tool-test' },
  );
}

beforeAll(initTestStores);

describe('字典取值工具', /** 展示文本错误会直接影响列表与详情的业务可读性。 */ () => {
  it('getDictLabel 命中返回真实标签，未命中返回空串', /** 返回 undefined 会让模板渲染出 "undefined" 文本。 */ () => {
    mountProbe();

    expect(results.labelHit).toBe('男');
    expect(results.labelNumberValue).toBe('女');
    expect(results.labelMissingValue).toBe('');
    expect(results.labelUnknownValue).toBe('');
    expect(results.labelMissingType).toBe('');
  });

  it('getDictLabel 对非原始值返回空串', /** 对象或数组取值会被 Store 拒绝，展示层必须得到空串。 */ () => {
    mountProbe();

    expect(results.labelNonPrimitive).toBe('');
  });

  it('getDictObj 命中返回完整字典对象，未命中返回 null', /** 调用方需要拿到 colorType 等展示字段，未命中必须是 null 而不是 undefined。 */ () => {
    mountProbe();

    expect(results.objHit).toEqual({ label: '女', value: '2' });
    expect(results.objMissingValue).toBeNull();
    expect(results.objMissingType).toBeNull();
    expect(results.objNonPrimitive).toBeNull();
  });

  it('getDictOptions 默认与 number 转换按声明口径取真实值', /** 下拉与单选按字符串或数字回填，转换错会让选中项对不上。 */ () => {
    mountProbe();

    expect(results.optionsDefault).toEqual([
      { label: '男', value: '1' },
      { label: '女', value: '2' },
    ]);
    expect(results.optionsNumber).toEqual([
      { label: '男', value: 1 },
      { label: '女', value: 2 },
    ]);
  });

  it('getDictOptions 的 boolean 转换与空字典兜底', /** 布尔型字典用于开关类字段，未加载的字典必须给出空数组。 */ () => {
    mountProbe();

    expect(results.optionsBoolean).toEqual([
      { label: '是', value: true },
      { label: '否', value: false },
    ]);
    expect(results.optionsMissing).toEqual([]);
  });
});
