/**
 * 表单标签帮助说明（form-render/form-label.vue）的真实渲染行为回归。
 *
 * 字段的 `help` 说明由 FormLabel 渲染成标签旁的问号入口：声明了说明的字段必须出现帮助入口，
 * 用户聚焦入口后要把说明内容真实渲染到页面上；没有声明说明的字段不能凭空多出入口。
 * 帮助入口缺失或内容不渲染，用户就看不到字段的填写口径。用例通过真实 `useVbenForm` 挂载
 * 真实表单，用真实焦点事件打开 reka-ui 提示，读取传送后的真实 DOM 节点。
 */
import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, describe, expect, it } from 'vitest';

import { useVbenForm } from '../src/use-form';

/** 帮助说明文本：用 DUMMY- 前缀避免与真实业务文案混淆。 */
const HELP_TEXT = 'DUMMY-账号填写说明';

/** 字段声明：一个带帮助说明与冒号的账号字段，一个不带帮助说明的昵称字段。 */
const schema = [
  {
    colon: true,
    component: 'VbenInput',
    fieldName: 'account',
    help: HELP_TEXT,
    label: '账号',
  },
  { component: 'VbenInput', fieldName: 'nickname', label: '昵称' },
];

/**
 * 挂载真实表单并等待首帧渲染完成。
 * @returns 已挂载的表单组件包装器。
 */
async function mountForm() {
  const [Form] = useVbenForm({ layout: 'vertical', schema });
  const wrapper = mount(Form as Component);
  await flushPromises();
  return wrapper;
}

afterEach(
  /** 清理提示传送产生的 DOM 节点，避免残留影响后续用例。 */ () => {
    document.body.innerHTML = '';
  },
);

describe('表单标签渲染', /** 标签承载字段名、冒号与帮助入口，缺失会让用户不知道字段该填什么。 */ () => {
  it('渲染字段名与冒号且只在声明说明的字段上出现帮助入口', /** 帮助入口必须跟随 help 声明出现，凭空出现或多出会误导用户。 */ async () => {
    const wrapper = await mountForm();

    const labels = wrapper.findAll('label');
    expect(labels).toHaveLength(2);
    expect(labels[0]?.text()).toContain('账号');
    expect(labels[0]?.text()).toContain(':');
    expect(labels[1]?.text()).toContain('昵称');
    expect(labels[0]?.find('svg').exists()).toBe(true);
    expect(labels[1]?.find('svg').exists()).toBe(false);

    wrapper.unmount();
  });

  it('聚焦帮助入口后把说明内容渲染出来', /** 说明内容不渲染会让问号入口形同虚设，用户看不到填写口径。 */ async () => {
    const wrapper = await mountForm();
    const helpTrigger = wrapper.get('label svg');

    // 帮助内容只在提示打开后进入传送节点，关闭状态不应出现在页面上。
    expect(document.body.textContent).not.toContain(HELP_TEXT);

    await helpTrigger.trigger('focus');

    expect(document.body.textContent).toContain(HELP_TEXT);

    wrapper.unmount();
  });
});
