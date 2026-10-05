/**
 * 注册页（effects/common-ui 的 ui/authentication/register）校验与跳转回归。
 *
 * 注册页收集用户名与两次密码：用户名格式校验失效会写入后端无法使用的账号，密码长度校验失效
 * 会让弱密码注册成功，两次密码一致性校验失效会让用户用自己也不知道的密码注册并永久失去入口；
 * “去登录”跳转失效会让已有账号的用户无法回到登录页。用例挂载真实组件与真实表单引擎，
 * 真实填写输入框、真实点击提交，只把路由跳转当作外部输入。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { z } from '@vben-core/form-ui';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Register from './register.vue';

/** 注册页用例属性：只列出用例真正覆盖的字段，其余走组件默认值。 */
interface RegisterCaseProps {
  formSchema?: VbenFormSchema[];
  loading?: boolean;
  loginPath?: string;
  submitButtonText?: string;
  subTitle?: string;
  title?: string;
}

/** 注册页经 defineExpose 暴露的表单操作实例。 */
interface ExposedFormApi {
  /** 取出真实表单操作实例。 */
  getFormApi: () => ExposedFormValues;
}

/** 暴露实例上用例真正调用的取值契约。 */
interface ExposedFormValues {
  /** 读取当前表单值。 */
  getValues: () => Promise<unknown>;
}

/** 占位路由组件：用例只关心跳转结果，目标页面内容不参与断言。 */
const EmptyRoute = {
  /** 占位渲染函数不输出任何内容。 */
  render: () => null,
};

/** 最近一次挂载的注册页，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: undefined | VueWrapper;

afterEach(
  /** 卸载组件并复位替身，避免用例之间互相影响。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
  },
);

/**
 * 构造注册表单约束：用户名 3 到 20 位字母数字下划线，密码至少 8 位且两次输入一致。
 * 确认密码采用生产同一套联动写法：密码变化时重算规则并在提交时比对两次输入。
 * @returns 注册页表单项列表。
 */
function registerSchema(): VbenFormSchema[] {
  return [
    {
      component: 'VbenInput',
      componentProps: { placeholder: '请输入用户名' },
      fieldName: 'username',
      label: '用户名',
      rules: z
        .string()
        .min(1, { message: '请输入用户名' })
        .regex(/^\w{3,20}$/, {
          message: '用户名需为 3 到 20 位字母、数字或下划线',
        }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: { placeholder: '请输入密码' },
      fieldName: 'password',
      label: '密码',
      rules: z.string().min(8, { message: '密码至少 8 位' }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: { placeholder: '请再次输入密码' },
      dependencies: {
        /**
         * 确认密码随密码变化重算，只有与密码完全一致才通过。
         * @param values 当前表单值，其中 password 是注册密码。
         * @returns 比对两次输入是否一致的校验链。
         */
        rules(values) {
          return z
            .string()
            .min(1, { message: '请再次输入密码' })
            .refine(
              /** 两次输入必须完全相同。 */ (value) =>
                value === values.password,
              { message: '两次输入的密码不一致' },
            );
        },
        triggerFields: ['password'],
      },
      fieldName: 'confirmPassword',
      label: '确认密码',
    },
  ];
}

/**
 * 建立真实内存路由并挂载注册页。
 * @param props 页面属性，用来覆盖路径、文案与加载态。
 * @returns 真实路由实例与已挂载的组件包装器。
 */
async function mountRegister(props: RegisterCaseProps = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: EmptyRoute, path: '/auth/login' },
      { component: EmptyRoute, path: '/auth/register' },
      { component: EmptyRoute, path: '/custom/login' },
    ],
  });
  await router.push('/auth/register');
  await router.isReady();
  const wrapper = mount(Register, {
    global: { plugins: [router] },
    props: { formSchema: registerSchema(), ...props },
  });
  mounted = wrapper as VueWrapper;
  await flushPromises();
  return { router, wrapper };
}

/**
 * 真实填写用户名与两次密码，并等待确认密码的联动规则按密码重算。
 * @param wrapper 已挂载的页面包装器。
 * @param values 用户名、密码与确认密码的填写内容。
 */
async function fillRegisterForm(
  wrapper: VueWrapper,
  values: { confirmPassword: string; password: string; username: string },
) {
  await wrapper.get('input[name="username"]').setValue(values.username);
  await wrapper.get('input[name="password"]').setValue(values.password);
  await flushPromises();
  await wrapper
    .get('input[name="confirmPassword"]')
    .setValue(values.confirmPassword);
}

/**
 * 真实点击注册按钮并等待异步校验与提交结束。
 * @param wrapper 已挂载的页面包装器。
 */
async function clickRegister(wrapper: VueWrapper) {
  await wrapper.get('button[aria-label="register"]').trigger('click');
  await flushPromises();
}

describe('注册页表单校验', /** 校验决定非法账号与弱密码能否被创建出来。 */ () => {
  it('必填未填时不提交并展示必填提示', /** 未校验就提交会创建出没有用户名的账号。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默表单校验失败日志，用例只断言它真实发生过。 */ () => {},
      );
    const { wrapper } = await mountRegister();

    await clickRegister(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    expect(wrapper.text()).toContain('请输入用户名');
  });

  it('用户名含非法字符时不提交并展示格式提示', /** 格式校验失效会写入后端无法使用的账号。 */ async () => {
    const { wrapper } = await mountRegister();
    await fillRegisterForm(wrapper, {
      confirmPassword: 'DUMMY-pass1',
      password: 'DUMMY-pass1',
      username: 'DUMMY 用户',
    });

    await clickRegister(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('用户名需为 3 到 20 位字母、数字或下划线');
  });

  it('密码长度不足时不提交并展示长度提示', /** 长度校验失效会让弱密码注册成功。 */ async () => {
    const { wrapper } = await mountRegister();
    await fillRegisterForm(wrapper, {
      confirmPassword: 'DUMMY-p',
      password: 'DUMMY-p',
      username: 'DUMMY_user',
    });

    await clickRegister(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('密码至少 8 位');
  });

  it('两次密码不一致时不提交并展示一致性提示', /** 一致性校验失效会让用户用自己也不知道的密码注册成功。 */ async () => {
    const { wrapper } = await mountRegister();
    await fillRegisterForm(wrapper, {
      confirmPassword: 'DUMMY-pass2',
      password: 'DUMMY-pass1',
      username: 'DUMMY_user',
    });

    await clickRegister(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('两次输入的密码不一致');
  });

  it('全部字段合法时提交整表载荷', /** 少传或错传字段会让后端拿不到注册所需的账号与密码。 */ async () => {
    const { wrapper } = await mountRegister();
    await fillRegisterForm(wrapper, {
      confirmPassword: 'DUMMY-pass1',
      password: 'DUMMY-pass1',
      username: 'DUMMY_user',
    });

    await clickRegister(wrapper);

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      confirmPassword: 'DUMMY-pass1',
      password: 'DUMMY-pass1',
      username: 'DUMMY_user',
    });
  });
});

describe('注册页导航与展示', /** 导航与展示决定已有账号的用户能否回到登录页。 */ () => {
  it('点击去登录跳转到默认登录路由', /** 跳转失效会让已有账号的用户无法登录。 */ async () => {
    const { router, wrapper } = await mountRegister();

    await wrapper.get('.vben-link').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/auth/login');
  });

  it('去登录跳转使用调用方传入的路径', /** 路径写死会让不同应用跳转到本系统不存在的页面。 */ async () => {
    const { router, wrapper } = await mountRegister({
      loginPath: '/custom/login',
    });

    await wrapper.get('.vben-link').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/custom/login');
  });

  it('加载态在按钮上呈现等待样式并禁止重复点击', /** 未置加载态会让用户重复点击并创建重复账号。 */ async () => {
    const { wrapper } = await mountRegister({ loading: true });

    const button = wrapper.get('button[aria-label="register"]');
    expect(button.classes()).toContain('cursor-wait');
    expect(button.attributes('disabled')).toBeDefined();
  });

  it('标题、说明与提交按钮文案可由属性覆盖', /** 文案写死会让业务无法按自己的注册方式提示用户。 */ async () => {
    const { wrapper } = await mountRegister({
      submitButtonText: 'DUMMY-注册按钮',
      subTitle: 'DUMMY-注册说明',
      title: 'DUMMY-注册标题',
    });

    expect(wrapper.text()).toContain('DUMMY-注册标题');
    expect(wrapper.text()).toContain('DUMMY-注册说明');
    expect(wrapper.get('button[aria-label="register"]').text()).toBe(
      'DUMMY-注册按钮',
    );
  });

  it('向调用方暴露真实表单操作实例', /** 父组件拿不到表单实例就无法在注册成功后重置表单。 */ async () => {
    const { wrapper } = await mountRegister();
    await fillRegisterForm(wrapper, {
      confirmPassword: 'DUMMY-pass1',
      password: 'DUMMY-pass1',
      username: 'DUMMY_user',
    });

    const exposed = (wrapper.vm as unknown as ExposedFormApi).getFormApi();

    await expect(exposed.getValues()).resolves.toEqual({
      confirmPassword: 'DUMMY-pass1',
      password: 'DUMMY-pass1',
      username: 'DUMMY_user',
    });
  });
});
