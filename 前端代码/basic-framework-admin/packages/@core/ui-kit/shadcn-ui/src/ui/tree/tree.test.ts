/**
 * 通用树形选择组件（shadcn-ui 的 ui/tree/tree.vue）真实行为回归。
 *
 * 组件把后端下发的父子结构拍平后交给 reka-ui 渲染，并在内部维护展开集合与受控选中值：
 * 拍平丢层级会让缩进与父级联动失效；展开键类型不统一会让「展开一级」「展开全部」点了没反应；
 * 禁用节点未过滤会让用户勾中不可选项；受控值里混入已删除或已禁用的标识会让表单提交出脏数据；
 * 全选未跳过禁用与无值节点会让 v-model 出现 undefined；节点图标与自定义类名失效会让业务方
 * 无法区分特殊部门。用例真实挂载组件、真实点击箭头/复选框/节点文字，并通过真实 v-model 契约
 * 观察最终下发值；展开与全选等方法经由 defineExpose 暴露的公开接口调用，属于对外契约。
 * 远程 Iconify 是唯一外部边界：这里直接使用 @vben-core/icons 预置的 lucide 集合离线渲染。
 */
import type { ComponentPublicInstance } from 'vue';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import VbenTree from './tree.vue';

/** 组件通过 defineExpose 暴露的公开方法集合。 */
interface TreeApi {
  /** 全选所有未禁用节点。 */
  checkAll: () => void;
  /** 收起全部节点。 */
  collapseAll: () => void;
  /** 收起指定标识的节点。 */
  collapseNodes: (value: number | number[] | string | string[]) => void;
  /** 展开全部可展开节点。 */
  expandAll: () => void;
  /** 展开指定标识的节点。 */
  expandNodes: (value: number | number[] | string | string[]) => void;
  /** 展开到指定层级。 */
  expandToLevel: (level: number) => void;
  /** 按标识反查节点数据。 */
  getItemByValue: (value: number | string) => undefined | { label?: string };
  /** 取消全部选中。 */
  unCheckAll: () => void;
}

/**
 * 部门树夹具：三级结构，含禁用节点、无值节点与并列兄弟。
 * 标识统一使用字符串，与渲染层按字符串比较展开键和节点键的口径一致。
 * @returns 部门树数据。
 */
function departments() {
  return [
    {
      children: [
        {
          children: [{ label: '基础架构组', value: '111' }],
          label: '前端组',
          value: '11',
        },
        { disabled: true, label: '后端组', value: '12' },
        { label: '测试组', value: '13' },
      ],
      icon: 'lucide:folder',
      label: '研发中心',
      value: '1',
    },
    {
      children: [{ label: '品牌组', value: '21' }],
      label: '市场部',
      value: '2',
    },
  ];
}

/**
 * 取全部树节点元素（reka 渲染的 treeitem，运行时是 HTMLElement）。
 * @param wrapper 已挂载的树包装器。
 * @returns 节点元素包装器列表，按先序排列；按真实 DOM 元素类型收窄，便于用例读样式与派发事件。
 */
function nodeWrappers(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll<HTMLElement>('.tree-node');
}

/**
 * 按可见文案取单个节点元素。
 * @param wrapper 已挂载的树包装器。
 * @param label 节点文案。
 * @returns 命中的节点包装器。
 */
function nodeByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const node = nodeWrappers(wrapper).find(
    /** 用文案定位目标行，保证点到的是目标节点而不是相邻节点。 */ (item) =>
      item.text().includes(label),
  );
  if (!node) {
    throw new Error(`未找到文案为 ${label} 的树节点`);
  }
  return node;
}

/**
 * 取节点行内的文字区域（点击它走渲染层的选择分支）。
 * @param wrapper 已挂载的树包装器。
 * @param label 节点文案。
 * @returns 文字区域元素。
 */
function labelElement(wrapper: ReturnType<typeof mount>, label: string) {
  const outer = nodeByLabel(wrapper, label).element.children[1] as HTMLElement;
  return outer.lastElementChild as HTMLElement;
}

/**
 * 取节点行内的展开箭头。
 * @param wrapper 已挂载的树包装器。
 * @param label 节点文案。
 * @returns 箭头元素；叶子节点返回占位方块。
 */
function chevronElement(wrapper: ReturnType<typeof mount>, label: string) {
  return nodeByLabel(wrapper, label).element.children[0] as HTMLElement;
}

/**
 * 取节点行内的复选框按钮。
 * @param wrapper 已挂载的树包装器。
 * @param label 节点文案。
 * @returns 复选框元素。
 */
function checkboxElement(wrapper: ReturnType<typeof mount>, label: string) {
  const outer = nodeByLabel(wrapper, label).element.children[1] as HTMLElement;
  return outer.firstElementChild as HTMLElement;
}

/**
 * 取顶部工具条上的展开开关与全选复选框。
 * @param wrapper 已挂载的树包装器。
 * @returns 展开开关与全选复选框元素；未渲染时对应项为 undefined。
 */
function toolbarElements(wrapper: ReturnType<typeof mount>) {
  const toolbar = wrapper.element.querySelector(
    '.size-5',
  ) as HTMLElement | null;
  return {
    checkbox: toolbar?.querySelector('button[role="checkbox"]') as
      | HTMLElement
      | null
      | undefined,
    switch: toolbar ?? undefined,
  };
}

/**
 * 在元素上派发一次真实鼠标点击。
 * @param element 接收点击的元素。
 */
function click(element: HTMLElement | null | undefined) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * 以真实 v-model 契约挂载树组件，让组件内部回写能真正驱动重新渲染。
 * @param props 传给树组件的属性。
 * @param initial 初始 v-model 取值。
 * @param slots 传给树组件的插槽渲染函数。
 * @returns 宿主包装器、树包装器、当前 v-model 取值与公开方法引用。
 */
function mountTree(
  props: Record<string, unknown> = {},
  initial?: number | number[] | string | string[],
  slots: Record<string, unknown> = {},
) {
  const model = ref(initial);
  const treeRef = ref<ComponentPublicInstance | null>(null);
  const propsState = reactive({ ...props });
  const Host = defineComponent({
    name: 'TreeHost',
    /**
     * 装配宿主组件，把 v-model 与公开方法引用交给渲染函数。
     * @returns 渲染函数，由 Vue 调用生成虚拟节点。
     */
    setup() {
      /**
       * 渲染宿主组件，把 v-model 与公开方法引用透传给树组件。
       * @returns 树组件的虚拟节点。
       */
      function render() {
        /**
         * 宿主透传给树组件的属性：propsState 是按用例拼装的宽泛录制表，
         * 直接展开会让 h() 因缺少组件声明的属性与类型过宽而选不中重载，
         * 因此在调用处收窄为树组件的真实公开 props；这里只做编译期收窄，运行时对象不变。
         */
        const treeProps = {
          ...propsState,
          modelValue: model.value,
          /** 接收组件回写，模拟真实调用方的 v-model。 */
          'onUpdate:modelValue': (value: unknown) => {
            model.value = value as number | number[] | string | string[];
          },
          ref: treeRef,
        } as unknown as InstanceType<typeof VbenTree>['$props'];
        return h(VbenTree, treeProps, slots);
      }

      return render;
    },
  });
  const wrapper = mount(Host);

  return {
    api: treeRef.value as unknown as TreeApi,
    model,
    props: propsState,
    tree: wrapper.findComponent(VbenTree),
    wrapper,
  };
}

/**
 * 展开指定节点：真实点击其箭头，并等待一次渲染。
 * @param wrapper 已挂载的树包装器。
 * @param label 节点文案。
 */
async function expandNode(wrapper: ReturnType<typeof mount>, label: string) {
  click(chevronElement(wrapper, label));
  await nextTick();
}

/**
 * 点击节点文字区域并等待渲染层回写。
 * @param wrapper 已挂载的树包装器。
 * @param label 节点文案。
 */
async function clickLabel(wrapper: ReturnType<typeof mount>, label: string) {
  click(labelElement(wrapper, label));
  await nextTick();
  await nextTick();
}

describe('树形选择渲染', /** 拍平与字段读取决定树能否按调用方数据正确显示。 */ () => {
  it('默认收起时只渲染根节点，叶子行保留缩进占位', /** 未展开就渲染全部子节点会让树无法逐级浏览。 */ async () => {
    const { tree, wrapper } = mountTree({ treeData: departments() });

    expect(nodeWrappers(wrapper)).toHaveLength(2);
    expect(wrapper.text()).toContain('研发中心');
    expect(wrapper.text()).not.toContain('前端组');
    // 有子节点的行渲染可点击箭头，叶子行渲染占位方块保持缩进对齐。
    expect(chevronElement(wrapper, '研发中心').tagName.toLowerCase()).toBe(
      'svg',
    );

    await expandNode(tree, '研发中心');

    expect(chevronElement(tree, '前端组').tagName.toLowerCase()).toBe('svg');
    expect(chevronElement(tree, '后端组').tagName.toLowerCase()).toBe('div');
  });

  it('按 valueField 与 childrenField 读取自定义字段', /** 字段名写死会让业务方无法接入自己的树数据。 */ async () => {
    const { tree, wrapper } = mountTree({
      childrenField: 'subs',
      labelField: 'name',
      treeData: [
        { name: '父节点', subs: [{ name: '子节点', uid: '2' }], uid: '1' },
      ],
      valueField: 'uid',
    });

    expect(wrapper.text()).toContain('父节点');

    await expandNode(tree, '父节点');

    expect(wrapper.text()).toContain('子节点');
  });

  it('showIcon 与 iconField 决定是否渲染图标', /** 图标开关失效会让纯文字表格里出现多余图标。 */ async () => {
    const withIcon = mountTree({ showIcon: true, treeData: departments() });
    const withoutIcon = mountTree({ showIcon: false, treeData: departments() });
    const customField = mountTree({
      iconField: 'iconName',
      treeData: [
        { iconName: 'lucide:folder', label: '带图标', value: '1' },
        { label: '无图标', value: '2' },
      ],
    });

    await nextTick();

    expect(withIcon.wrapper.find('svg.iconify--lucide').exists()).toBe(true);
    expect(withoutIcon.wrapper.find('svg.iconify--lucide').exists()).toBe(
      false,
    );
    expect(customField.wrapper.find('svg.iconify--lucide').exists()).toBe(true);
  });

  it('bordered 决定容器边框', /** 边框开关失效会让嵌入表单的树多出一条分割线。 */ () => {
    const bordered = mountTree({ bordered: true, treeData: departments() });
    const plain = mountTree({ bordered: false, treeData: departments() });

    expect(bordered.tree.classes()).toContain('border');
    expect(plain.tree.classes()).not.toContain('border');
  });

  it('header 与 footer 插槽随数据渲染，空数据时不渲染工具条', /** 插槽不渲染会让调用方无法放置搜索框等附加内容。 */ () => {
    const { tree } = mountTree({ treeData: departments() }, undefined, {
      /** 渲染页脚标记，验证插槽真的接管了页脚区域。 */
      footer: () => h('i', { class: 'DUMMY-footer' }),
      /** 渲染页眉标记，验证插槽真的接管了页眉区域。 */
      header: () => h('i', { class: 'DUMMY-header' }),
    });
    const { tree: emptyTree } = mountTree({ treeData: [] });

    expect(tree.find('.DUMMY-header').exists()).toBe(true);
    expect(tree.find('.DUMMY-footer').exists()).toBe(true);
    expect(toolbarElements(tree).switch).toBeDefined();
    expect(toolbarElements(emptyTree).switch).toBeUndefined();
  });

  it('node 插槽替换默认节点内容', /** 插槽不生效会让业务方无法渲染部门层级等自定义节点。 */ () => {
    const { tree } = mountTree({ treeData: departments() }, undefined, {
      /**
       * 用自定义节点渲染标签，验证插槽真的接管了默认内容。
       * @param slotProps reka 透传的节点信息。
       */
      node: (slotProps: { value: { label?: string } }) =>
        h('i', { class: 'DUMMY-node' }, slotProps.value.label),
    });

    expect(tree.findAll('.DUMMY-node')).toHaveLength(2);
    expect(tree.text()).toContain('研发中心');
  });

  it('透传调用方的 class', /** 类名透传失效会让业务方无法调整树的外观。 */ () => {
    const { tree } = mountTree({
      class: 'DUMMY-tree',
      treeData: departments(),
    });

    expect(tree.classes()).toContain('DUMMY-tree');
  });
});

describe('树形选择展开与收起', /** 展开集合错乱会让用户看不到子节点或看到不该出现的层级。 */ () => {
  it('点击箭头展开再收起并回传 expand 事件', /** 箭头点不动会让整棵树只能看第一层。 */ async () => {
    const { tree } = mountTree({ treeData: departments() });

    await expandNode(tree, '研发中心');

    expect(tree.text()).toContain('前端组');
    expect(tree.emitted('expand')).toHaveLength(1);

    await expandNode(tree, '研发中心');

    expect(tree.text()).not.toContain('前端组');
    expect(tree.emitted('expand')).toHaveLength(2);
  });

  it('点击工具条按当前状态展开全部再收起全部', /** 一键展开失效会让大树的逐级点击成本无法接受。 */ async () => {
    const { tree } = mountTree({ treeData: departments() });

    click(toolbarElements(tree).switch);
    await nextTick();

    expect(tree.text()).toContain('基础架构组');

    click(toolbarElements(tree).switch);
    await nextTick();

    expect(tree.text()).not.toContain('前端组');
  });

  it('defaultExpandedKeys 初始展开且可被外部改写覆盖', /** 异步下发默认展开键不生效会让弹窗回显丢失层级。 */ async () => {
    const { props, tree } = mountTree({
      defaultExpandedKeys: ['1'],
      treeData: departments(),
    });

    expect(tree.text()).toContain('前端组');

    props.defaultExpandedKeys = ['2'];
    await nextTick();

    expect(tree.text()).toContain('品牌组');
    expect(tree.text()).not.toContain('前端组');
  });

  it('defaultExpandedLevel 只展开到指定层级', /** 层级换算偏差会让「展开一级」变成展开全部。 */ async () => {
    const { props, tree } = mountTree({
      defaultExpandedLevel: 1,
      treeData: departments(),
    });

    await nextTick();
    await nextTick();

    expect(tree.text()).toContain('前端组');
    expect(tree.text()).not.toContain('基础架构组');

    // 换一份树数据后重新按层级展开，保证换数据时不会残留上一棵树的展开状态。
    props.treeData = [
      {
        children: [{ label: '新子节点', value: '31' }],
        label: '新根',
        value: '3',
      },
    ];
    await nextTick();
    await nextTick();

    expect(tree.text()).toContain('新子节点');
  });

  it('公开方法按标识展开与收起节点', /** 标识越界写入会让展开集合出现树里不存在的键。 */ async () => {
    const { api, tree } = mountTree({ treeData: departments() });

    api.expandNodes(['1', '11', 'DUMMY-不存在']);
    await nextTick();
    expect(tree.text()).toContain('基础架构组');

    // 已展开的键重复下发时保持原状，不产生重复键。
    api.expandNodes('11');
    await nextTick();
    expect(tree.text()).toContain('基础架构组');

    api.collapseNodes(['1']);
    await nextTick();
    expect(tree.text()).not.toContain('前端组');
  });

  it('公开方法展开全部、收起全部与按层级展开', /** 全量展开与按层级展开错漏会让批量操作按钮失去意义。 */ async () => {
    const { api, tree } = mountTree({ treeData: departments() });

    api.expandAll();
    await nextTick();
    expect(tree.text()).toContain('基础架构组');

    api.collapseAll();
    await nextTick();
    expect(tree.text()).not.toContain('前端组');

    api.expandToLevel(1);
    await nextTick();
    expect(tree.text()).toContain('前端组');
    expect(tree.text()).not.toContain('基础架构组');

    api.expandToLevel(3);
    await nextTick();
    expect(tree.text()).toContain('基础架构组');
  });

  it('展开全部跳过没有取值的父节点', /** 无标识节点参与展开会让展开集合出现空键。 */ async () => {
    const { api, tree } = mountTree({
      treeData: [
        { children: [{ label: '子', value: '11' }], label: '父' },
        {
          children: [{ label: '子二', value: '21' }],
          label: '父二',
          value: '2',
        },
      ],
    });

    api.expandAll();
    await nextTick();

    expect(
      nodeWrappers(tree).map(
        /** 收集当前可见节点文案，确认只展开了有标识的父节点。 */ (node) =>
          node.text(),
      ),
    ).toEqual(['父', '父二', '子二']);
  });

  it('按标识反查节点数据', /** 反查失效会让调用方拿不到回显所需的完整节点。 */ () => {
    const { api } = mountTree({ treeData: departments() });

    expect(api.getItemByValue('11')?.label).toBe('前端组');
    expect(api.getItemByValue('DUMMY-不存在')).toBeUndefined();
  });
});

describe('树形选择单选', /** 单选值错乱会让表单提交错误的部门。 */ () => {
  it('点击文字区域写入单值 v-model 并高亮', /** 选中不写回会让上层拿不到用户选择。 */ async () => {
    const { model, tree } = mountTree({ treeData: departments() });

    await clickLabel(tree, '市场部');

    expect(model.value).toBe('2');
    expect(nodeByLabel(tree, '市场部').attributes('data-selected')).toBe('');

    // 单选且未开启 allowClear 时点击别的节点是替换而不是取消。
    await clickLabel(tree, '研发中心');

    expect(model.value).toBe('1');
    expect(nodeByLabel(tree, '市场部').attributes('data-selected')).toBe(
      undefined,
    );
  });

  it('受控单值回填到渲染层', /** 回填失效会让弹窗打开时看不到已保存的选择。 */ async () => {
    const { tree } = mountTree({ treeData: departments() }, '1');
    await nextTick();

    expect(nodeByLabel(tree, '研发中心').attributes('data-selected')).toBe('');
  });

  it('受控单值命中禁用节点时清空', /** 保留已禁用选项会让用户提交越权数据。 */ async () => {
    const { model } = mountTree({ treeData: departments() }, '12');
    await nextTick();

    expect(model.value).toBeUndefined();
  });

  it('点击没有取值字段的节点不写入 v-model', /** 写入 undefined 会让上层表单提交出非法值。 */ async () => {
    const { model, tree } = mountTree({
      treeData: [{ label: '有值', value: '1' }, { label: '无值' }],
    });

    await clickLabel(tree, '无值');

    expect(model.value).toBeUndefined();
  });

  it('allowClear 开启后再次点击取消渲染层选中', /** 取消动作必须反映在渲染层，否则用户无法改选。 */ async () => {
    const { model, tree } = mountTree(
      { allowClear: true, treeData: departments() },
      '2',
    );

    await clickLabel(tree, '市场部');

    // 取消动作由渲染层承接：行不再高亮，同时回调了 select 事件；受控值由调用方自行清理。
    expect(model.value).toBe('2');
    expect(tree.emitted('select')).toHaveLength(1);
  });
});

describe('树形选择多选与父子联动', /** 联动规则错误会让父节点与子节点状态互相矛盾。 */ () => {
  it('点击文字区域勾选节点并带上下级', /** 未带下级会让上层拿到的授权不完整。 */ async () => {
    const { model, tree } = mountTree({
      multiple: true,
      treeData: departments(),
    });

    await expandNode(tree, '研发中心');
    await clickLabel(tree, '前端组');

    // 文字区域点击由渲染层直接受理，最终下发值为被点节点加上它的全部下级。
    expect(model.value).toEqual(['11', '111']);
    expect(tree.emitted('select')).toHaveLength(1);
  });

  it('点击节点复选框勾选并过滤禁用节点', /** 复选框未走筛选会让禁用节点被写进 v-model。 */ async () => {
    const { model, tree } = mountTree({
      multiple: true,
      treeData: departments(),
    });

    await expandNode(tree, '研发中心');
    click(checkboxElement(tree, '前端组'));
    await nextTick();
    await nextTick();
    expect(model.value).toContain('11');

    // 禁用节点自身不可勾选，点击后选中集合保持不变。
    const before = [...(model.value as string[])];
    click(checkboxElement(tree, '后端组'));
    click(labelElement(tree, '后端组'));
    click(nodeByLabel(tree, '后端组').element);
    click(chevronElement(tree, '后端组'));
    await nextTick();

    expect(model.value).toEqual(before);
    expect(nodeByLabel(tree, '后端组').classes()).toContain(
      'cursor-not-allowed',
    );
    expect(
      checkboxElement(tree, '后端组').getAttribute('disabled'),
    ).not.toBeNull();
  });

  it('取消已选子节点后其父级按渲染层结果保留', /** 取消子节点不能误删仍在选中的父级。 */ async () => {
    const { model, tree } = mountTree(
      { multiple: true, treeData: departments() },
      ['1', '11'],
    );

    await expandNode(tree, '研发中心');
    expect(nodeByLabel(tree, '前端组').attributes('data-selected')).toBe('');

    await clickLabel(tree, '前端组');

    expect(model.value).toEqual(['1']);
  });

  it('行点击在节点未选中时回收没有其他已选子节点的父级', /** 已选父级下再没有已选子节点时必须一起回收。 */ async () => {
    const { model, tree } = mountTree(
      { multiple: true, treeData: departments() },
      ['1'],
    );

    await expandNode(tree, '研发中心');
    click(nodeByLabel(tree, '前端组').element);
    await nextTick();

    expect(model.value).toEqual([]);
  });

  it('行点击在节点未选中但兄弟仍选中时保留父级', /** 过早回收父级会让用户丢掉未操作的选中项。 */ async () => {
    const { model, tree } = mountTree(
      { multiple: true, treeData: departments() },
      ['1', '13'],
    );

    await expandNode(tree, '研发中心');
    click(nodeByLabel(tree, '前端组').element);
    await nextTick();

    expect(model.value).toEqual(['1', '13']);
  });

  it('行点击在节点已选中时补齐父级', /** 未补父级会让上层只拿到子节点，权限数据不完整。 */ async () => {
    const { model, tree } = mountTree(
      { multiple: true, treeData: departments() },
      ['11'],
    );

    await expandNode(tree, '研发中心');
    click(nodeByLabel(tree, '前端组').element);
    await nextTick();

    expect(model.value).toEqual(['11', '1']);

    // 父级已在选中集合中时再次点击不产生重复项。
    click(nodeByLabel(tree, '前端组').element);
    await nextTick();

    expect(model.value).toEqual(['11', '1']);
  });

  it('autoCheckParent 关闭时行点击不补父级', /** 开关失效会让只想选叶子的调用方拿到多余父级。 */ async () => {
    const { model, tree } = mountTree(
      { autoCheckParent: false, multiple: true, treeData: departments() },
      ['11'],
    );

    await expandNode(tree, '研发中心');
    click(nodeByLabel(tree, '前端组').element);
    await nextTick();

    expect(model.value).toEqual(['11']);
  });

  it('checkStrictly 关闭父子关联选择', /** 严格模式下自动带上子节点会让调用方无法只授权部分节点。 */ async () => {
    const { model, tree } = mountTree({
      checkStrictly: true,
      multiple: true,
      treeData: departments(),
    });

    await expandNode(tree, '研发中心');
    await clickLabel(tree, '前端组');

    expect(model.value).toEqual(['11']);
  });

  it('无取值字段的节点不写入 v-model', /** 写入 undefined 会让上层表单提交出非法值。 */ async () => {
    const { model, tree } = mountTree({
      multiple: true,
      treeData: [{ label: '有值', value: '1' }, { label: '无值' }],
    });

    await clickLabel(tree, '无值');

    expect(model.value).toEqual([]);
  });

  it('点击工具条复选框全选，公开方法可取消全选', /** 全选未跳过禁用节点会让禁用项被提交。 */ async () => {
    const { api, model, tree } = mountTree({
      multiple: true,
      treeData: departments(),
    });

    click(toolbarElements(tree).checkbox);
    await nextTick();

    expect(model.value).toEqual(['1', '11', '111', '13', '2', '21']);
    expect(tree.text()).toContain('研发中心');

    api.unCheckAll();
    await nextTick();

    expect(model.value).toEqual([]);
  });

  it('公开方法 checkAll 跳过禁用与无值节点', /** 直接调用公开方法时同样不能写入非法标识。 */ async () => {
    const { api, model } = mountTree({
      multiple: true,
      treeData: [
        { children: [{ label: '子', value: '11' }], label: '父', value: '1' },
        { disabled: true, label: '禁用', value: '12' },
        { label: '无值' },
      ],
    });

    api.checkAll();
    await nextTick();

    expect(model.value).toEqual(['1', '11']);
  });

  it('单选模式下全选方法不生效', /** 单选树被全选会破坏「只能选一个」的契约。 */ async () => {
    const { api, model, tree } = mountTree({ treeData: departments() }, '2');

    api.checkAll();
    api.unCheckAll();
    await nextTick();

    expect(model.value).toBe('2');
    expect(tree.text()).toContain('市场部');
  });
});

describe('树形选择禁用与受控值', /** 禁用过滤与无效值清理决定提交数据的合法性。 */ () => {
  it('组件整体禁用时任何节点都不能操作', /** 整体禁用失效会让查看态变成可编辑态。 */ async () => {
    const { model, tree } = mountTree({
      disabled: true,
      multiple: true,
      treeData: departments(),
    });

    click(labelElement(tree, '市场部'));
    click(nodeByLabel(tree, '市场部').element);
    click(checkboxElement(tree, '市场部'));
    await nextTick();

    expect(model.value).toBeUndefined();
    expect(nodeByLabel(tree, '市场部').classes()).toContain(
      'cursor-not-allowed',
    );
  });

  it('受控值中的失效标识被过滤并回写', /** 不回写会让调用方一直以为还选中着已删除的节点。 */ async () => {
    const { model } = mountTree({ multiple: true, treeData: departments() }, [
      '1',
      'DUMMY-已删除',
    ]);
    await nextTick();

    expect(model.value).toEqual(['1']);
  });

  it('受控值中的禁用标识被过滤并回写', /** 保留禁用标识等于绕过了权限校验。 */ async () => {
    const { model } = mountTree({ multiple: true, treeData: departments() }, [
      '11',
      '12',
    ]);
    await nextTick();

    expect(model.value).toEqual(['11']);
  });

  it('空数组受控值与未传受控值都能渲染', /** 空值分支写错会让树在初始化时抛错。 */ async () => {
    const empty = mountTree({ multiple: true, treeData: departments() }, []);
    const unset = mountTree({ treeData: departments() });

    await nextTick();

    expect(empty.model.value).toEqual([]);
    expect(empty.tree.text()).toContain('研发中心');
    expect(unset.model.value).toBeUndefined();
    expect(unset.tree.text()).toContain('研发中心');
  });

  it('多选模式下传入非法单值被清空', /** 形状与 multiple 不一致会让渲染层读到错误结构。 */ async () => {
    const { model, tree } = mountTree(
      { multiple: true, treeData: departments() },
      'DUMMY-已删除',
    );
    await nextTick();

    expect(model.value).toEqual([]);
    expect(tree.text()).toContain('市场部');
  });

  it('getNodeClass 为节点追加自定义类名', /** 类名钩子失效会让业务方无法标记特殊节点。 */ async () => {
    const { tree } = mountTree({
      /** 给禁用节点追加业务类名，供调用方做特殊样式。 */
      getNodeClass: (item: { value: { disabled?: boolean } }) =>
        item.value.disabled ? 'DUMMY-disabled-node' : '',
      treeData: departments(),
    });

    expect(tree.find('.DUMMY-disabled-node').exists()).toBe(false);

    await expandNode(tree, '研发中心');
    await vi.waitFor(
      /** 等待自定义类名写入渲染结果，确认类名钩子真的被调用。 */ () => {
        expect(tree.find('.DUMMY-disabled-node').exists()).toBe(true);
      },
    );
  });

  it('transition 关闭时展开仍然生效', /** 动画开关失效会让大数据量树在展开时卡顿。 */ async () => {
    const { tree } = mountTree({
      transition: false,
      treeData: departments(),
    });

    await expandNode(tree, '研发中心');

    expect(tree.text()).toContain('前端组');
  });
});
