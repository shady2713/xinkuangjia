import { describe, expect, it } from 'vitest';

import {
  mapApiSelectOptions,
  parseApiSelectMapping,
} from './api-select-mapping';

describe('api 选择器声明式映射', () => {
  it('按 JSON 字段路径映射列表', () => {
    const result = parseApiSelectMapping(
      '{"listPath":"data.rows","labelField":"profile.name","valueField":"id"}',
    );

    expect(result).toEqual({
      mapping: {
        labelField: 'profile.name',
        listPath: 'data.rows',
        valueField: 'id',
      },
      migrated: false,
    });
    if (!result.mapping) {
      throw new Error('JSON 映射应解析成功');
    }
    expect(
      mapApiSelectOptions(
        { data: { rows: [{ id: 7, profile: { name: '测试用户' } }] } },
        result.mapping,
      ),
    ).toEqual([{ label: '测试用户', value: 7 }]);
  });

  it('无执行迁移历史文档中的简单 map 写法', () => {
    const result = parseApiSelectMapping(`
      function (data) {
        return data.list.map(item => ({ label: item.nickname, value: item.id }))
      }
    `);

    expect(result).toEqual({
      mapping: {
        labelField: 'nickname',
        listPath: 'list',
        valueField: 'id',
      },
      migrated: true,
    });
  });

  it('拒绝任意脚本和原型链路径', () => {
    expect(
      parseApiSelectMapping(
        '() => { globalThis.compromised = true; return []; }',
      ).mapping,
    ).toBeUndefined();
    expect(
      parseApiSelectMapping(
        '{"listPath":"__proto__.rows","labelField":"name","valueField":"id"}',
      ).mapping,
    ).toBeUndefined();
  });

  it('列表路径不存在时返回 undefined 而不是执行兜底代码', () => {
    const result = parseApiSelectMapping(
      '{"listPath":"items","labelField":"name","valueField":"id"}',
    );

    if (!result.mapping) {
      throw new Error('JSON 映射应解析成功');
    }
    expect(mapApiSelectOptions({ rows: [] }, result.mapping)).toBeUndefined();
  });
});
