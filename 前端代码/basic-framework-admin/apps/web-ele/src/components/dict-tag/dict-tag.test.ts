/** 验证 DictTag 对非法及历史兼容 colorType 的安全映射与回退行为。 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';

import { ElTag } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DictTag from './dict-tag.vue';

const mockDict = vi.hoisted(() => ({
  colorType: 'primary',
  label: '测试标签',
}));

vi.mock('@vben/hooks', () => ({
  /** 返回当前用例构造的字典项快照。 */
  getDictObj: vi.fn(() => ({ ...mockDict })),
}));

let wrapper: undefined | VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

/** DictTag 颜色类型安全映射测试套件。 */
function describeDictTag() {
  it.each([
    ['default', 'info'],
    ['processing', 'primary'],
    ['error', 'danger'],
    ['success', 'success'],
    ['warning', 'warning'],
    ['danger', 'danger'],
    ['red', 'primary'],
    ['', 'primary'],
  ] as const)(
    '将字典色值 %s 安全映射为 ElTag 的 %s 类型',
    (rawColor, expected) => {
      mockDict.colorType = rawColor;
      mockDict.label = '状态';
      wrapper = mount(DictTag, { props: { type: 'common_status', value: 0 } });

      expect(wrapper.findComponent(ElTag).props('type')).toBe(expected);
    },
  );
}

describe('dictTag', describeDictTag);
