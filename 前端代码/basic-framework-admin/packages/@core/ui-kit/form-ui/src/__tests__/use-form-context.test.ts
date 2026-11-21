/** 验证 Zod v3 表单 schema 默认值提取在基础类型、可空/可选包装、管道、校验增强与联合/交集下的行为。 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getDefaultsForSchema } from '../use-form-context';

describe('getDefaultsForSchema (Zod v3)', () => {
  it('提取显式默认值并保留裸 ZodNumber 为 undefined 以免覆盖表单 null', () => {
    const schema = z.object({
      active: z.boolean(),
      bareNumber: z.number(),
      explicitNumber: z.number().default(12),
      label: z.string().default('默认标题'),
      nullableDefault: z.string().default('可空默认').nullable(),
      nullablePlain: z.string().nullable(),
      optionalDefault: z.string().default('可选默认').optional(),
      optionalNested: z
        .string()
        .default('深层默认')
        .refine(
          /** 要求非空字符串。 */
          (val) => val.length > 0,
        )
        .optional(),
      optionalPlain: z.string().optional(),
      piped: z.string().default('管道值').pipe(z.string().min(1)),
      readonlyVal: z.string().default('只读值').readonly(),
      tags: z.array(z.string()),
    });

    expect(getDefaultsForSchema(schema)).toEqual({
      active: false,
      explicitNumber: 12,
      label: '默认标题',
      nullableDefault: '可空默认',
      optionalDefault: '可选默认',
      optionalNested: '深层默认',
      piped: '管道值',
      readonlyVal: '只读值',
      tags: [],
    });
  });

  it('支持交集、联合与可辨识联合对象分支的默认值合并', () => {
    const schema = z.intersection(
      z.object({ a: z.string().default('left') }),
      z.union([z.string(), z.object({ b: z.number().default(7) })]),
    );
    expect(getDefaultsForSchema(schema)).toEqual({ a: 'left', b: 7 });

    const discriminated = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), title: z.string().default('首个分支') }),
      z.object({ count: z.number().default(2), kind: z.literal('b') }),
    ]);
    expect(getDefaultsForSchema(discriminated)).toEqual({ title: '首个分支' });
  });
});
