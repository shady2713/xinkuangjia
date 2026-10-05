/**
 * 通知弹窗（effects/layouts 的 widgets/notification）真实交互回归。
 *
 * 该弹窗承载站内通知的查看、标记已读、删除、清空与跳转：列表项渲染错会让用户看不到通知内容，
 * 已读/删除事件断链会让消息永远处理不掉，清空与标记全部已读失灵会让用户只能逐条点，
 * “查看全部”不收起浮层会让面板长期遮挡页面，跳转分支写错会把站外链接当成站内路由推走
 * （或反之），用户点通知后停在原地。用例真实挂载组件、真实点击传送后的浮层按钮与列表项，
 * 断言真实 DOM、真实事件载荷与真实内存路由落点。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { Router, RouteRecordRaw } from 'vue-router';

import type { NotificationItem } from './types';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { $t, setupI18n } from '@vben/locales';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import Notification from './notification.vue';

vi.mock(
  '@vben/icons',
  /**
   * 图标来自远程 Iconify，属于外部渲染边界；替换为带名称标识的最小元素，
   * 既避免测试联网取图标，又让断言可以定位到具体的操作按钮。
   */ () => {
    /**
     * 生成带名称标识的图标替身组件。
     * @param name 图标名，同时作为 DOM 上的 data-icon 标识。
     * @returns 渲染为 i 元素的图标替身组件。
     */
    function createIconStub(name: string) {
      return { name, template: `<i data-icon="${name}"></i>` };
    }
    return {
      Bell: createIconStub('Bell'),
      CircleCheckBig: createIconStub('CircleCheckBig'),
      CircleX: createIconStub('CircleX'),
      MailCheck: createIconStub('MailCheck'),
    };
  },
);

/** 路由目标组件：跳转只需真实完成，不渲染业务内容。 */
const RouteView = defineComponent({
  name: 'NotificationRouteView',
  /** 渲染最小宿主节点，证明路由跳转真实落地。 */
  render: () => h('div', { 'data-test': 'notification-route-view' }),
});

/** 站内跳转目标路由表，覆盖无参数跳转与带查询参数的跳转。 */
const routes: RouteRecordRaw[] = [
  { component: RouteView, name: 'home', path: '/' },
  { component: RouteView, name: 'notice', path: '/notice' },
  { component: RouteView, name: 'notice-detail', path: '/notice/detail' },
];

/** 每个用例挂载的通知弹窗宿主；用例结束统一卸载并清理传送节点。 */
let mounted: undefined | VueWrapper;

/** 每个用例的真实内存路由；用例内断言跳转落点。 */
let router: Router;

/**
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

beforeAll(
  /** 装载真实中文语言包：否则 $t 返回空串，所有文案断言都会形同虚设。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

beforeEach(
  /** 为每个用例建立干净的就绪内存路由，避免上一个用例的落点残留。 */ async () => {
    router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/');
    await router.isReady();
  },
);

afterEach(
  /** 卸载宿主、清理传送节点并还原被替换的浏览器外部边界。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  },
);

/**
 * 构造一条通知数据。
 * @param overrides 需要覆盖的字段，未覆盖字段取用例默认值。
 * @returns 可直接传给通知弹窗的通知项。
 */
function createNotification(
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    avatar: 'DUMMY-avatar.png',
    date: '2024-01-01 10:00',
    id: 'DUMMY-通知-1',
    message: 'DUMMY-消息正文',
    title: 'DUMMY-通知标题',
    ...overrides,
  };
}

/**
 * 挂载通知弹窗并注入真实内存路由。
 * @param notifications 初始通知列表。
 * @param dot 是否显示铃铛红点。
 * @returns 已挂载的通知弹窗宿主。
 */
function mountNotification(
  notifications: NotificationItem[] = [],
  dot = false,
): VueWrapper {
  const wrapper = mount(Notification, {
    global: { plugins: [router] },
    props: { dot, notifications },
  });
  mounted = wrapper;
  return wrapper;
}

/**
 * 点击铃铛真实打开通知浮层，并等待内容传送挂载完成。
 * @param wrapper 已挂载的通知弹窗宿主。
 */
async function openPopover(wrapper: VueWrapper) {
  await wrapper.get('button.bell-button').trigger('click');
  await vi.waitFor(
    /** 等待传送后的浮层内容真实渲染。 */ () => {
      expect(readPopoverState(wrapper)).toBe('open');
    },
  );
}

/**
 * 读取浮层触发件上的真实开合状态。
 * @param wrapper 已挂载的通知弹窗宿主。
 * @returns 浮层触发件的 data-state 值。
 */
function readPopoverState(wrapper: VueWrapper) {
  return wrapper.find('button[data-state]').attributes('data-state');
}

/**
 * 按真实文案在传送后的浮层 DOM 中查找按钮。
 * @param text 目标按钮的文案。
 * @returns 命中的按钮元素，未找到时为 undefined。
 */
function findButtonByText(text: string) {
  return [...document.querySelectorAll('button')].find(
    /** 只保留文案与目标一致的按钮，避免点到相邻的操作。 */ (button) =>
      button.textContent?.trim() === text,
  );
}

/**
 * 在浮层中按图标标识定位操作按钮，用于只有图标没有文案的按钮。
 * @param iconName 按钮内图标的名称标识。
 * @returns 命中的按钮元素，未找到时为 undefined。
 */
function findIconButton(iconName: string) {
  const icon = document.querySelector(`[data-icon="${iconName}"]`);
  return icon?.closest('button') ?? undefined;
}

/**
 * 取出浮层中真实渲染的通知列表项。
 * @returns 通知列表项元素数组。
 */
function findNotificationRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('li')];
}

/**
 * 在指定列表项内按图标标识定位操作按钮。
 * @param row 通知列表项元素。
 * @param iconName 操作按钮内图标的名称标识。
 * @returns 命中的操作按钮，未找到时为 undefined。
 */
function findActionButton(row: HTMLElement, iconName: string) {
  const icon = row.querySelector(`[data-icon="${iconName}"]`);
  return icon?.closest('button') ?? undefined;
}

/**
 * 把 window.open 换成只记录调用的替身，避免测试真的打开新窗口。
 * @returns 记录调用参数的 window.open 替身。
 */
function stubWindowOpen() {
  return vi
    .spyOn(window, 'open')
    .mockImplementation(
      /** 记录外链地址并返回 null，模拟弹窗被浏览器拦截。 */ () =>
        null as unknown as Window,
    );
}

describe('通知弹窗列表渲染', /** 列表与状态的渲染决定用户能否看到并处理通知。 */ () => {
  it('无通知时展示空数据占位并禁用批量操作', /** 空列表却可点会让用户点了没有任何反馈。 */ async () => {
    const wrapper = mountNotification();

    await openPopover(wrapper);

    expect(document.body.textContent).toContain($t('common.noData'));
    expect(findNotificationRows()).toHaveLength(0);

    const makeAll = findIconButton('MailCheck');
    const clear = findButtonByText($t('ui.widgets.clearNotifications'));
    expect(makeAll?.hasAttribute('disabled')).toBe(true);
    expect(clear?.hasAttribute('disabled')).toBe(true);
  });

  it('渲染通知正文，未读与已读分别给出确认与删除操作', /** 未读/已读操作错位会让用户删掉不该删的消息。 */ async () => {
    mountNotification([
      createNotification({ title: 'DUMMY-未读通知' }),
      createNotification({
        id: 'DUMMY-通知-2',
        isRead: true,
        title: 'DUMMY-已读通知',
      }),
    ]);

    await openPopover(mounted as VueWrapper);

    const rows = findNotificationRows();
    expect(rows).toHaveLength(2);
    expect(document.body.textContent).toContain('DUMMY-未读通知');
    expect(document.body.textContent).toContain('DUMMY-已读通知');
    expect(document.body.textContent).toContain('DUMMY-消息正文');
    expect(document.body.textContent).toContain('2024-01-01 10:00');
    // 未读项只有确认按钮，已读项只有删除按钮。
    expect(
      findActionButton(rows[0] as HTMLElement, 'CircleCheckBig'),
    ).toBeDefined();
    expect(findActionButton(rows[0] as HTMLElement, 'CircleX')).toBeUndefined();
    expect(findActionButton(rows[1] as HTMLElement, 'CircleX')).toBeDefined();
    expect(
      findActionButton(rows[1] as HTMLElement, 'CircleCheckBig'),
    ).toBeUndefined();
    expect(findIconButton('MailCheck')?.hasAttribute('disabled')).toBe(false);
    expect(
      findButtonByText($t('ui.widgets.clearNotifications'))?.hasAttribute(
        'disabled',
      ),
    ).toBe(false);
  });

  it('dot 为真时铃铛渲染未读红点', /** 未读提示丢失会让用户错过新消息。 */ async () => {
    const wrapper = mountNotification([], true);

    expect(wrapper.find('button.bell-button span.bg-primary').exists()).toBe(
      true,
    );
  });

  it('dot 为假时铃铛不渲染未读红点', /** 无未读仍显示红点会误导用户。 */ async () => {
    const wrapper = mountNotification([], false);

    expect(wrapper.find('button.bell-button span.bg-primary').exists()).toBe(
      false,
    );
  });
});

describe('通知弹窗事件契约', /** 事件载荷是外层处理通知的唯一入口。 */ () => {
  it('点击铃铛在打开与收起之间切换并抛出真实状态', /** 状态不抛出会让外层无法同步提醒角标。 */ async () => {
    const wrapper = mountNotification();

    await wrapper.get('button.bell-button').trigger('click');
    await vi.waitFor(
      /** 等待浮层真实打开。 */ () => {
        expect(readPopoverState(wrapper)).toBe('open');
      },
    );
    expect(wrapper.emitted('open')).toStrictEqual([[true]]);

    await wrapper.get('button.bell-button').trigger('click');
    await vi.waitFor(
      /** 等待浮层真实收起。 */ () => {
        expect(readPopoverState(wrapper)).toBe('closed');
      },
    );
    expect(wrapper.emitted('open')).toStrictEqual([[true], [false]]);
  });

  it('浮层触发件自身的开合更新会写回组件状态', /** v-model 没接住浮层更新会让面板点了打不开。 */ async () => {
    const wrapper = mountNotification([createNotification()]);

    // 直接点击浮层触发件本体，走 reka-ui 自身的开合更新链路（不经过组件的点击处理器）。
    await wrapper.get('button[data-state]').trigger('click');
    await vi.waitFor(
      /** 等待浮层自身抛出的开合更新写回组件状态并渲染内容。 */ () => {
        expect(readPopoverState(wrapper)).toBe('open');
        expect(document.body.textContent).toContain('DUMMY-通知标题');
      },
    );
    // 这条链路不经过组件自己的点击处理器，因此不应额外抛出 open 事件。
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('点击未读通知的确认按钮抛出该条通知', /** 载荷错项会把别的消息标记成已读。 */ async () => {
    const unread = createNotification({ title: 'DUMMY-待确认通知' });
    const wrapper = mountNotification([unread]);
    await openPopover(wrapper);

    const row = findNotificationRows()[0] as HTMLElement;
    const confirmButton = findActionButton(row, 'CircleCheckBig');
    expect(confirmButton).toBeDefined();
    confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(
      /** 等待确认事件真实抛出。 */ () => {
        expect(wrapper.emitted('read')).toHaveLength(1);
      },
    );
    expect(wrapper.emitted('read')?.[0]?.[0]).toStrictEqual(unread);
  });

  it('点击已读通知的删除按钮抛出该条通知', /** 删除事件断链会让用户无法清理历史消息。 */ async () => {
    const read = createNotification({ isRead: true, title: 'DUMMY-已读通知' });
    const wrapper = mountNotification([read]);
    await openPopover(wrapper);

    const row = findNotificationRows()[0] as HTMLElement;
    const removeButton = findActionButton(row, 'CircleX');
    expect(removeButton).toBeDefined();
    removeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(
      /** 等待删除事件真实抛出。 */ () => {
        expect(wrapper.emitted('remove')).toHaveLength(1);
      },
    );
    expect(wrapper.emitted('remove')?.[0]?.[0]).toStrictEqual(read);
  });

  it('点击标记全部已读与清空分别抛出对应事件', /** 批量操作失灵会让用户只能逐条处理通知。 */ async () => {
    const wrapper = mountNotification([createNotification()]);
    await openPopover(wrapper);

    findIconButton('MailCheck')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    findButtonByText($t('ui.widgets.clearNotifications'))?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    await vi.waitFor(
      /** 等待批量事件真实抛出。 */ () => {
        expect(wrapper.emitted('makeAll')).toHaveLength(1);
        expect(wrapper.emitted('clear')).toHaveLength(1);
      },
    );
    expect(wrapper.emitted('makeAll')).toStrictEqual([[]]);
    expect(wrapper.emitted('clear')).toStrictEqual([[]]);
  });

  it('点击查看全部抛出事件并收起浮层', /** 不收起会让浮层继续遮挡即将打开的页面。 */ async () => {
    const wrapper = mountNotification([createNotification()]);
    await openPopover(wrapper);

    findButtonByText($t('ui.widgets.viewAll'))?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    await vi.waitFor(
      /** 等待查看全部事件抛出且浮层真实收起。 */ () => {
        expect(wrapper.emitted('viewAll')).toHaveLength(1);
        expect(readPopoverState(wrapper)).toBe('closed');
      },
    );
  });
});

describe('通知点击跳转', /** 跳转分支决定用户能否落到通知指向的页面。 */ () => {
  it('站内跳转原样带上 query 与 state', /** query 丢失会让详情页拿不到业务参数。 */ async () => {
    mountNotification([
      createNotification({
        link: '/notice/detail',
        query: { id: 'DUMMY-42' },
        state: { from: 'DUMMY-通知面板' },
      }),
    ]);
    await openPopover(mounted as VueWrapper);

    findNotificationRows()[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    await vi.waitFor(
      /** 等待站内路由真实跳转完成。 */ () => {
        expect(router.currentRoute.value.path).toBe('/notice/detail');
      },
    );
    expect(router.currentRoute.value.query).toStrictEqual({ id: 'DUMMY-42' });
    // vue-router 4.6 不再把 state 挂到 currentRoute 上，state 的真实归宿是 history.state。
    expect(router.options.history.state).toStrictEqual({
      from: 'DUMMY-通知面板',
    });
  });

  it('站内跳转缺省 query 时补空对象', /** query 为 undefined 会让部分路由守卫读取失败。 */ async () => {
    mountNotification([createNotification({ link: '/notice' })]);
    await openPopover(mounted as VueWrapper);

    findNotificationRows()[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    await vi.waitFor(
      /** 等待站内路由真实跳转完成。 */ () => {
        expect(router.currentRoute.value.path).toBe('/notice');
      },
    );
    expect(router.currentRoute.value.query).toStrictEqual({});
  });

  it('https 外链在新标签页打开且不影响当前路由', /** 把外链当站内路由推走会让用户留在站内空白页。 */ async () => {
    const open = stubWindowOpen();
    mountNotification([
      createNotification({ link: 'https://DUMMY-example.com/notice' }),
    ]);
    await openPopover(mounted as VueWrapper);

    findNotificationRows()[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    await vi.waitFor(
      /** 等待外链真实交给浏览器打开。 */ () => {
        expect(open).toHaveBeenCalledWith(
          'https://DUMMY-example.com/notice',
          '_blank',
        );
      },
    );
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('http 外链同样在新标签页打开', /** 只识别 https 会让 http 外链被当成站内路径。 */ async () => {
    const open = stubWindowOpen();
    mountNotification([
      createNotification({ link: 'http://DUMMY-example.com/notice' }),
    ]);
    await openPopover(mounted as VueWrapper);

    findNotificationRows()[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    await vi.waitFor(
      /** 等待外链真实交给浏览器打开。 */ () => {
        expect(open).toHaveBeenCalledWith(
          'http://DUMMY-example.com/notice',
          '_blank',
        );
      },
    );
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('没有链接的通知被点击时不发生任何跳转', /** 无链接仍跳转会把用户带到错误页面。 */ async () => {
    const open = stubWindowOpen();
    mountNotification([createNotification({ title: 'DUMMY-纯文本通知' })]);
    await openPopover(mounted as VueWrapper);

    findNotificationRows()[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await Promise.resolve();

    expect(open).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/');
  });
});
