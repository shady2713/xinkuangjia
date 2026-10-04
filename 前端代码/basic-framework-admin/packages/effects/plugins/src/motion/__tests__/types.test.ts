/**
 * 动效预设名单（motion/types.ts）的运行时契约回归。
 *
 * `MotionPresets` 是该模块唯一的运行时导出，同时是 `MotionPreset` 联合类型的取值来源，
 * 插件使用方据此枚举、校验并渲染预设动效。名单一旦被改写，选择器与类型联合会一起漂移，
 * 因此这里逐项核对真实取值、顺序、唯一性以及与类型联合的对应关系。
 */
import type { MotionPreset } from '../types';

import { describe, expect, it } from 'vitest';

import { MotionPresets } from '../types';

describe('动效预设名单运行时取值（MotionPresets）', /** 名单本身即是插件对外暴露的动效协议，取值变化会直接影响使用方。 */ () => {
  it('按固定顺序列出全部预设', /** 顺序决定使用方选择器的展示次序，改动必须显式核对。 */ () => {
    expect([...MotionPresets]).toEqual([
      'fade',
      'fadeVisible',
      'fadeVisibleOnce',
      'rollBottom',
      'rollLeft',
      'rollRight',
      'rollTop',
      'rollVisibleBottom',
      'rollVisibleLeft',
      'rollVisibleRight',
      'rollVisibleTop',
      'pop',
      'popVisible',
      'popVisibleOnce',
      'slideBottom',
      'slideLeft',
      'slideRight',
      'slideTop',
      'slideVisibleBottom',
      'slideVisibleLeft',
      'slideVisibleRight',
      'slideVisibleTop',
    ]);
  });

  it('每个预设取值唯一', /** 重复取值会让选择器出现两个无法区分的同名项。 */ () => {
    const unique = new Set(MotionPresets);

    expect(unique.size).toBe(MotionPresets.length);
  });

  it('每个预设都是可直接作为指令参数的非空标识', /** 预设值会被拼进指令名，空白或大写会生成非法指令。 */ () => {
    const invalid = MotionPresets.filter(
      /** 只保留不符合小写驼峰与冒号前缀的取值。 */ (preset) =>
        !/^[a-z][A-Za-z]*$/u.test(preset),
    );

    expect(invalid).toEqual([]);
  });

  it('类型联合与运行时名单同源', /** 类型成员必须来自同一份名单，避免新增值只能运行不能编译。 */ () => {
    const firstPreset: MotionPreset = MotionPresets[0];
    const lastPreset: MotionPreset = MotionPresets.at(-1) ?? MotionPresets[0];

    expect(firstPreset).toBe('fade');
    expect(lastPreset).toBe('slideVisibleTop');
    expect(MotionPresets).toContain(firstPreset);
    expect(MotionPresets).toContain(lastPreset);
  });
});
