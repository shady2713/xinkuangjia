/**
 * 登录过期弹窗（effects/common-ui 的 ui/authentication/login-expired-modal）开关与层级回归。
 *
 * 登录过期弹窗在会话失效时接管整个界面：开关注失效会让弹窗打不开或关不掉，用户既看不到
 * “登录已过期”的说明也无法重新登录；层级计算失效会让弹窗被全局消息提示或加载遮罩盖住而
 * 点不到；文案与开关透传失效会让内容组件展示出注册、忘记密码等不该出现的入口。用例挂载
 * 真实弹窗组件与真实弹窗内核，用真实属性变化驱动开关，并按弹窗内容引用读取 teleport 之后的
 * 真实元素。
 */
import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { $t } from '@vben/locales';

import { DialogContent } from '@vben-core/shadcn-ui';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import LoginExpiredModal from './login-expired-modal.vue';

/** 登录过期弹窗用例属性：只列出用例真正覆盖的字段。 */
interface LoginExpiredCaseProps {
  avatar?: string;
  open?: boolean;
  zIndex?: number;
}

/** 弹窗内容组件暴露的内容引用读取契约。 */
interface ContentRefApi {
  /** 读取内部真实元素；内容尚未渲染时返回空值。 */
  getContentRef?: () => null | undefined | { $el: HTMLElement };
}

/** 弹窗内容探针：声明与真实登录表单同名的属性，核对弹窗把文案与开关真实透传给内容组件。 */
const SlotProbe = defineComponent({
  name: 'SlotProbe',
  props: {
    /** 是否展示忘记密码入口，弹窗固定关闭。 */
    showForgetPassword: { default: true, type: Boolean },
    /** 是否展示注册入口，弹窗固定关闭。 */
    showRegister: { default: true, type: Boolean },
    /** 是否展示记住我，弹窗固定关闭。 */
    showRememberMe: { default: true, type: Boolean },
    /** 弹窗传入的副标题文案。 */
    subTitle: { default: '', type: String },
    /** 弹窗传入的标题文案。 */
    title: { default: '', type: String },
  },
  /**
   * 把弹窗透传的属性渲染成可断言文本。
   * @param props 弹窗透传的文案与开关属性。
   * @returns 渲染探针节点的渲染函数。
   */
  setup(props) {
    return /** 渲染探针节点，供用例读取透传结果。 */ () =>
      h('div', { 'data-test': 'slot-probe' }, [
        props.title,
        props.subTitle,
        String(props.showForgetPassword),
        String(props.showRegister),
        String(props.showRememberMe),
      ]);
  },
});

/** 最近一次挂载的弹窗，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: undefined | VueWrapper;

beforeEach(
  /** 清空文档，避免上一个用例残留的层级元素影响本次层级计算。 */ () => {
    document.body.innerHTML = '';
  },
);

afterEach(
  /** 卸载组件并清空 teleport 到 body 的弹窗内容。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 读取弹窗内容真实渲染出来的元素。
 * @param wrapper 已挂载的弹窗包装器。
 * @returns 内容元素；弹窗尚未渲染内容时返回 undefined。
 */
function modalElement(wrapper: VueWrapper) {
  const content = wrapper.findComponent(DialogContent);
  if (!content.exists()) {
    return undefined;
  }
  const element = (content.vm as unknown as ContentRefApi).getContentRef?.()
    ?.$el;
  // 未渲染时内容引用拿到的是注释占位节点，只有真实元素才代表内容已进入文档。
  return element instanceof HTMLElement ? element : undefined;
}

/**
 * 挂载登录过期弹窗并真实打开。
 * @param props 弹窗属性，用来覆盖头像、开关初值与层级。
 * @returns 已打开的包装器与内容真实元素。
 * @throws Error 弹窗内容未渲染时抛出，避免用例静默地什么都不验证。
 */
async function mountOpenedModal(props: LoginExpiredCaseProps = {}) {
  const wrapper = mount(LoginExpiredModal, {
    props: { open: false, ...props },
    slots: { default: SlotProbe },
  });
  mounted = wrapper as VueWrapper;
  await wrapper.setProps({ open: true });
  await flushPromises();

  const element = modalElement(wrapper);
  if (!element) throw new Error('登录过期弹窗未渲染内容');
  return { element, wrapper };
}

describe('登录过期弹窗开关', /** 开关决定会话失效时用户能否看到说明并重新登录。 */ () => {
  it('关闭状态下不渲染弹窗内容', /** 未打开就渲染会遮挡当前页面并阻止用户继续操作。 */ async () => {
    const wrapper = mount(LoginExpiredModal, {
      props: { open: false },
      slots: { default: SlotProbe },
    });
    mounted = wrapper as VueWrapper;
    await flushPromises();

    expect(modalElement(wrapper)).toBeUndefined();
    expect(wrapper.findComponent(SlotProbe).exists()).toBe(false);
  });

  it('打开时渲染登录过期文案与受限选项', /** 文案或开关取值错误会让用户不知道为何被登出，也无法关闭弹窗。 */ async () => {
    const { element, wrapper } = await mountOpenedModal({
      avatar: 'DUMMY-avatar.png',
    });

    const probe = wrapper.getComponent(SlotProbe);
    expect(probe.props('title')).toBe($t('authentication.loginAgainTitle'));
    expect(probe.props('subTitle')).toBe(
      $t('authentication.loginAgainSubTitle'),
    );
    // 会话已失效，注册、忘记密码与记住我入口必须全部关闭，避免用户在过期会话上继续操作。
    expect(probe.props('showForgetPassword')).toBe(false);
    expect(probe.props('showRegister')).toBe(false);
    expect(probe.props('showRememberMe')).toBe(false);
    // 头像地址必须落到真实图片元素上，用户才能确认当前登录的账号。
    expect(element.querySelector('img')?.getAttribute('src')).toBe(
      'DUMMY-avatar.png',
    );
    expect(element.className).toContain('border-none');
  });

  it('打开后再关闭会让弹窗内容退回关闭状态', /** 关不掉会让用户被弹窗永久挡住，无法回到登录页。 */ async () => {
    const { element, wrapper } = await mountOpenedModal();
    expect(element.dataset.state).toBe('open');

    await wrapper.setProps({ open: false });
    await flushPromises();

    expect(modalElement(wrapper)?.dataset.state).toBe('closed');
  });

  it('弹窗不可关闭且不渲染页脚按钮', /** 允许随手关掉会让用户以为已经登录成功而继续操作。 */ async () => {
    const { element } = await mountOpenedModal();

    // 关闭按钮与页脚确认按钮都渲染成内容区内的按钮，一处都不应出现。
    expect(element.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('登录过期弹窗层级', /** 层级决定弹窗能否盖住全局消息提示与加载遮罩。 */ () => {
  it('按页面最大层级加一计算并排除消息与加载层', /** 不排除消息层会让弹窗被 9999 的消息盖住而无法点击。 */ async () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = [
      '<div style="z-index: 40"></div>',
      '<div class="ant-message" style="z-index: 9999"></div>',
      '<div class="loading" style="z-index: 8888"></div>',
      '<div style="z-index: auto"></div>',
    ].join('');
    document.body.append(fixture);

    const { element } = await mountOpenedModal();

    expect(element.getAttribute('style')).toContain('z-index: 41');
  });

  it('传入层级时按传入值渲染而不重新计算', /** 调用方指定的层级被覆盖会让弹窗落到业务自定义遮罩之下。 */ async () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = '<div style="z-index: 40"></div>';
    document.body.append(fixture);

    const { element } = await mountOpenedModal({ zIndex: 3000 });

    expect(element.getAttribute('style')).toContain('z-index: 3000');
  });
});
