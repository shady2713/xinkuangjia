/**
 * 字典标签组件（components/dict-tag/dict-tag）真实行为回归。
 *
 * 组件按字典类型与字典值从真实字典缓存里取标签文本与颜色，渲染成 ElTag：取址条件写错会让
 * 列表页因单条脏数据整体失败；布尔、数字与字符串三种取值口径不一致会让字典值命不中；
 * 字典未命中却仍渲染标签会让界面出现空白或 undefined；颜色收敛写错会让非法颜色导致标签
 * 失去样式。用例挂载真实组件与真实 ElTag，用真实 Pinia + 字典 store 提供缓存，只断言外部
 * 可观察的标签文本与颜色类名，不替换被测实现。
 */
import { mount } from '@vue/test-utils';

import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import DictTag from './dict-tag.vue';

/** 字典类型夹具：用例自建类型，不依赖仓库常量的具体取值。 */
const DICT_TYPE_FIXTURE = 'DUMMY_dict_status';

/** 字典内容基线：覆盖五种 ElTag 颜色、缺颜色与非法颜色三种口径。 */
const statusDict = [
  { colorType: 'danger', label: '停用', value: '0' },
  { colorType: 'info', label: '审核中', value: '1' },
  { colorType: 'success', label: '启用', value: '2' },
  { colorType: 'warning', label: '告警', value: '3' },
  { colorType: 'primary', label: '草稿', value: '4' },
  // 缺 colorType：组件必须回退到 primary，而不是渲染出无类型标签。
  { label: '未设置颜色', value: '5' },
  // 非法 colorType：不属于 ElTag 支持的五种取值。
  { colorType: 'brand', label: '非法颜色', value: '6' },
  // 空标签：字典命中但没有可展示文本时不能渲染空标签。
  { colorType: 'success', label: '', value: '7' },
];

beforeEach(
  /** 每例使用独立 Pinia 并写入本次字典缓存，避免用例之间互相污染。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({ [DICT_TYPE_FIXTURE]: statusDict });
  },
);

/**
 * 以指定字典类型与取值挂载标签组件。
 * @param value 字典取值，可为布尔、数字或字符串。
 * @param type 字典类型。
 * @returns 已挂载的组件包装器。
 */
function mountTag(value: boolean | number | string, type = DICT_TYPE_FIXTURE) {
  return mount(DictTag, { props: { type, value } });
}

describe('字典标签取值口径', /** 取值口径决定字典值能否命中，写错会让列表页显示空白标签。 */ () => {
  it('字符串取值命中并渲染标签文本', /** 最常用的字符串口径必须命中，否则绝大多数字典列都会空白。 */ () => {
    const wrapper = mountTag('2');

    expect(wrapper.get('.el-tag').text()).toBe('启用');
  });

  it('数字取值按服务端字符串口径命中', /** 后端字典值都是字符串，数字入参必须按同一口径比较。 */ () => {
    const wrapper = mountTag(0);

    expect(wrapper.get('.el-tag').text()).toBe('停用');
  });

  it('布尔取值按字符串口径命中', /** 布尔字典值同样以字符串落库，比较口径必须一致。 */ () => {
    useDictStore().setDictCache({
      DUMMY_bool_flag: [{ colorType: 'success', label: '是', value: 'true' }],
    });

    const hit = mountTag(true, 'DUMMY_bool_flag');

    expect(hit.get('.el-tag').text()).toBe('是');
  });
});

describe('字典标签未命中与空值', /** 未命中和空值必须渲染为空，不能抛错或渲染出无意义文本。 */ () => {
  it('字典类型为空时不查询字典也不渲染标签', /** 空类型是列表里的常见脏数据，必须安全降级而不是抛错。 */ () => {
    const wrapper = mountTag('2', '');

    expect(wrapper.find('.el-tag').exists()).toBe(false);
  });

  it('取值为 undefined 或 null 时不渲染标签', /** 空取值在可选字典列里很常见，判空丢失会渲染出空白标签。 */ () => {
    const undefinedWrapper = mount(DictTag, {
      props: { type: DICT_TYPE_FIXTURE, value: undefined as never },
    });
    const nullWrapper = mount(DictTag, {
      props: { type: DICT_TYPE_FIXTURE, value: null as never },
    });

    expect(undefinedWrapper.find('.el-tag').exists()).toBe(false);
    expect(nullWrapper.find('.el-tag').exists()).toBe(false);
  });

  it('字典值未命中时不渲染标签', /** 脏数据不能让列表页出现空白标签或 undefined。 */ () => {
    const wrapper = mountTag('不存在的值');

    expect(wrapper.find('.el-tag').exists()).toBe(false);
  });

  it('字典类型未缓存时不渲染标签', /** 未加载字典的列必须安静降级，不能整页失败。 */ () => {
    const wrapper = mountTag('2', 'DUMMY_not_cached');

    expect(wrapper.find('.el-tag').exists()).toBe(false);
  });

  it('字典命中但标签为空时不渲染空标签', /** 空标签会在界面上留下一块无内容的色块。 */ () => {
    const wrapper = mountTag('7');

    expect(wrapper.find('.el-tag').exists()).toBe(false);
  });
});

describe('字典标签颜色收敛', /** 颜色决定状态在列表里的可辨识度，非法值必须回退而不是产生无样式标签。 */ () => {
  it.each([
    ['0', 'danger'],
    ['1', 'info'],
    ['2', 'success'],
    ['3', 'warning'],
    ['4', 'primary'],
  ] as const)(
    '取值 %s 使用字典声明的 %s 颜色',
    /** ElTag 支持的五种颜色必须原样透传，否则同一状态在不同页面颜色不一致。 */ async (
      value,
      colorType,
    ) => {
      const wrapper = mountTag(value);

      expect(wrapper.get('.el-tag').classes()).toContain(
        `el-tag--${colorType}`,
      );
    },
  );

  it('字典缺 colorType 时回退为 primary', /** 缺颜色的字典项若原样透传会渲染出没有主题色的标签。 */ () => {
    const wrapper = mountTag('5');

    expect(wrapper.get('.el-tag').text()).toBe('未设置颜色');
    expect(wrapper.get('.el-tag').classes()).toContain('el-tag--primary');
  });

  it('非法 colorType 原样透传而不被错误改写', /** 组件只负责空值兜底，已有值不得被静默改写，否则字典配置形同失效。 */ () => {
    const wrapper = mountTag('6');

    expect(wrapper.get('.el-tag').text()).toBe('非法颜色');
    expect(wrapper.get('.el-tag').classes()).toContain('el-tag--brand');
  });
});
