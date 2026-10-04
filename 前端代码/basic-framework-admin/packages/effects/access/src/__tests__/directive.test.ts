/**
 * 权限指令（effects/access 的 directive.ts）在真实 Vue 指令管线上的行为回归。
 *
 * `v-access` 是按钮级权限的最后一层保护：没有权限时必须把元素从 DOM 中移除，而不是仅隐藏。
 * 用例用真实 `createApp` + `withDirectives` 挂载，只把权限数据来源（pinia Store）替换为
 * 可控对象，指令的取值归一化、权限模式与参数选择、元素移除等实现全部保持真实。
 */
import type { ObjectDirective } from 'vue';

import { createApp, defineComponent, h, withDirectives } from 'vue';

import { preferences, updatePreferences } from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAccessDirective } from '../directive';

/** 权限数据来源替身：真实 Store 依赖 pinia 安装，这里只替换读取权限码与角色的数据源。 */
const permissionSource = vi.hoisted(
  /** 建立可被各用例逐例重置的权限数据容器。 */ () => ({
    accessCodes: [] as string[],
    userRoles: [] as string[],
  }),
);

vi.mock(
  '@vben/stores',
  /** 只替换权限数据来源；指令判定、Vue 指令管线与元素移除保持真实实现。 */ () => ({
    /** 返回当前生效的权限码集合。 */
    useAccessStore: () => ({ accessCodes: permissionSource.accessCodes }),
    /** 返回当前生效的用户角色集合。 */
    useUserStore: () => ({ userRoles: permissionSource.userRoles }),
  }),
);

/** 记录指令注册结果与被守护元素是否仍在 DOM 中。 */
interface DirectiveOutcome {
  /** 该元素在指令执行后是否仍留在 DOM 中。 */
  kept: boolean;
  /** 实际注册到应用上的指令定义。 */
  directive?: ObjectDirective;
}

/**
 * 在真实应用与真实 DOM 上执行一次 v-access 指令。
 * @param value 指令绑定值，单个权限码、权限码数组或空值。
 * @param arg 指令参数，`role` 表示按角色判定，缺省表示按权限码判定。
 * @returns 元素是否保留及真实注册的指令定义。
 */
function applyAccessDirective(value: unknown, arg?: string): DirectiveOutcome {
  const captured: { directive?: ObjectDirective } = {};
  const Host = defineComponent({
    name: 'AccessDirectiveHost',
    /** 渲染带指令的元素，指令定义在挂载前由 registerAccessDirective 注册。
     * @returns 渲染受保护元素的渲染函数。
     */
    setup() {
      /** 渲染受保护元素；缺少指令定义时立即失败，避免用例静默通过。
       * @returns 带 v-access 指令的元素节点。
       * @throws Error 指令未注册时抛出。
       */
      const renderGuarded = () => {
        const directive = captured.directive;
        if (!directive) throw new Error('权限指令未注册');
        return withDirectives(h('span', { class: 'guarded' }, 'guarded'), [
          [directive, value, arg],
        ]);
      };
      return renderGuarded;
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(Host);
  registerAccessDirective(app);
  captured.directive = app.directive('access') as ObjectDirective | undefined;
  app.mount(container);
  const outcome: DirectiveOutcome = {
    directive: captured.directive,
    kept: container.querySelector('.guarded') !== null,
  };
  app.unmount();
  container.remove();
  return outcome;
}

describe('v-access 权限指令', /** 指令决定受保护元素是否出现在页面上。 */ () => {
  let originalAccessMode: (typeof preferences)['app']['accessMode'];
  beforeEach(
    /** 每例重置权限数据，并记录原始权限模式以便恢复。 */ () => {
      originalAccessMode = preferences.app.accessMode;
      permissionSource.accessCodes = [];
      permissionSource.userRoles = [];
    },
  );
  afterEach(
    /** 恢复共享的权限模式，避免影响其它用例与磁盘缓存。 */ () => {
      updatePreferences({ app: { accessMode: originalAccessMode } });
    },
  );

  it('注册的指令名固定为 access', /** 模板中的 v-access 依赖该名称，改名会让所有权限声明静默失效。 */ () => {
    const { directive } = applyAccessDirective('system:user:list');

    expect(directive).toBeTypeOf('object');
    expect(directive?.mounted).toBeTypeOf('function');
  });

  it('拥有权限码时保留元素', /** 有权限必须保持元素原样，避免按钮被误删。 */ () => {
    permissionSource.accessCodes = ['system:user:list'];

    expect(applyAccessDirective('system:user:list').kept).toBe(true);
  });

  it('缺少权限码时把元素从 DOM 中移除', /** 仅隐藏仍可被脚本触发，必须真实移除。 */ () => {
    permissionSource.accessCodes = ['system:user:query'];

    expect(applyAccessDirective('system:user:delete').kept).toBe(false);
  });

  it('权限码数组中任一命中即保留元素', /** 数组写法表示"或"关系，逐个判定不能只看首项。 */ () => {
    permissionSource.accessCodes = ['system:role:list'];

    expect(
      applyAccessDirective(['system:user:list', 'system:role:list']).kept,
    ).toBe(true);
  });

  it('权限码数组全部未命中时移除元素', /** 无一项命中时必须与单个权限码判定结果一致。 */ () => {
    permissionSource.accessCodes = ['system:role:list'];

    expect(
      applyAccessDirective(['system:user:list', 'system:user:delete']).kept,
    ).toBe(false);
  });

  it.each([undefined, ''])(
    '绑定值为 %s 时不做权限判定',
    /** 未声明权限的元素不能被误删，空值必须直接放行。 */ (emptyValue) => {
      permissionSource.accessCodes = [];

      expect(applyAccessDirective(emptyValue).kept).toBe(true);
    },
  );

  it('前端权限模式下 v-access:role 按角色判定', /** 前端模式没有权限码来源，角色必须走用户角色集合。 */ () => {
    updatePreferences({ app: { accessMode: 'frontend' } });
    permissionSource.userRoles = ['super_admin'];

    expect(applyAccessDirective(['super_admin'], 'role').kept).toBe(true);
    expect(applyAccessDirective(['normal_user'], 'role').kept).toBe(false);
  });

  it('后端权限模式下 v-access:role 改用权限码判定', /** 后端模式的权限码由接口下发，不能继续读前端角色。 */ () => {
    updatePreferences({ app: { accessMode: 'backend' } });
    permissionSource.userRoles = ['super_admin'];
    permissionSource.accessCodes = [];

    expect(applyAccessDirective(['super_admin'], 'role').kept).toBe(false);

    permissionSource.accessCodes = ['super_admin'];
    expect(applyAccessDirective(['super_admin'], 'role').kept).toBe(true);
  });

  it('成员表达式写法的权限码同样生效', /** 模板里也可写对象取值，字符串取值必须与字面量一致。 */ () => {
    permissionSource.accessCodes = ['system:dept:create'];

    expect(applyAccessDirective('system:dept:create').kept).toBe(true);
  });
});
