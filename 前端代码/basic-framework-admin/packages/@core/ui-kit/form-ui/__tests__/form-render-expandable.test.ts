/**
 * 表单折叠展开计算（useExpandable）的真实行为回归。
 *
 * 覆盖三条只在真实装配下出现的契约：
 * ① 容器引用尚未绑定时不写入任何行映射；
 * ② 折叠按钮从关闭切到打开时会重算行映射；
 * ③ 按容器网格行高把子项归属到具体行，超出折叠行数的子项不参与保留。
 * 断言读取组合式函数暴露的响应式状态与保留索引，不触碰内部 rowMapping。
 */
import type { PropType } from 'vue';

import type { FormRenderProps } from '../src/types';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, reactive, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useExpandable } from '../src/form-render/expandable';

/** 子项相对容器顶部的偏移，用于把三个子项分别放入第 1、2、3 行。 */
const CHILD_TOPS = [10, 70, 110];

/**
 * 被测组合式函数的最小宿主组件。
 * 只负责把外层渲染属性与容器引用交给 useExpandable，并按需要绑定容器引用。
 */
const ExpandableHost = defineComponent({
  name: 'ExpandableHost',
  props: {
    /** 是否把容器引用交给组合式函数；为假时模拟尚未挂载的容器。 */
    bindWrapper: { default: true, type: Boolean },
    /** 外层表单渲染属性，变化必须被组合式函数观察到。 */
    formProps: {
      required: true,
      type: Object as PropType<FormRenderProps>,
    },
  },
  /**
   * 建立容器引用并把外层渲染属性交给被测组合式函数。
   * @param props 宿主组件属性：是否绑定容器引用与表单渲染属性。
   * @returns 暴露给用例的联动状态与容器引用。
   */
  setup(props) {
    const wrapperRef = ref<HTMLElement | null>(null);
    const expandable = useExpandable(props.formProps, wrapperRef);
    return { expandable, wrapperRef };
  },
  /** 容器带固定类名，几何替身据此把它与子项区分开。 */
  template: `
    <div v-if="bindWrapper" ref="wrapperRef" class="rows">
      <i class="row-item" />
      <i class="row-item" />
      <i class="row-item" />
    </div>
  `,
});

/**
 * 接管容器与子项的布局几何，只替换浏览器排版这一外部边界。
 * 容器顶部为 0，三个子项按 CHILD_TOPS 落在连续的网格行上。
 * @param rowHeight 每一行的高度，单位像素；行数由调用方给出的字符串决定。
 * @param rowCount 容器报告的网格行数。
 */
function stubLayout(rowHeight: number, rowCount: number): void {
  const rows = Array.from(
    { length: rowCount },
    /** 按声明行数生成等高行。 */ () => `${rowHeight}px`,
  ).join(' ');
  const originalGetComputedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    /**
     * 容器的网格行高由替身给出，其余元素沿用真实实现，避免影响其他组件。
     * @param element 被查询样式的元素。
     * @returns 该元素的计算样式。
     */
    (element: Element) => {
      if (element.classList?.contains('rows')) {
        return {
          /** 只回答网格行高查询，其余样式名返回空值。 */
          getPropertyValue: (name: string) =>
            name === 'grid-template-rows' ? rows : '',
        } as unknown as CSSStyleDeclaration;
      }
      return originalGetComputedStyle.call(window, element);
    },
  );

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    /**
     * 容器顶部为 0；子项按其在容器内的位置返回预设顶部偏移。
     * @returns 该元素的矩形；未参与布局的元素返回零矩形。
     */
    function (this: Element): DOMRect {
      const parent = this.parentElement;
      const index =
        parent?.classList.contains('rows') === true
          ? [...parent.children].indexOf(this)
          : -1;
      const top = index >= 0 ? (CHILD_TOPS[index] ?? 0) : 0;
      return {
        bottom: top,
        height: 0,
        left: 0,
        right: 0,
        /** 零矩形的序列化结果，本组不比较该值。 */
        toJSON: () => ({}),
        top,
        width: 0,
        x: 0,
        y: top,
      } as DOMRect;
    },
  );
}

/**
 * 挂载宿主组件并等待挂载后的异步行计算结算。
 * @param formProps 表单渲染属性，调用方保留引用以便后续修改触发重算。
 * @param bindWrapper 是否把容器引用交给组合式函数。
 * @returns 已挂载的宿主包装器。
 */
async function mountHost(formProps: FormRenderProps, bindWrapper = true) {
  const wrapper = mount(ExpandableHost, {
    props: { bindWrapper, formProps },
  });
  await flushPromises();
  return wrapper;
}

describe('useExpandable 折叠行计算', /** 容器几何到保留索引的映射契约。 */ () => {
  afterEach(
    /** 恢复被替换的浏览器布局接口，避免影响其他用例。 */ () => {
      vi.restoreAllMocks();
    },
  );

  it('容器引用缺失时不写入行映射', /** 容器尚未挂载时不能按空几何误判可展开项，计算标记必须保持未完成。 */ async () => {
    const formProps = reactive({
      collapsedRows: 1,
      schema: [{ fieldName: 'name' }],
      showCollapseButton: true,
    }) as unknown as FormRenderProps;

    const wrapper = await mountHost(formProps, false);

    expect(wrapper.vm.expandable.isCalculated.value).toBe(false);
    // 未计算时保留索引为 -1，小于任何表单项下标，不会误判为“保留若干行”。
    expect(wrapper.vm.expandable.keepFormItemIndex.value).toBe(-1);
  });

  it('折叠按钮打开时按网格行归属重算行映射', /** 关闭状态下不计算；打开后只保留折叠行数以内的子项，超出的子项被排除。 */ async () => {
    stubLayout(50, 2);
    const formProps = reactive({
      collapsedRows: 1,
      schema: [{ fieldName: 'name' }],
      showCollapseButton: false,
    }) as unknown as FormRenderProps;

    const wrapper = await mountHost(formProps);

    // 折叠按钮关闭：挂载期不计算。
    expect(wrapper.vm.expandable.isCalculated.value).toBe(false);

    formProps.showCollapseButton = true;
    await flushPromises();

    // 第 1 行有 1 个子项，第 2 行的子项超出折叠行数被排除，保留索引为 1。
    expect(wrapper.vm.expandable.isCalculated.value).toBe(true);
    expect(wrapper.vm.expandable.keepFormItemIndex.value).toBe(1);
  });

  it('折叠多行时累加各行子项并让出最后一个位置', /** 保留索引为行内子项总数减一，最后一项不参与折叠保留。 */ async () => {
    stubLayout(50, 3);
    const formProps = reactive({
      collapsedRows: 3,
      schema: [{ fieldName: 'name' }],
      showCollapseButton: true,
    }) as unknown as FormRenderProps;

    const wrapper = await mountHost(formProps);

    // 三行各 1 个子项：合计 3，保留索引为 2。
    expect(wrapper.vm.expandable.isCalculated.value).toBe(true);
    expect(wrapper.vm.expandable.keepFormItemIndex.value).toBe(2);

    // 折叠行数收缩到 1 行后，第 2、3 行的子项都不再计入。
    formProps.collapsedRows = 1;
    await flushPromises();
    expect(wrapper.vm.expandable.keepFormItemIndex.value).toBe(1);
  });

  it('宿主渲染容器与组合式函数返回同一个引用', /** 调用方需要把同一个容器引用交给模板，返回不同的引用会让几何计算读不到真实节点。 */ async () => {
    stubLayout(50, 1);
    const formProps = reactive({
      collapsedRows: 1,
      schema: [],
      showCollapseButton: true,
    }) as unknown as FormRenderProps;

    const wrapper = await mountHost(formProps);
    const returned = wrapper.vm.expandable.wrapperRef.value;

    // 模板返回的顶层 ref 会被代理解包，宿主上的 wrapperRef 即真实元素。
    expect(returned).toBe(wrapper.vm.wrapperRef);
    expect(returned?.classList.contains('rows')).toBe(true);
  });

  it('折叠行数缺省时按一行处理', /** collapsedRows 未声明时按 1 行折叠，不能把全部子项都保留下来。 */ async () => {
    stubLayout(50, 2);
    const formProps = reactive({
      schema: [{ fieldName: 'name' }],
      showCollapseButton: true,
    }) as unknown as FormRenderProps;

    const wrapper = await mountHost(formProps);

    expect(wrapper.vm.expandable.isCalculated.value).toBe(true);
    expect(wrapper.vm.expandable.keepFormItemIndex.value).toBe(1);
  });
});
