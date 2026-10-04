/**
 * 操作日志时间线（components/operate-log/operate-log）真实行为回归。
 *
 * 该组件按操作日志列表渲染时间线：点头部颜色由字典 user_type 的 colorType 决定，
 * 颜色映射写错会让不同操作主体看起来一样，空颜色或非法颜色必须回退到默认蓝，
 * 字典标签取不到时不能渲染出 undefined。用例挂载真实组件与真实 Element Plus
 * 时间线，用真实字典 store 提供 user_type 缓存，只断言外部可观察的样式与文本。
 */
import type { SystemOperateLogApi } from '#/api/system/operate-log';

import { mount } from '@vue/test-utils';

import { DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import OperateLog from './operate-log.vue';

/** user_type 字典基线：覆盖五种颜色、缺 colorType 与未知 colorType 三种口径。 */
const userTypeDict = [
  { colorType: 'danger', label: '会员', value: '1' },
  { colorType: 'info', label: '管理员', value: '2' },
  { colorType: 'success', label: '系统', value: '3' },
  { colorType: 'warning', label: '其他', value: '4' },
  { label: '匿名', value: '5' },
  { colorType: 'brand', label: '非法颜色', value: '6' },
];

/**
 * 构造字段完整的操作日志记录。
 * @param overrides 用例需要覆盖的字段。
 * @returns 可直接渲染的日志记录。
 */
function logRecord(
  overrides: Partial<SystemOperateLogApi.OperateLog> = {},
): SystemOperateLogApi.OperateLog {
  return {
    action: '登录系统',
    bizId: 0,
    createTime: '2026-01-02T03:00:00.000Z',
    creator: '1',
    creatorName: '管理员',
    extra: '',
    id: 1,
    requestMethod: 'POST',
    requestUrl: '/admin-api/system/auth/login',
    subType: 'LOGIN',
    traceId: 'trace-1',
    type: 'AUTH',
    userAgent: 'vitest',
    userId: 1,
    userName: '管理员',
    userIp: '127.0.0.1',
    userType: 2,
    ...overrides,
  };
}

/**
 * 生成颜色对应的内联样式文本，使断言不受十六进制与 rgb 写法差异影响。
 * @param color 源码中声明的颜色值。
 * @returns 只设置背景色时的样式属性文本。
 */
function expectedDotStyle(color: string) {
  const probe = document.createElement('span');
  probe.style.backgroundColor = color;
  return probe.getAttribute('style');
}

/**
 * 挂载操作日志组件并返回包装器。
 * @param logList 要渲染的日志列表；空数组用于验证空时间线。
 * @returns 已挂载的组件包装器。
 */
function mountOperateLog(logList: SystemOperateLogApi.OperateLog[] = []) {
  return mount(OperateLog, { props: { logList } });
}

beforeEach(
  /** 每例使用独立 pinia 并写入 user_type 字典缓存。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({ [DICT_TYPE.USER_TYPE]: userTypeDict });
  },
);

describe('日志时间线渲染', /** 时间线是操作审计的主要展示形态，条目与文本缺失会让审计无法定位。 */ () => {
  it('按日志列表渲染条目、时间、操作人与动作', /** 漏渲染条目或字段会让审计遗漏一次真实操作。 */ () => {
    const wrapper = mountOperateLog([
      logRecord({ action: '新增用户', id: 1, userName: '管理员' }),
      logRecord({ action: '删除角色', id: 2, userName: '运营' }),
    ]);

    const items = wrapper.findAll('.el-timeline-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.text()).toContain('管理员');
    expect(items[0]?.text()).toContain('新增用户');
    expect(items[1]?.text()).toContain('运营');
    expect(items[1]?.text()).toContain('删除角色');
    expect(wrapper.text()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('日志列表为空时渲染空时间线', /** 没有日志时必须渲染空容器，而不是 undefined 条目或整块空白。 */ () => {
    const wrapper = mountOperateLog([]);

    expect(wrapper.findAll('.el-timeline-item')).toHaveLength(0);
    expect(wrapper.find('.el-timeline').exists()).toBe(true);
  });
});

describe('操作主体颜色与标签', /** 点头部颜色区分操作主体，颜色映射与字典标签必须一致。 */ () => {
  it('按字典 colorType 映射四种颜色', /** 颜色映射写错会让不同主体无法区分，审计时容易误判操作来源。 */ () => {
    const wrapper = mountOperateLog([
      logRecord({ id: 1, userType: 1 }),
      logRecord({ id: 2, userType: 2 }),
      logRecord({ id: 3, userType: 3 }),
      logRecord({ id: 4, userType: 4 }),
    ]);

    const dots = wrapper.findAll('span[style]');
    expect(
      dots.map(
        /** 取出每个点的内联样式，用于核对背景色。 */ (dot) =>
          dot.attributes('style'),
      ),
    ).toEqual([
      expectedDotStyle('#F56C6C'),
      expectedDotStyle('#909399'),
      expectedDotStyle('#67C23A'),
      expectedDotStyle('#E6A23C'),
    ]);
  });

  it('字典缺少或使用未知 colorType 时回退默认色', /** 缺少颜色或后端下发未知颜色值都不能渲染成透明点。 */ () => {
    const wrapper = mountOperateLog([
      logRecord({ id: 1, userType: 5 }),
      logRecord({ id: 2, userType: 6 }),
      logRecord({ id: 3, userType: 99 }),
    ]);

    const dots = wrapper.findAll('span[style]');
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot.attributes('style')).toBe(expectedDotStyle('#409EFF'));
    }
  });

  it('点头部显示字典标签的首字', /** 标签取值写错会让点里出现 undefined 或错误主体的首字。 */ () => {
    const wrapper = mountOperateLog([
      logRecord({ id: 1, userType: 1 }),
      logRecord({ id: 2, userType: 2 }),
      logRecord({ id: 3, userType: 99 }),
    ]);

    const dots = wrapper.findAll('span[style]');
    expect(dots[0]?.text()).toBe('会');
    expect(dots[1]?.text()).toBe('管');
    expect(dots[2]?.text()).toBe('');
  });
});
