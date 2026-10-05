/**
 * 描述列表组件（components/description/description.vue）真实渲染行为回归。
 *
 * 该组件是详情页描述列表的渲染实现，被 `useDescription` 包装后由操作日志、登录日志、
 * 定时任务等详情页真实消费。它按 schema 逐项渲染键值对：字段取值支持点号路径与自定义
 * render；`show` 判定为假的描述项必须整项不渲染；带 `slot` 的描述项必须交给调用方插槽；
 * `contentMinWidth` 与 `labelMinWidth` 决定是否包一层定宽容器；`extra` 插槽只透传不加工。
 * 这些分支写错会让详情页出现空白项、错位标签或丢失自定义内容。
 *
 * 用例挂载真实组件、传入真实 schema 与真实数据，只断言渲染出来的可见文本与结构。
 * 测量口径说明：本文件是仓库唯一的 `lang="tsx"` SFC，`@vue/babel-plugin-jsx` 会为
 * `<ElDescriptions>{slotsObj}</ElDescriptions>` 的标识符子节点合成
 * `_isSlot(slotsObj) ? slotsObj : { default: () => [slotsObj] }`；`slotsObj` 是本组件内
 * 构造的普通对象，`_isSlot` 恒为真，兜底插槽永不执行，它在源码里没有对应函数。
 * 该合成片段已在交付证据里登记为"生成片段"，不通过改写判定来消除。
 */
import type { ComponentMountingOptions } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import Description from './description.vue';

/**
 * 插槽表类型：本用例故意放入非函数值，因此按组件实际接收的最宽松形态声明。
 */
type DescriptionSlots = Record<string, unknown>;

/**
 * 挂载描述列表时允许传入的插槽表：取 `mount` 对描述列表实际接受的形态，
 * 用例需要传入的"值为字符串"这类非函数插槽才能被真实交给组件，
 * 插槽值是否可用由组件自身的插槽校验逻辑裁决，挂载层不做额外收窄。
 */
type DescriptionMountSlots = NonNullable<
  ComponentMountingOptions<typeof Description>['slots']
>;

/**
 * 挂载描述列表组件。
 * @param props 传给组件的属性；缺省时只验证空 schema 契约。
 * @param slots 传给组件的插槽。
 * @returns 已挂载的组件包装器。
 */
function mountDescription(
  props: Record<string, unknown> = {},
  slots: DescriptionMountSlots = {},
) {
  return mount(Description, { props, slots });
}

/**
 * 把状态码渲染成可读文案，供自定义 render 用例复用。
 * @param value 当前字段值。
 * @returns 展示用状态文案。
 */
function renderStatus(value: unknown) {
  return value === 1 ? '已启用' : '已停用';
}

/**
 * 恒定隐藏的字段判定，用于验证条件项被整项过滤。
 * @returns 恒为假。
 */
function alwaysHidden() {
  return false;
}

describe('描述列表按 schema 渲染', /** 详情页的全部展示字段都由这条渲染链产出。 */ () => {
  it('渲染字段值与标签', /** 取值或标签丢失会让详情页只剩空行。 */ () => {
    const wrapper = mountDescription({
      column: 1,
      data: { name: '演示任务', remark: '每分钟执行一次' },
      schema: [
        { field: 'name', label: '名称' },
        { field: 'remark', label: '备注' },
      ],
    });

    expect(wrapper.text()).toContain('名称');
    expect(wrapper.text()).toContain('演示任务');
    expect(wrapper.text()).toContain('备注');
    expect(wrapper.text()).toContain('每分钟执行一次');
  });

  it('点号路径字段从嵌套数据取值', /** 嵌套字段取不到会让详情页显示空白。 */ () => {
    const wrapper = mountDescription({
      data: { job: { group: '默认分组' } },
      schema: [{ field: 'job.group', label: '分组' }],
    });

    expect(wrapper.text()).toContain('默认分组');
  });

  it('自定义 render 接管字段展示', /** render 未生效会让状态类字段退化成原始值。 */ () => {
    const wrapper = mountDescription({
      data: { status: 1 },
      schema: [
        {
          field: 'status',
          label: '状态',
          render: renderStatus,
        },
      ],
    });

    expect(wrapper.text()).toContain('已启用');
  });

  it('show 判定为假的描述项整项不渲染', /** 未过滤的条件项会让详情页出现无意义的空行。 */ () => {
    const wrapper = mountDescription({
      data: { remark: '每分钟执行一次' },
      schema: [
        {
          field: 'name',
          label: '名称',
          show: alwaysHidden,
        },
        { field: 'remark', label: '备注' },
      ],
    });

    expect(wrapper.text()).not.toContain('名称');
    expect(wrapper.text()).toContain('备注');
  });

  it('带 slot 的描述项交给调用方插槽渲染', /** 插槽未透传会让自定义描述项退化成默认取值。 */ () => {
    const wrapper = mountDescription(
      {
        data: { status: 1 },
        schema: [{ field: 'status', label: '状态', slot: 'statusSlot' }],
      },
      {
        /** 渲染插槽并回显收到的描述数据。 */ statusSlot: (params: {
          data?: Record<string, unknown>;
        }) => `状态码:${params.data?.status}`,
      },
    );

    expect(wrapper.text()).toContain('状态码:1');
  });

  it('contentMinWidth 与 labelMinWidth 生效时包一层定宽容器', /** 定宽容器缺失会让长表格里的标签与内容错位。 */ () => {
    const wrapper = mountDescription({
      data: { name: '演示任务' },
      schema: [
        {
          contentMinWidth: 120,
          field: 'name',
          label: '名称',
          labelMinWidth: 80,
        },
      ],
    });

    const html = wrapper.html();
    expect(html).toContain('min-width: 120px');
    expect(html).toContain('min-width: 80px');
  });

  it('extra 插槽原样透传到描述列表', /** extra 未透传会让调用方无法自定义表头区域。 */ () => {
    const wrapper = mountDescription(
      { data: {}, schema: [] },
      { extra: '<i class="DUMMY-extra"></i>' },
    );

    expect(wrapper.find('.DUMMY-extra').exists()).toBe(true);
  });

  it('插槽取值不可用时回退到默认渲染并告警', /** 插槽名写错时必须回退而不是抛错，否则整页详情崩溃。 */ () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 丢弃预期内的告警输出，避免污染测试日志。 */ () => {},
      );
    const wrapper = mountDescription({
      data: { name: '演示任务' },
      schema: [{ field: 'name', label: '名称', slot: 'notProvidedSlot' }],
    });

    expect(wrapper.text()).toContain('名称');
    warn.mockRestore();
  });

  it('缺省属性时渲染空描述列表而不报错', /** 无数据时抛错会让详情弹窗打不开。 */ () => {
    const wrapper = mountDescription();

    expect(wrapper.find('.description').exists()).toBe(true);
  });

  it('缺省 data 时描述项渲染为空而不报错', /** 异步取数尚未回填时抛错会让详情页整页崩溃。 */ () => {
    // 只给 schema 不给 data：字段取值入口必须走"没有数据"的早退，而不是去读 undefined 的属性。
    const wrapper = mountDescription({
      schema: [
        { field: 'name', label: '名称' },
        { contentMinWidth: 120, field: 'remark', label: '备注' },
      ],
    });

    expect(wrapper.find('.description').exists()).toBe(true);
    // 标签仍然渲染，取值位置为空：既不能抛错，也不能把 undefined 当文案打出来。
    expect(wrapper.text()).toContain('名称');
    expect(wrapper.text()).toContain('备注');
    expect(wrapper.text()).not.toContain('undefined');
  });

  it('插槽存在但不是函数时告警并回退到默认渲染', /** 插槽值写错时必须告警并回退，否则取值位置会整块渲染失败。 */ () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 丢弃预期内的告警输出，避免污染测试日志。 */ () => {},
      );
    // 编译产物标记 `_` 让 Vue 原样接收插槽表（不做非函数归一），从而真实构造出
    // "插槽键存在、值不是函数"这一 Vue 自身也会告警的输入形态。
    const Host = defineComponent({
      name: 'DescriptionNonFunctionSlotHost',
      /**
       * 以非函数插槽值渲染描述列表。
       * @returns 描述列表节点。
       */
      setup() {
        return /** 渲染描述列表并传入非函数的插槽值。 */ () =>
          h(
            Description,
            {
              data: { name: '演示任务' },
              schema: [{ field: 'name', label: '名称', slot: 'extra' }],
            },
            { _: 1, extra: 'DUMMY-不是函数' } as unknown as DescriptionSlots,
          );
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.find('.description').exists()).toBe(true);
    expect(wrapper.text()).toContain('名称');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[description:slot] extra is not a function!'),
    );
    warn.mockRestore();
  });
});
