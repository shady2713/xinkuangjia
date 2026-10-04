/**
 * 表格操作按钮图标名（icons.ts）的对外契约回归。
 *
 * 该模块只导出一份图标名映射，消费方（表格操作按钮）直接把它交给图标系统按名字渲染。
 * 用例锁定每个动作的真实图标名，并核对取值形态满足离线图标名的解析要求；
 * 名字被改动或写成不存在的图标会让按钮渲染为空，因此必须由契约测试固定。
 */
import { describe, expect, it } from 'vitest';

import { ACTION_ICON } from './icons';

describe('图标名契约（ACTION_ICON）', /** 表格操作按钮图标名的取值与形态。 */ () => {
  it('每个动作对应固定图标名', /** 消费方按名字渲染图标，任何改名都会改变界面表现，必须显式锁定。 */ () => {
    expect(ACTION_ICON).toEqual({
      ADD: 'lucide:plus',
      AUDIT: 'lucide:file-check',
      BOOK: 'lucide:book',
      CLOSE: 'lucide:x',
      COPY: 'lucide:copy',
      DELETE: 'lucide:trash-2',
      DOWNLOAD: 'lucide:download',
      EDIT: 'lucide:edit',
      FILTER: 'lucide:filter',
      MORE: 'lucide:ellipsis-vertical',
      REFRESH: 'lucide:refresh-cw',
      SEARCH: 'lucide:search',
      UPLOAD: 'lucide:upload',
      VIEW: 'lucide:eye',
    });
  });

  it('取值都是合法的 lucide 离线图标名', /** 图标系统要求 `集合:名称` 形式，缺少前缀或写成非 kebab-case 会解析不到图标。 */ () => {
    for (const [action, icon] of Object.entries(ACTION_ICON)) {
      expect(icon, action).toMatch(/^lucide:[a-z\d]+(?:-[a-z\d]+)*$/u);
    }
  });

  it('不同动作不共用同一个图标名', /** 操作列并排渲染，重复图标会让用户无法区分操作。 */ () => {
    const icons = Object.values(ACTION_ICON);

    expect(new Set(icons).size).toBe(icons.length);
  });
});
