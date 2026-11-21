/** 验证 Zod v3 表单 schema 默认值提取在对象、管道、校验增强及可选字段下的行为。 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getDefaultsForSchema } from '../use-form-context';

describe('getDefaultsForSchema (Zod v3)', () => {
  it('提取对象、默认值、可选默认值、管道与 refine 字段初始值', () => {
    const schema = z.object({
      active: z.boolean(),
      count: z.number(),
      label: z.string().default('默认标题'),
      optionalDefault: z.string().default('可选默认').optional(),
      optionalPlain: z.string().optional(),
      piped: z.string().default('管道值').pipe(z.string().min(1)),
      refined: z
        .string()
        .default('校验值')
        .refine(
          /** 要求非空字符串。 */
          (val) => val.length > 0,
        ),
      tags: z.array(z.string()),
    });

    expect(getDefaultsForSchema(schema)).toEqual({
      active: false,
      count: 0,
      label: '默认标题',
      optionalDefault: '可选默认',
      piped: '管道值',
      refined: '校验值',
      tags: [],
    });
  });

  it('支持交集与联合对象分支的默认值合并', () => {
    const schema = z.intersection(
      z.object({ a: z.string().default('left') }),
      z.union([z.string(), z.object({ b: z.number().default(7) })]),
    );

    expect(getDefaultsForSchema(schema)).toEqual({
      a: 'left',
      b: 7,
    });
  });
});
