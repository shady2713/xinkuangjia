/**
 * OAuth2 授权同意页（views/_core/authentication/sso-login）真实行为回归。
 *
 * 页面解析授权请求参数、按请求范围过滤后端返回的范围、把默认勾选项写进表单，并在用户同意
 * 或拒绝时组装已授权与已取消两组范围：参数解析丢失会让授权请求缺少客户端标识；范围过滤
 * 写反会把客户端没申请过的权限一并展示并授权出去；同意时未把未勾选项放进取消集合会让用户
 * 无法收回既有授权；拒绝时空集合写错会让"拒绝"变成一次全量授权；后端未返回跳转地址时
 * 仍然跳转会打开一个空地址。用例挂载真实页面组件，只替换框架容器、表单渲染、路由参数、
 * 网络边界与页面跳转。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authorize, getAuthorize } from '#/api/system/oauth2/open';

import SsoLogin from './sso-login.vue';

/** 挂起请求的结算入口：由用例在断言之后释放。 */
type ReleaseHandler = () => void;

/** 表单 API 替身：用例按场景设置取值与断言初值写入。 */
const formProbe = vi.hoisted(
  /** 建立可设置返回值、可断言的表单 API 与配置替身。 */ () => ({
    api: {
      getValues: vi.fn(),
      setFieldValue: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 路由查询参数替身：用例按场景设置授权请求参数。 */
const routeProbe = vi.hoisted(
  /** 建立可替换查询参数的路由替身。 */ () => ({
    query: {} as Record<string, unknown>,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 保留其余导出，只替换标题容器与按钮为可定位的最小实现。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    const AuthTitleStub = defineComponent({
      name: 'AuthTitleStub',
      /**
       * 渲染标题与描述插槽，使客户端名与提示文案进入组件树。
       * @param _props 未声明的属性，本替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染标题与描述两个插槽。 */ () =>
          h('div', { class: 'auth-title' }, [
            h('div', { class: 'auth-title-text' }, slots.default?.()),
            h('div', { class: 'auth-title-desc' }, slots.desc?.()),
          ]);
      },
    });
    const ButtonStub = defineComponent({
      name: 'VbenButtonStub',
      props: {
        /** 加载态，用于核对提交期间的按钮状态。 */
        loading: { default: false, type: Boolean },
      },
      /**
       * 渲染可点击按钮并透出加载态。
       * @param props 按钮替身声明的属性。
       * @param context 组件上下文，用于取用默认插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染按钮并透出加载态。 */ () =>
          h(
            'button',
            { 'data-loading': String(props.loading) },
            slots.default?.(),
          );
      },
    });
    return {
      ...original,
      AuthenticationAuthTitle: AuthTitleStub,
      VbenButton: ButtonStub,
    };
  },
);

vi.mock(
  '#/adapter/form',
  /** 只替换表单渲染边界，页面的范围组装与表单写入保持真实实现。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const FormStub = defineComponent({
      name: 'FormStub',
      /**
       * 渲染可定位的表单占位节点。
       * @returns 渲染占位节点的渲染函数。
       */
      setup() {
        return /** 输出可定位节点，便于断言表单已进入组件树。 */ () =>
          h('div', { class: 'form-stub' });
      },
    });
    return {
      /**
       * 记录页面声明的表单配置并返回替身组件与替身 API。
       * @param options 页面传给 useVbenForm 的配置。
       * @returns 替身表单组件与替身 API 的二元组。
       */
      useVbenForm: (options: Record<string, unknown>) => {
        formProbe.options = options;
        return [FormStub, formProbe.api];
      },
    };
  },
);

vi.mock(
  'vue-router',
  /** 路由参数是外部边界，只提供当前查询串。 */ () => ({
    /** 返回用例设置的查询参数。 */
    useRoute: () => routeProbe,
  }),
);

vi.mock(
  '#/api/system/oauth2/open',
  /** 授权接口是外部边界，由用例决定返回数据或失败。 */ () => ({
    authorize: vi.fn(),
    getAuthorize: vi.fn(),
  }),
);

/** 页面跳转替身：记录被写入的地址，不真正导航。 */
const locationStub = { href: '' };

/** 后端返回的授权范围基线：覆盖默认勾选、非默认勾选与请求未声明的范围。 */
const SCOPE_FIXTURE = [
  { key: 'user.read', value: true },
  { key: 'user.write', value: false },
  { key: 'order.read', value: true },
];

beforeEach(
  /** 清空替身调用、复位查询参数与跳转地址，并登记默认成功返回。 */ () => {
    vi.clearAllMocks();
    vi.stubGlobal('location', locationStub);
    locationStub.href = '';
    formProbe.api.getValues.mockResolvedValue({ scopes: [] });
    formProbe.api.setFieldValue.mockResolvedValue(undefined);
    routeProbe.query = {};
    vi.mocked(getAuthorize).mockResolvedValue({
      client: {
        logo: 'https://files.test/client.png',
        name: 'DUMMY 第三方应用',
      },
      scopes: SCOPE_FIXTURE,
    } as never);
    vi.mocked(authorize).mockResolvedValue(
      'https://files.test/callback?code=1',
    );
  },
);

/**
 * 挂载授权页并等待挂载期的初始化链路落地。
 * @returns 已挂载的组件包装器。
 */
async function mountSsoLogin() {
  const wrapper = mount(SsoLogin);
  await flushPromises();
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 取出页面声明的表单配置里的范围选项。
 * @returns 范围勾选项列表。
 * @throws Error 页面未声明表单配置时抛出，避免用例静默地什么都不验证。
 */
function scopeOptions() {
  const schema = formProbe.options?.schema;
  const list = typeof schema === 'function' ? schema() : schema;
  if (!Array.isArray(list)) {
    throw new TypeError('授权页未声明表单配置');
  }
  const first = list[0] as { componentProps?: { options?: unknown[] } };
  return (first.componentProps?.options ?? []) as Array<{
    label: string;
    value: string;
  }>;
}

describe('授权页初始化', /** 初始化决定客户端信息、可授权范围与表单初始勾选。 */ () => {
  it('缺少 client_id 时直接返回且不请求授权信息', /** 未拦截会让未登录用户在授权页与登录页之间循环弹窗。 */ async () => {
    await mountSsoLogin();

    expect(getAuthorize).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('带 scope 参数时先尝试自动授权并在返回地址后跳转', /** 已授权过的范围未走自动授权会让用户每次都要重复确认。 */ async () => {
    routeProbe.query = {
      client_id: 'DUMMY_client',
      redirect_uri: 'https://files.test/callback',
      response_type: 'code',
      scope: 'user.read user.write',
      state: 'DUMMY_state',
    };
    vi.mocked(authorize).mockResolvedValue('https://files.test/auto?code=2');

    await mountSsoLogin();

    expect(authorize).toHaveBeenCalledWith(
      'code',
      'DUMMY_client',
      'https://files.test/callback',
      'DUMMY_state',
      true,
      ['user.read', 'user.write'],
      [],
    );
    expect(locationStub.href).toBe('https://files.test/auto?code=2');
    // 自动授权成功后不再拉取授权页信息，避免多余的权限展示。
    expect(getAuthorize).not.toHaveBeenCalled();
  });

  it('自动授权未返回地址时继续拉取授权页信息并只保留请求声明的范围', /** 范围过滤写反会把客户端没申请过的权限展示并授权出去。 */ async () => {
    routeProbe.query = {
      client_id: 'DUMMY_client',
      scope: 'user.read',
    };
    // 自动授权未返回跳转地址，页面必须继续拉取授权页信息。
    vi.mocked(authorize).mockResolvedValue(undefined as never);

    const wrapper = await mountSsoLogin();

    expect(getAuthorize).toHaveBeenCalledWith('DUMMY_client');
    expect(scopeOptions()).toEqual([
      { label: '访问你的个人信息', value: 'user.read' },
    ]);
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('请求未声明范围时接受后端返回的全部范围', /** 未把后端范围写回请求参数会让后续授权提交丢失范围集合。 */ async () => {
    routeProbe.query = { client_id: 'DUMMY_client' };

    await mountSsoLogin();

    expect(
      scopeOptions().map(/** 提取范围键用于断言。 */ (o) => o.value),
    ).toEqual(['user.read', 'user.write', 'order.read']);
    // 未声明范围时后端返回的键必须回填到请求参数，供拒绝路径复用。
    expect(scopeOptions()).toHaveLength(3);
  });

  it('只把后端标记为默认勾选的范围写入表单初值', /** 把非默认勾选的范围写进初值会替用户做出授权决定。 */ async () => {
    routeProbe.query = { client_id: 'DUMMY_client' };

    await mountSsoLogin();

    expect(formProbe.api.setFieldValue).toHaveBeenCalledWith('scopes', [
      'user.read',
      'order.read',
    ]);
  });

  it('请求声明的范围会过滤掉后端未标记默认勾选的项', /** 过滤只按默认值而不按请求范围会让表单初值多出未申请的范围。 */ async () => {
    routeProbe.query = {
      client_id: 'DUMMY_client',
      scope: 'user.read user.write',
    };
    // 自动授权未返回跳转地址，页面必须继续拉取授权页信息。
    vi.mocked(authorize).mockResolvedValue(undefined as never);

    await mountSsoLogin();

    expect(formProbe.api.setFieldValue).toHaveBeenCalledWith('scopes', [
      'user.read',
    ]);
  });
});

describe('授权范围展示口径', /** 展示名决定用户能否看懂第三方应用在申请什么权限。 */ () => {
  it('已知范围展示中文说明，未知范围原样展示', /** 未知范围被吞掉会让用户看不到实际申请的权限。 */ async () => {
    routeProbe.query = { client_id: 'DUMMY_client' };

    await mountSsoLogin();

    const labels = Object.fromEntries(
      scopeOptions().map(
        /** 以范围键为索引整理展示名，便于逐项断言。 */ (option) => [
          option.value,
          option.label,
        ],
      ),
    );
    expect(labels['user.read']).toBe('访问你的个人信息');
    expect(labels['user.write']).toBe('修改你的个人信息');
    expect(labels['order.read']).toBe('order.read');
  });
});

describe('授权页提交', /** 提交决定后端收到多少已授权范围与多少被取消的范围。 */ () => {
  it('同意时按勾选拆出已授权与已取消两组范围并跳转', /** 未勾选项若不同时放进取消集合，用户无法收回既有授权。 */ async () => {
    routeProbe.query = {
      client_id: 'DUMMY_client',
      redirect_uri: 'https://files.test/callback',
      response_type: 'code',
      state: 'DUMMY_state',
    };
    formProbe.api.getValues.mockResolvedValue({ scopes: ['user.read'] });
    const wrapper = await mountSsoLogin();

    await wrapper.findAll('button')[0]?.trigger('click');
    await flushPromises();

    expect(authorize).toHaveBeenLastCalledWith(
      'code',
      'DUMMY_client',
      'https://files.test/callback',
      'DUMMY_state',
      false,
      ['user.read'],
      ['user.write', 'order.read'],
    );
    expect(locationStub.href).toBe('https://files.test/callback?code=1');
  });

  it('拒绝时全部范围按取消提交且不授权任何范围', /** 拒绝写成全量授权会替用户交出全部权限。 */ async () => {
    routeProbe.query = {
      client_id: 'DUMMY_client',
      redirect_uri: 'https://files.test/callback',
      response_type: 'code',
      state: 'DUMMY_state',
    };
    const wrapper = await mountSsoLogin();

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    const forwarded = vi.mocked(authorize).mock.calls.at(-1);
    expect(forwarded?.[4]).toBe(false);
    expect(forwarded?.[5]).toEqual([]);
    expect(forwarded?.[6]).toEqual(['user.read', 'user.write', 'order.read']);
  });

  it('后端未返回跳转地址时不导航', /** 跳转到空地址会把用户带到一个空白页。 */ async () => {
    routeProbe.query = { client_id: 'DUMMY_client' };
    vi.mocked(authorize).mockResolvedValue(undefined as never);
    const wrapper = await mountSsoLogin();

    await wrapper.findAll('button')[0]?.trigger('click');
    await flushPromises();

    expect(locationStub.href).toBe('');
  });

  it('提交期间按钮进入加载态并在结束后复位', /** 未置加载态会让用户重复点击并产生多次授权请求。 */ async () => {
    routeProbe.query = { client_id: 'DUMMY_client' };
    let release: ReleaseHandler | undefined;
    vi.mocked(authorize).mockImplementation(
      /** 保持授权请求挂起，便于观察提交期间的加载态。 */ () =>
        new Promise<string>(
          /** 记录结算入口，由用例在断言后释放。 */ (resolve) => {
            /** 结算挂起的授权请求。 */
            const settle = () => resolve('https://files.test/callback?code=1');
            release = settle;
          },
        ) as never,
    );
    const wrapper = await mountSsoLogin();
    const agreeButton = wrapper.findAll('button')[0];

    await agreeButton?.trigger('click');
    await flushPromises();

    expect(agreeButton?.attributes('data-loading')).toBe('true');

    release?.();
    await flushPromises();

    expect(wrapper.findAll('button')[0]?.attributes('data-loading')).toBe(
      'false',
    );
  });

  it('回车键等同同意授权', /** 键盘用户若无法提交，只能被迫点击同意。 */ async () => {
    routeProbe.query = { client_id: 'DUMMY_client' };
    const wrapper = await mountSsoLogin();
    vi.mocked(authorize).mockClear();

    await wrapper.trigger('keydown.enter');
    await flushPromises();

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(authorize).mock.calls[0]?.[4]).toBe(false);
  });
});

describe('授权页标题', /** 标题决定用户是否知道正在给哪个第三方应用授权。 */ () => {
  it('展示客户端名称与权限说明', /** 客户端名缺失会让用户在不知道授权对象的情况下点击同意。 */ async () => {
    routeProbe.query = { client_id: 'DUMMY_client' };

    const wrapper = await mountSsoLogin();

    expect(wrapper.get('.auth-title-text').text()).toContain(
      'DUMMY 第三方应用',
    );
    expect(wrapper.get('.auth-title-desc').text()).toContain(
      '此第三方应用请求获得以下权限',
    );
  });
});
