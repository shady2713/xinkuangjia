/**
 * 页面容器（page.vue）自适应高度的真实行为回归。
 *
 * 覆盖三条只在真实挂载下出现的契约：
 * ① 开启 autoContentHeight 后按页头、页脚、文档提示与偏移量折算内容高度；
 * ② 折算完成一个更新周期后才允许内容区滚动；
 * ③ 未开启自适应时不写入任何高度样式。
 * 额外确认 extra 具名插槽真实渲染。
 * 元素高度由排版决定，测试环境没有排版，因此只在测试里接管 offsetHeight 这一浏览器测量接口。
 */
import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Page } from '..';

/** 各区域在测试环境中的模拟高度，用于区分高度折算里读取的是哪个区域。 */
const HEADER_HEIGHT = 40;
const FOOTER_HEIGHT = 20;
const DOC_HEIGHT = 30;

/**
 * 按区域类名返回受控的 offsetHeight。
 * 测试环境不排版，若不接管测量接口，三个区域都会返回 0，无法证明各自被读入对应变量。
 * @param element 被测量元素。
 * @returns 该区域内的高度的像素值。
 */
function measuredHeight(element: Element): number {
  const classes = element.classList;
  if (classes.contains('items-start')) {
    return DOC_HEIGHT;
  }
  if (classes.contains('items-end')) {
    return HEADER_HEIGHT;
  }
  if (classes.contains('py-4')) {
    return FOOTER_HEIGHT;
  }
  return 0;
}

/**
 * 接管内容区高度样式的写入边界并记录写入值。
 * happy-dom 的样式解析会丢弃 calc() 内的 var()，仅从 DOM 反读不到真实写入值，
 * 因此这里只在样式写入这一浏览器接口边界上记录，不断言被测组件的内部状态。
 * @returns 按写入顺序记录的 height 取值数组。
 */
function recordWrittenHeights(): string[] {
  const written: string[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(
    CSSStyleDeclaration.prototype,
    'height',
  );
  vi.spyOn(CSSStyleDeclaration.prototype, 'height', 'set').mockImplementation(
    /** 记录本次写入值后再交给真实样式实现，保持 DOM 行为不变。 */ function (
      this: CSSStyleDeclaration,
      value: string,
    ) {
      written.push(value);
      descriptor?.set?.call(this, value);
    },
  );
  return written;
}

describe('页面容器自适应内容高度（page.vue）', /** 高度折算与滚动时机契约。 */ () => {
  afterEach(
    /** 恢复浏览器测量接口并清理运行时配置，避免影响其他用例。 */ () => {
      vi.restoreAllMocks();
      delete (window as { _VBEN_ADMIN_PRO_APP_CONF_?: unknown })
        ._VBEN_ADMIN_PRO_APP_CONF_;
    },
  );

  it('按页头、页脚、文档提示与偏移量折算内容高度', /** 三个区域高度与偏移量都必须参与计算，任一处漏算都会导致内容区被遮挡。 */ async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      /** 按区域类名返回受控高度。 */ function (this: HTMLElement) {
        return measuredHeight(this);
      },
    );
    // 文档提示区域只在运行时配置开启时渲染，这里按真实配置口径打开。
    (
      window as unknown as { _VBEN_ADMIN_PRO_APP_CONF_?: unknown }
    )._VBEN_ADMIN_PRO_APP_CONF_ = { VITE_APP_DOCALERT_ENABLE: 'true' };

    const writtenHeights = recordWrittenHeights();
    const wrapper = mount(Page, {
      props: {
        autoContentHeight: true,
        description: '说明文字',
        heightOffset: 12,
        title: '页面标题',
      },
      slots: {
        default: '<p class="page-body">正文</p>',
        doc: '<p class="page-doc">文档提示</p>',
        extra: '<span class="page-extra">额外操作</span>',
        footer: '<p class="page-footer">页脚</p>',
      },
    });
    await flushPromises();

    const content = wrapper.find('.h-full.p-4');
    expect(writtenHeights).toContain(
      `calc(var(--vben-content-height) - ${HEADER_HEIGHT}px - ${FOOTER_HEIGHT}px - ${DOC_HEIGHT}px - 12px)`,
    );
    // 折算完成前不允许内容区自己滚动，避免出现双滚动条。
    expect(content.attributes('style')).toContain('overflow-y: unset');

    // 折算在挂载后的一个延时窗口内完成，完成后内容区接管滚动。
    await new Promise(
      /** 等待实现声明的 30ms 折算窗口结束。 */ (resolve) => {
        setTimeout(resolve, 60);
      },
    );
    await flushPromises();
    expect(wrapper.find('.h-full.p-4').attributes('style')).toContain(
      'overflow-y: auto',
    );
  });

  it('extra 插槽渲染在页头区域内', /** 额外操作入口必须真实渲染，否则页面无法放置自定义按钮。 */ () => {
    const wrapper = mount(Page, {
      props: { title: '页面标题' },
      slots: {
        extra: '<span class="page-extra">额外操作</span>',
      },
    });

    expect(wrapper.find('.page-extra').text()).toBe('额外操作');
  });

  it('未开启自适应时不写入高度样式', /** 关闭自适应时内容高度交给样式表，组件不得覆盖。 */ async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      /** 按区域类名返回受控高度。 */ function (this: HTMLElement) {
        return measuredHeight(this);
      },
    );

    const writtenHeights = recordWrittenHeights();
    const wrapper = mount(Page, {
      props: { heightOffset: 12, title: '页面标题' },
      slots: { default: '<p class="page-body">正文</p>' },
    });
    await flushPromises();
    await new Promise(
      /** 等待实现的折算窗口结束，确认关闭时不会迟到写入。 */ (resolve) => {
        setTimeout(resolve, 60);
      },
    );
    await flushPromises();

    const content = wrapper.find('.h-full.p-4');
    expect(writtenHeights).toEqual([]);
    expect(content.attributes('style')).toBeUndefined();
  });

  it('页脚区域独立于内容区渲染', /** 页脚存在时必须渲染在内容区之外，避免被内容高度折算重复计入。 */ () => {
    const wrapper = mount(Page, {
      slots: { footer: '<p class="page-footer">页脚</p>' },
    });

    const footer = wrapper.find('.page-footer');
    expect(footer.exists()).toBe(true);
    expect(footer.element.closest('.h-full.p-4')).toBe(null);
  });
});
