/**
 * 细粒度权限组件（effects/access 的 access-control.vue）的真实渲染行为回归。
 *
 * `AccessControl` 包住页面里的按钮或区块：默认按角色判定，`type="code"` 时改按权限码判定，
 * 调用方没有声明权限码时必须无条件渲染插槽。判定方式选错或漏掉无条件分支，会把该显示的
 * 内容藏起来，或者把越权入口露给用户。用例真实挂载组件并读取渲染结果，只把权限数据来源
 * （pinia Store）替换为可控对象，角色/权限码交集判定与模板分支全部保持真实实现。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccessControl from '../access-control.vue';

const permissionSource = vi.hoisted(
  /** 建立可被各用例逐例重置的权限码与角色数据容器。 */ () => ({
    accessCodes: [] as string[],
    userRoles: [] as string[],
  }),
);

vi.mock(
  '@vben/stores',
  /** 只替换权限数据来源；权限交集判定与模板分支保持真实实现。 */ () => ({
    /** 返回当前生效的权限码集合。 */
    useAccessStore: () => ({ accessCodes: permissionSource.accessCodes }),
    /** 返回当前生效的用户角色集合。 */
    useUserStore: () => ({ userRoles: permissionSource.userRoles }),
  }),
);

/**
 * 组件渲染出的受保护插槽标记选择器，用于判断插槽是否真正进入 DOM。
 * @returns 受保护插槽节点的选择器。
 */
const guardedMarker = () => '[data-test="guarded"]';

/** 受保护插槽内容：渲染成可断言的标记节点。 */
const guardedSlot = () => h('span', { 'data-test': 'guarded' }, '受保护内容');

/** 组件属性：控制方式与权限码；权限码允许为 null，用于覆盖未声明权限码的调用方。 */
type AccessControlProps = {
  codes?: null | string[];
  type?: 'code' | 'role';
};

/**
 * 挂载权限组件并渲染受保护插槽。
 * @param props 组件属性，`codes` 为 null 表示调用方没有声明权限码。
 * @returns 已挂载的组件包装器。
 */
function mountAccessControl(props: AccessControlProps) {
  return mount(AccessControl, {
    props: props as { codes: string[] },
    slots: { default: guardedSlot },
  });
}

describe('accessControl 权限渲染', /** 该组件决定页面里的受保护入口是否可见，判定错误会直接造成越权或功能缺失。 */ () => {
  beforeEach(
    /** 每例重置身份数据，避免上个用例的权限残留。 */ () => {
      permissionSource.accessCodes = [];
      permissionSource.userRoles = [];
    },
  );

  it('默认按角色判定并渲染命中的插槽', /** 未指定控制方式时必须走角色判定，命中角色才渲染内容。 */ () => {
    permissionSource.userRoles = ['super_admin'];

    const wrapper = mountAccessControl({ codes: ['super_admin'] });

    expect(wrapper.find(guardedMarker()).exists()).toBe(true);
    expect(wrapper.text()).toContain('受保护内容');
  });

  it('角色未命中时不渲染插槽', /** 无角色的用户不能看到受保护内容。 */ () => {
    permissionSource.userRoles = ['normal_user'];

    const wrapper = mountAccessControl({ codes: ['super_admin'] });

    expect(wrapper.find(guardedMarker()).exists()).toBe(false);
  });

  it('type 为 code 时改按权限码判定', /** 后端权限模式下必须读接口下发的权限码，继续读角色会判定失效。 */ () => {
    permissionSource.accessCodes = ['system:user:list'];

    const granted = mountAccessControl({
      codes: ['system:user:list'],
      type: 'code',
    });
    const denied = mountAccessControl({
      codes: ['system:user:delete'],
      type: 'code',
    });

    expect(granted.find(guardedMarker()).exists()).toBe(true);
    expect(denied.find(guardedMarker()).exists()).toBe(false);
  });

  it('未声明权限码时无条件渲染插槽', /** 调用方不声明权限码表示不做限制，此时不能因为空权限判定把内容藏起来。 */ () => {
    permissionSource.accessCodes = [];
    permissionSource.userRoles = [];

    const wrapper = mountAccessControl({ codes: null });

    expect(wrapper.find(guardedMarker()).exists()).toBe(true);
  });
});
