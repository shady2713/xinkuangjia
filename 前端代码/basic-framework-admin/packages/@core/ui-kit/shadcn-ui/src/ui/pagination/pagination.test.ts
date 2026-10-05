/**
 * 分页导航件（shadcn-ui 的 ui/pagination）结构与跳转回归。
 *
 * 分页件由首页、上一页、下一页、末页与省略号组成：每件默认渲染对应图标，点击后必须抛出目标
 * 页码，否则用户无法翻页；省略号只做占位不参与跳转。用例真实挂载 reka-ui 的分页根节点并读取
 * 真实按钮语义与页码更新事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { PaginationRoot } from 'reka-ui';
import { describe, expect, it } from 'vitest';

import PaginationEllipsis from './PaginationEllipsis.vue';
import PaginationFirst from './PaginationFirst.vue';
import PaginationLast from './PaginationLast.vue';
import PaginationNext from './PaginationNext.vue';
import PaginationPrev from './PaginationPrev.vue';

/**
 * 挂载分页导航。
 * @param pages 记录页码更新的数组。
 * @returns 已挂载的分页包装器。
 */
function mountPagination(pages: unknown[] = []) {
  return mount(
    h(
      PaginationRoot,
      {
        itemsPerPage: 10,
        page: 2,
        total: 100,
        /** 记录页码更新。 */
        'onUpdate:page': (value: unknown) => {
          pages.push(value);
        },
      },
      {
        /** 渲染全部导航件。 */
        default: () => [
          h(PaginationFirst, { class: 'custom-first' }),
          h(PaginationPrev, { class: 'custom-prev' }),
          h(PaginationEllipsis, { class: 'custom-ellipsis' }),
          h(PaginationNext, { class: 'custom-next' }),
          h(PaginationLast, { class: 'custom-last' }),
        ],
      },
    ),
  );
}

describe('分页导航件结构', /** 默认图标缺失会让导航按钮变成空白块。 */ () => {
  it('每个导航件默认渲染图标并合并调用方 class', /** class 被覆盖会让业务样式失效。 */ async () => {
    const wrapper = mountPagination();
    await nextTick();

    // asChild 让导航件把样式交给内部按钮，因此选择器命中的就是按钮本身。
    for (const [buttonSelector, icon] of [
      ['.custom-first', 'lucide-chevrons-left'],
      ['.custom-prev', 'lucide-chevron-left'],
      ['.custom-next', 'lucide-chevron-right'],
      ['.custom-last', 'lucide-chevrons-right'],
    ] as const) {
      // get 在找不到导航件时会直接失败，比 find 更适合作为用例前置条件。
      const button = wrapper.get(buttonSelector);
      expect(button.element.tagName).toBe('BUTTON');
      expect(button.classes()).toContain('size-8');
      expect(button.classes()).toContain('p-0');
      expect(button.html()).toContain(icon);
    }

    const ellipsis = wrapper.find('.custom-ellipsis');
    expect(ellipsis.classes()).toContain('size-8');
    expect(ellipsis.classes()).toContain('justify-center');
    expect(ellipsis.html()).toContain('lucide-ellipsis');
  });

  it('省略号支持自定义内容', /** 业务需要文字省略号时必须能覆盖默认图标。 */ async () => {
    const wrapper = mount(
      h(
        PaginationRoot,
        { itemsPerPage: 10, page: 1, total: 100 },
        {
          /** 渲染自定义省略号。 */
          default: () =>
            h(
              PaginationEllipsis,
              {},
              {
                /** 自定义省略号文案。 */
                default: () => '...',
              },
            ),
        },
      ),
    );
    await nextTick();

    expect(wrapper.text()).toBe('...');
  });
});

describe('分页导航件跳转', /** 点击未抛出页码会让用户无法翻页。 */ () => {
  it('首页、上一页、下一页与末页分别抛出目标页码', /** 目标页码算错会让用户跳到错误的分页。 */ async () => {
    const pages: unknown[] = [];
    const wrapper = mountPagination(pages);
    await nextTick();

    await wrapper.find('.custom-first').trigger('click');
    await wrapper.find('.custom-prev').trigger('click');
    await wrapper.find('.custom-next').trigger('click');
    await wrapper.find('.custom-last').trigger('click');
    await nextTick();

    // 受控页码不随点击改变，四次点击都按当前第 2 页计算目标页码。
    expect(pages).toEqual([1, 1, 3, 10]);
  });
});
