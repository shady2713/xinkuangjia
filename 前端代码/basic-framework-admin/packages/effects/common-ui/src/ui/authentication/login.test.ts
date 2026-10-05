/**
 * 登录页（effects/common-ui 的 ui/authentication/login）校验、记住用户名与跳转回归。
 *
 * 登录页是系统唯一入口：必填校验失效会把空账号或空密码发到后端并让用户看不到失败原因；
 * 记住用户名的存储键取值错误会让不同站点的账号互相覆盖，未勾选时不清空会让上一位使用者
 * 的账号继续回填；忘记密码与回车提交失效会让用户无法自助找回密码或只能用鼠标提交。
 * 用例挂载真实组件与真实表单引擎，真实填写输入框、真实点击提交，仅把浏览器本地存储的
 * 主机名与路由跳转当作真实外部输入读回。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { z } from '@vben-core/form-ui';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Login from './login.vue';

/** 登录页用例属性：只列出用例真正覆盖的字段，其余走组件默认值。 */
interface LoginCaseProps {
  formSchema?: VbenFormSchema[];
  forgetPasswordPath?: string;
  loading?: boolean;
  showForgetPassword?: boolean;
  showRememberMe?: boolean;
  submitButtonText?: string;
  subTitle?: string;
  title?: string;
}

/** 登录页经 defineExpose 暴露的表单操作实例，用于核对父组件能读到真实表单值。 */
interface ExposedFormApi {
  /** 取出真实表单操作实例。 */
  getFormApi: () => ExposedFormValues;
}

/** 暴露实例上用例真正调用的取值契约。 */
interface ExposedFormValues {
  /** 读取当前表单值。 */
  getValues: () => Promise<unknown>;
}

/** 占位路由组件：登录页用例只关心跳转结果，目标页面内容不参与断言。 */
const EmptyRoute = {
  /** 占位渲染函数不输出任何内容。 */
  render: () => null,
};

/** 最近一次挂载的登录页，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: undefined | VueWrapper;

beforeEach(
  /** 清空“记住用户名”存储，避免上一个用例写入的账号被本用例读到。 */ () => {
    localStorage.clear();
  },
);

afterEach(
  /** 卸载组件并复位替身，避免用例之间互相影响。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
  },
);

/**
 * 按组件约定推导“记住用户名”的本地存储键。
 * 键里的主机名来自浏览器地址栏这一外部输入，测试进程无法伪造真实域名，因此按同一规则读取。
 * @returns 当前环境下的“记住用户名”存储键。
 */
function rememberMeKey() {
  return `REMEMBER_ME_USERNAME_${location.hostname}`;
}

/**
 * 构造登录表单约束：账号与密码必填。
 * 生产环境由应用适配器把同一份 zod 约束交给表单引擎，这里保持真实校验链路而不是直接给结果。
 * @returns 登录页表单项列表。
 */
function loginSchema(): VbenFormSchema[] {
  return [
    {
      component: 'VbenInput',
      componentProps: { placeholder: '请输入账号' },
      fieldName: 'username',
      label: '账号',
      rules: z.string().min(1, { message: '请输入账号' }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: { placeholder: '请输入密码' },
      fieldName: 'password',
      label: '密码',
      rules: z.string().min(1, { message: '请输入密码' }),
    },
  ];
}

/**
 * 建立真实内存路由并挂载登录页。
 * @param props 登录页属性，用来覆盖路径、文案与加载态。
 * @returns 真实路由实例与已挂载的组件包装器。
 */
async function mountLogin(props: LoginCaseProps = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: EmptyRoute, path: '/' },
      { component: EmptyRoute, path: '/auth/code-login' },
      { component: EmptyRoute, path: '/auth/forget-password' },
      { component: EmptyRoute, path: '/auth/login' },
      { component: EmptyRoute, path: '/auth/register' },
      { component: EmptyRoute, path: '/custom/forget' },
    ],
  });
  await router.push('/auth/login');
  await router.isReady();
  const wrapper = mount(Login, {
    global: { plugins: [router] },
    props: { formSchema: loginSchema(), ...props },
  });
  mounted = wrapper as VueWrapper;
  await flushPromises();
  return { router, wrapper };
}

/**
 * 真实填写账号与密码输入框。
 * @param wrapper 已挂载的登录页包装器。
 * @param values 账号与密码的填写内容。
 */
async function fillCredentials(
  wrapper: VueWrapper,
  values: { password: string; username: string },
) {
  await wrapper.get('input[name="username"]').setValue(values.username);
  await wrapper.get('input[name="password"]').setValue(values.password);
}

/**
 * 真实点击登录按钮并等待异步校验与提交结束。
 * @param wrapper 已挂载的登录页包装器。
 */
async function clickLoginButton(wrapper: VueWrapper) {
  await wrapper.get('button[aria-label="login"]').trigger('click');
  await flushPromises();
}

/**
 * 读取输入框当前值。
 * @param wrapper 已挂载的登录页包装器。
 * @param name 输入框的字段名。
 * @returns 输入框真实显示的文本。
 */
function inputValue(wrapper: VueWrapper, name: string) {
  const element = wrapper.get(`input[name="${name}"]`).element;
  return element instanceof HTMLInputElement ? element.value : '';
}

describe('登录页表单校验', /** 校验是阻止非法凭据进入登录请求的最后一道关口。 */ () => {
  it('必填未填时不提交并展示校验提示', /** 未校验就提交会把空账号发到后端，用户也看不到失败原因。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默表单校验失败日志，用例只断言它真实发生过。 */ () => {},
      );
    const { wrapper } = await mountLogin();

    await clickLoginButton(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    expect(wrapper.text()).toContain('请输入账号');
    expect(wrapper.text()).toContain('请输入密码');
    expect(localStorage.length).toBe(0);
  });

  it('必填通过后提交整表载荷', /** 少传字段或传错结构会让后端拿不到登录凭据。 */ async () => {
    const { wrapper } = await mountLogin();

    await fillCredentials(wrapper, {
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });
    await clickLoginButton(wrapper);

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });
    expect(wrapper.text()).not.toContain('请输入账号');
  });

  it('在表单内按回车等价于点击登录', /** 键盘用户若无法提交，只能被迫切换到鼠标操作。 */ async () => {
    const { wrapper } = await mountLogin();
    await fillCredentials(wrapper, {
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });

    await wrapper.trigger('keydown.enter');
    await flushPromises();

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });
  });
});

describe('登录页记住用户名', /** 记住用户名的读写口径决定账号能否安全回填。 */ () => {
  it('勾选记住我后提交会把账号写入本地存储', /** 不写入会让用户每次打开登录页都要重新输入账号。 */ async () => {
    const { wrapper } = await mountLogin();
    await fillCredentials(wrapper, {
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });

    await wrapper.get('button[role="checkbox"]').trigger('click');
    await clickLoginButton(wrapper);

    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe(rememberMeKey());
    expect(localStorage.getItem(rememberMeKey())).toBe('DUMMY-user');
  });

  it('取消勾选记住我后提交会清空已记住的账号', /** 不清空会让上一位使用者的账号在退出“记住我”后继续回填。 */ async () => {
    localStorage.setItem(rememberMeKey(), 'DUMMY-old-user');
    const { wrapper } = await mountLogin();
    // 本地已有记住的账号时组件必须默认勾选，用户才能看出当前处于记住状态。
    expect(
      wrapper.get('button[role="checkbox"]').attributes('data-state'),
    ).toBe('checked');
    await fillCredentials(wrapper, {
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });

    await wrapper.get('button[role="checkbox"]').trigger('click');
    await clickLoginButton(wrapper);

    expect(localStorage.getItem(rememberMeKey())).toBe('');
  });

  it('本地已记住账号时挂载自动回填', /** 不回填会让“记住我”形同虚设。 */ async () => {
    localStorage.setItem(rememberMeKey(), 'DUMMY-user');

    const { wrapper } = await mountLogin();

    expect(inputValue(wrapper, 'username')).toBe('DUMMY-user');
  });

  it('本地未记住账号时挂载保持空白', /** 误回填会把上一位使用者的账号展示给下一位用户。 */ async () => {
    const { wrapper } = await mountLogin();

    expect(inputValue(wrapper, 'username')).toBe('');
  });
});

describe('登录页导航与展示', /** 导航与展示选项决定用户能否自助恢复与确认当前页面。 */ () => {
  it('点击忘记密码跳转到默认忘记密码路由', /** 点击无响应会让忘记密码的用户无从下手。 */ async () => {
    const { router, wrapper } = await mountLogin();

    await wrapper.get('.vben-link').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/auth/forget-password');
  });

  it('忘记密码跳转使用调用方传入的路径', /** 路径写死会让不同应用跳到本系统不存在的页面。 */ async () => {
    const { router, wrapper } = await mountLogin({
      forgetPasswordPath: '/custom/forget',
    });

    await wrapper.get('.vben-link').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/custom/forget');
  });

  it('关闭记住我与忘记密码后不渲染该选项行', /** 没有选项却渲染分隔行会在表单里留下无意义空白。 */ async () => {
    const { wrapper } = await mountLogin({
      showForgetPassword: false,
      showRememberMe: false,
    });

    expect(wrapper.find('button[role="checkbox"]').exists()).toBe(false);
    expect(wrapper.find('.vben-link').exists()).toBe(false);
  });

  it('加载态在按钮上呈现等待样式并禁止重复点击', /** 未置加载态会让用户重复点击并产生多次登录请求。 */ async () => {
    const { wrapper } = await mountLogin({ loading: true });

    const button = wrapper.get('button[aria-label="login"]');
    expect(button.classes()).toContain('cursor-wait');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.find('.animate-spin').exists()).toBe(true);
  });

  it('标题、说明与提交按钮文案可由属性覆盖', /** 文案写死会让业务无法按自己的登录方式提示用户。 */ async () => {
    const { wrapper } = await mountLogin({
      submitButtonText: 'DUMMY-登录按钮',
      subTitle: 'DUMMY-登录说明',
      title: 'DUMMY-登录标题',
    });

    expect(wrapper.text()).toContain('DUMMY-登录标题');
    expect(wrapper.text()).toContain('DUMMY-登录说明');
    expect(wrapper.get('button[aria-label="login"]').text()).toBe(
      'DUMMY-登录按钮',
    );
  });

  it('向调用方暴露真实表单操作实例', /** 父组件拿不到表单实例就无法在登录成功后重置或回填账号。 */ async () => {
    const { wrapper } = await mountLogin();
    await fillCredentials(wrapper, {
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });

    const exposed = (wrapper.vm as unknown as ExposedFormApi).getFormApi();

    await expect(exposed.getValues()).resolves.toEqual({
      password: 'DUMMY-pass',
      username: 'DUMMY-user',
    });
  });
});
