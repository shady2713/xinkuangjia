/**
 * API 选择器映射配置的拒绝路径回归（补齐 parseApiSelectMapping 的失败契约）。
 *
 * 该模块是持久化配置进入运行期的唯一入口：任何超出声明式字段路径的配置都必须被拒绝，
 * 不能进入动态执行环境。用例覆盖空配置、超长配置、非对象 JSON、未声明字段、
 * 不安全字段路径以及历史语法中的原型链路径，断言每一种输入都得到可展示的失败原因而不是异常。
 */
import { describe, expect, it } from 'vitest';

import {
  mapApiSelectOptions,
  parseApiSelectMapping,
} from './api-select-mapping';

/** 声明式映射本身不合法时统一返回的迁移提示。 */
const INVALID_MAPPING_REASON =
  '仅支持 JSON 字段映射；历史配置只兼容 data.list.map(item => ({ label: item.name, value: item.id })) 形式';

describe('parseApiSelectMapping 输入边界', /** 空值与长度上限必须先于 JSON 解析被拒绝。 */ () => {
  it('空白配置提示不能为空', /** 未配置映射是常见状态，提示文本要直接说明原因。 */ () => {
    expect(parseApiSelectMapping('')).toEqual({
      migrated: false,
      reason: '映射配置不能为空',
    });
    expect(parseApiSelectMapping('   \n\t ')).toEqual({
      migrated: false,
      reason: '映射配置不能为空',
    });
  });

  it('超过长度上限的配置被拒绝', /** 超长配置可能夹带大量内容，必须在解析前按长度阻断。 */ () => {
    const oversized = 'x'.repeat(2001);

    expect(parseApiSelectMapping(oversized)).toEqual({
      migrated: false,
      reason: '映射配置长度超过 2000 个字符',
    });
    // 恰好等于上限时仍然进入解析流程（此内容不是合法映射，但原因不再是长度）。
    expect(parseApiSelectMapping('x'.repeat(2000)).reason).toBe(
      INVALID_MAPPING_REASON,
    );
  });
});

describe('parseApiSelectMapping JSON 校验', /** 只接受字段受限的 JSON 对象。 */ () => {
  it('非对象的 JSON 被拒绝', /** 数组、标量与 null 都没有字段映射语义，不能当作配置。 */ () => {
    for (const source of ['123', '"文本"', '[{"labelField":"name"}]', 'null']) {
      expect(parseApiSelectMapping(source), source).toEqual({
        migrated: false,
        reason: '映射配置必须是 JSON 对象',
      });
    }
  });

  it('包含未声明字段的配置被拒绝', /** 白名单之外的字段一律拒绝，避免配置携带可执行内容。 */ () => {
    expect(
      parseApiSelectMapping(
        '{"labelField":"name","valueField":"id","script":"globalThis.x=1"}',
      ),
    ).toEqual({ migrated: false, reason: '映射配置包含不支持的字段' });
  });

  it('字段路径不安全时被拒绝', /** 原型链路径与非法标识符都不能进入取值流程。 */ () => {
    for (const source of [
      '{"labelField":"__proto__.name","valueField":"id"}',
      '{"labelField":"name","valueField":"constructor"}',
      '{"labelField":"name","valueField":"id","listPath":"data.prototype.rows"}',
      '{"labelField":"name","valueField":"id","listPath":"data[0]"}',
      '{"labelField":1,"valueField":"id"}',
      '{"labelField":"name","valueField":null}',
    ]) {
      expect(parseApiSelectMapping(source).mapping, source).toBeUndefined();
    }
  });

  it('合法路径仍解析成功并去除首尾空白', /** 收紧校验不能误伤合法配置，字段名两侧空白要按同一口径裁剪。 */ () => {
    expect(
      parseApiSelectMapping(
        '{"labelField":" name ","valueField":" id ","listPath":" data.rows "}',
      ),
    ).toEqual({
      mapping: { labelField: 'name', listPath: 'data.rows', valueField: 'id' },
      migrated: false,
    });
  });
});

describe('parseApiSelectMapping 历史语法边界', /** 白名单语法内仍要拦截不安全路径。 */ () => {
  it('历史写法包含原型链路径时被拒绝', /** 语法匹配成功不代表路径安全，必须继续按安全路径校验。 */ () => {
    const unsafeListPath =
      'data => data.__proto__.map(item => ({ label: item.name, value: item.id }))';
    const unsafeLabel =
      'function (data) { return data.list.map(item => ({ label: item.constructor, value: item.id })) }';

    expect(parseApiSelectMapping(unsafeListPath)).toEqual({
      migrated: false,
      reason: INVALID_MAPPING_REASON,
    });
    expect(parseApiSelectMapping(unsafeLabel)).toEqual({
      migrated: false,
      reason: INVALID_MAPPING_REASON,
    });
  });

  it('历史写法省略列表路径时按整段数据取值', /** 没有列表路径时直接对返回值映射，兼容最简单的历史配置。 */ () => {
    expect(
      parseApiSelectMapping(
        'data => data.map(item => ({ label: item.name, value: item.id }))',
      ),
    ).toEqual({
      mapping: { labelField: 'name', listPath: '', valueField: 'id' },
      migrated: true,
    });
  });
});

describe('mapApiSelectOptions 列表取值', /** 映射声明决定从响应的哪一层取列表。 */ () => {
  it('按声明路径从响应中取出列表', /** 声明了列表路径时必须沿自有属性逐层取到列表，不能把整个响应当数组。 */ () => {
    expect(
      mapApiSelectOptions(
        { data: { rows: [{ id: 2, name: '乙' }] } },
        {
          labelField: 'name',
          listPath: 'data.rows',
          valueField: 'id',
        },
      ),
    ).toEqual([{ label: '乙', value: 2 }]);
  });

  it('列表路径为空时直接使用入参本身', /** 配置未声明列表路径说明接口直接返回数组，不能再去取子字段。 */ () => {
    expect(
      mapApiSelectOptions([{ id: 1, name: '甲' }], {
        labelField: 'name',
        listPath: '',
        valueField: 'id',
      }),
    ).toEqual([{ label: '甲', value: 1 }]);

    expect(
      mapApiSelectOptions(
        { rows: [{ id: 1 }] },
        {
          labelField: 'name',
          listPath: '',
          valueField: 'id',
        },
      ),
    ).toBeUndefined();
  });

  it('列表项缺少字段时取到 undefined 而不是抛错', /** 后端字段缺失要退化为空选项值，不能中断整张列表的渲染。 */ () => {
    expect(
      mapApiSelectOptions([{ id: 1 }], {
        labelField: 'profile.name',
        listPath: '',
        valueField: 'id',
      }),
    ).toEqual([{ label: undefined, value: 1 }]);
  });

  it('原型链字段不会被读取', /** 仅沿自有属性取值，避免把原型成员当成业务数据。 */ () => {
    expect(
      mapApiSelectOptions([{ id: 1 }], {
        labelField: 'constructor',
        listPath: '',
        valueField: 'id',
      }),
    ).toEqual([{ label: undefined, value: 1 }]);
  });
});
