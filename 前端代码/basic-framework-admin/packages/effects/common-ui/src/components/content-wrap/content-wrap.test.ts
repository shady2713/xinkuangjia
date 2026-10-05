/**
 * 内容包裹容器（common-ui 的 components/content-wrap/content-wrap）真实行为回归。
 *
 * 容器为卡片式内容区提供页头、内容区与页脚：开启自适应后必须按页头、页脚与偏移量折算内容
 * 高度，折算完成前不允许内容区自己滚动（否则会出现双滚动条），关闭自适应时不得覆盖样式表
 * 的高度；页头与页脚的显隐由标题、说明与插槽共同决定，判断写错会让页头整块消失或空留白；
 * 自定义类名必须与内置样式合并。用例真实挂载容器、真实等待折算窗口结束，并断言真实 DOM。
 *
 * 元素高度由排版决定，测试环境没有排版引擎，因此只在测试里接管 offsetHeight 这一浏览器
 * 测量接口；happy-dom 的样式解析会丢弃 calc() 内的 var()，因此同时接管样式写入边界记录取值。
 */
import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import ContentWrap from './content-wrap.vue';

/** 页头与页脚在测试环境中的模拟高度，用于区分高度折算里读取的是哪个区域。 */
const HEADER_HEIGHT = 40;
const FOOTER_HEIGHT = 20;

/**
 * 按区域类名返回受控的 offsetHeight。
 * 测试环境不排版，若不接管测量接口，两个区域都会返回 0，无法证明各自被读入对应变量。
 * @param element 被测量元素。
 * @returns 该区域内的高度的像素值。
 */
function measuredHeight(element: Element): number {
  const classes = element.classList;
  if (classes.contains('items-end')) {
    return HEADER_HEIGHT;
  }
  if (classes.contains('align-center')) {
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

afterEach(
  /** 恢复被接管的浏览器测量接口。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('内容容器自适应高度', /** 高度折算与滚动时机决定内容会不会被页头页脚遮挡。 */ () => {
  it('按页头、页脚与偏移量折算内容高度', /** 任一区域漏算都会让内容区被遮挡或出现双滚动条。 */ async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      /** 按区域类名返回受控高度。 */ function (this: HTMLElement) {
        return measuredHeight(this);
      },
    );
    const writtenHeights = recordWrittenHeights();
    const wrapper = mount(ContentWrap, {
      props: {
        autoContentHeight: true,
        contentClass: 'DUMMY-内容类',
        description: 'DUMMY-说明文字',
        footerClass: 'DUMMY-页脚类',
        headerClass: 'DUMMY-页头类',
        heightOffset: 12,
        title: 'DUMMY-标题',
      },
      slots: {
        default: '<p class="content-body">DUMMY-正文</p>',
        footer: '<p class="content-footer">DUMMY-页脚</p>',
      },
    });
    await flushPromises();

    expect(writtenHeights).toContain(
      `calc(var(--vben-content-height) - ${HEADER_HEIGHT}px - ${FOOTER_HEIGHT}px - 12px)`,
    );
    // 折算完成前不允许内容区自己滚动，避免出现双滚动条。
    expect(wrapper.find('div.h-full.p-4').attributes('style')).toContain(
      'overflow-y: unset',
    );

    // 折算在挂载后的一个延时窗口内完成，完成后内容区接管滚动。
    await vi.waitFor(
      /** 等待折算窗口结束并让内容区接管滚动。 */ () => {
        expect(wrapper.find('div.h-full.p-4').attributes('style')).toContain(
          'overflow-y: auto',
        );
      },
    );
    wrapper.unmount();
  });

  it('未开启自适应时不写入任何高度样式', /** 关闭自适应时高度交给样式表，组件不得覆盖。 */ async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      /** 按区域类名返回受控高度。 */ function (this: HTMLElement) {
        return measuredHeight(this);
      },
    );
    const writtenHeights = recordWrittenHeights();
    const wrapper = mount(ContentWrap, {
      props: { heightOffset: 12, title: 'DUMMY-标题' },
      slots: { default: '<p class="content-body">DUMMY-正文</p>' },
    });
    await flushPromises();
    // 等过折算窗口，确认关闭自适应后不会迟到写入高度。
    await vi.waitFor(
      /** 等待超过实现声明的折算窗口，确认没有迟到写入。 */ async () => {
        await flushPromises();
        expect(
          wrapper.find('div.h-full.p-4').attributes('style'),
        ).toBeUndefined();
      },
    );

    expect(writtenHeights).toEqual([]);
    wrapper.unmount();
  });
});

describe('内容容器结构', /** 页头页脚的显隐与类名合并决定卡片排版是否完整。 */ () => {
  it('传入标题与说明时渲染页头并合并自定义类名', /** 类名被覆盖会让调用方的排版样式失效。 */ () => {
    const wrapper = mount(ContentWrap, {
      props: {
        contentClass: 'DUMMY-内容类',
        description: 'DUMMY-说明文字',
        footerClass: 'DUMMY-页脚类',
        headerClass: 'DUMMY-页头类',
        title: 'DUMMY-标题',
      },
      slots: {
        default: '<p class="content-body">DUMMY-正文</p>',
        extra: '<span class="content-extra">DUMMY-额外操作</span>',
        footer: '<p class="content-footer">DUMMY-页脚</p>',
      },
    });

    const header = wrapper.find('div.items-end');
    const content = wrapper.find('div.h-full.p-4');
    const footer = wrapper.find('div.align-center');
    expect(header.exists()).toBe(true);
    expect(header.classes()).toContain('border-b');
    expect(header.classes()).toContain('DUMMY-页头类');
    expect(header.text()).toContain('DUMMY-标题');
    expect(header.text()).toContain('DUMMY-说明文字');
    expect(header.find('.content-extra').text()).toBe('DUMMY-额外操作');
    expect(content.classes()).toContain('p-4');
    expect(content.classes()).toContain('DUMMY-内容类');
    expect(content.find('.content-body').text()).toBe('DUMMY-正文');
    expect(footer.classes()).toContain('DUMMY-页脚类');
    expect(footer.find('.content-footer').text()).toBe('DUMMY-页脚');
    wrapper.unmount();
  });

  it('只提供额外操作插槽时同样渲染页头', /** 只看标题判断显隐会让只有操作按钮的页头整块消失。 */ () => {
    const wrapper = mount(ContentWrap, {
      slots: {
        default: '<p class="content-body">DUMMY-正文</p>',
        extra: '<span class="content-extra">DUMMY-额外操作</span>',
      },
    });

    const header = wrapper.find('div.items-end');
    expect(header.exists()).toBe(true);
    expect(header.find('.content-extra').exists()).toBe(true);
    // 没有标题与说明时不得渲染空的标题行与说明行。
    expect(header.find('div.mb-2').exists()).toBe(false);
    expect(header.find('p.text-muted-foreground').exists()).toBe(false);
    // 没有页脚插槽时不渲染页脚区域。
    expect(wrapper.find('div.align-center').exists()).toBe(false);
    wrapper.unmount();
  });

  it('标题插槽替换默认标题行', /** 标题插槽失效会让调用方无法自定义页头标题。 */ () => {
    const wrapper = mount(ContentWrap, {
      slots: {
        default: '<p class="content-body">DUMMY-正文</p>',
        title: '<h2 class="content-title">DUMMY-插槽标题</h2>',
      },
    });

    const header = wrapper.find('div.items-end');
    expect(header.exists()).toBe(true);
    expect(header.find('.content-title').text()).toBe('DUMMY-插槽标题');
    // 插槽接管标题后不再渲染默认标题行。
    expect(header.find('div.mb-2').exists()).toBe(false);
    wrapper.unmount();
  });

  it('说明插槽替换默认说明行', /** 说明插槽失效会让调用方无法补充富文本说明。 */ () => {
    const wrapper = mount(ContentWrap, {
      slots: {
        default: '<p class="content-body">DUMMY-正文</p>',
        description: '<p class="content-description">DUMMY-插槽说明</p>',
      },
    });

    const header = wrapper.find('div.items-end');
    expect(header.exists()).toBe(true);
    expect(header.find('.content-description').text()).toBe('DUMMY-插槽说明');
    // 插槽接管说明后不再渲染默认说明行。
    expect(header.find('p.text-muted-foreground').exists()).toBe(false);
    wrapper.unmount();
  });

  it('未提供标题说明与额外操作时不渲染页头', /** 条件写松会让卡片顶部多出一条空白分隔线。 */ () => {
    const wrapper = mount(ContentWrap, {
      slots: { default: '<p class="content-body">DUMMY-正文</p>' },
    });

    expect(wrapper.find('div.items-end').exists()).toBe(false);
    expect(wrapper.find('div.align-center').exists()).toBe(false);
    expect(wrapper.find('.content-body').text()).toBe('DUMMY-正文');
    expect(wrapper.classes()).toContain('rounded-xl');
    wrapper.unmount();
  });
});
