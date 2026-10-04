/**
 * 弹窗拖拽行为（popup-ui 的 use-modal-draggable）真实行为回归。
 *
 * 该 composable 让弹窗标题栏可以按住拖动：夹取边界算错会把弹窗拖出可视区域，
 * 拖拽开关失效会让禁用拖拽的弹窗仍被移动，拖拽状态或位移未复位会让弹窗在
 * 再次打开时停留在上次位置。用例挂载真实组件与真实 DOM 事件，只替换布局引擎的
 * 尺寸来源（getBoundingClientRect 与 documentElement 的客户区尺寸），
 * 监听注册、位移计算、夹取、复位与卸载清理全部按真实实现执行。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { Ref } from 'vue';

import { mount } from '@vue/test-utils';
import { computed, defineComponent, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import { useModalDraggable } from '../use-modal-draggable';

/** 目标元素的布局矩形；只使用 getBoundingClientRect 的真实字段。 */
interface RectFixture {
  /** 目标元素高度。 */
  height: number;
  /** 目标元素左边距。 */
  left: number;
  /** 目标元素上边距。 */
  top: number;
  /** 目标元素宽度。 */
  width: number;
}

/** 用例读取的 composable 返回值与模板引用；宿主组件挂载时写入。 */
const captured: {
  /** resetPosition 与 transform 的持有者。 */
  state?: ReturnType<typeof useModalDraggable>;
  /** 目标元素引用，用例可清空以模拟元素已不存在。 */
  targetRef?: Ref<HTMLElement | undefined>;
} = {};

/** 宿主组件声明拖拽开关、居中标记与容器选择器，用于覆盖各分支。 */
const DraggableHost = defineComponent({
  name: 'DraggableHost',
  props: {
    /** 是否允许拖拽。 */
    draggable: { default: true, type: Boolean },
    /** 是否按居中定位计算位移文本。 */
    centered: { default: false, type: Boolean },
    /** 限制拖拽范围的容器选择器；空串表示不限制。 */
    container: { default: '', type: String },
  },
  /**
   * 建立真实目标元素与拖拽把手，并把 composable 结果交给用例。
   * @param props 宿主组件声明的拖拽配置。
   * @returns 渲染目标元素与把手的渲染函数。
   */
  setup(props) {
    const targetRef = ref<HTMLElement>();
    const dragRef = ref<HTMLElement>();
    const state = useModalDraggable(
      targetRef,
      dragRef,
      computed(/** 读取宿主声明的拖拽开关。 */ () => props.draggable),
      computed(
        /** 读取容器选择器；空串表示不限制拖拽范围。 */ () =>
          props.container === '' ? undefined : props.container,
      ),
      computed(/** 读取宿主声明的居中标记。 */ () => props.centered),
    );
    captured.state = state;
    captured.targetRef = targetRef;
    return /** 渲染目标元素与拖拽把手，供真实鼠标事件命中。 */ () =>
      h('div', { class: 'drag-target', ref: targetRef }, [
        h('div', { class: 'drag-handle', ref: dragRef }, '拖拽'),
      ]);
  },
});

/** 当前用例挂载的宿主包装器，用于逐例卸载并释放监听。 */
let wrapper: undefined | VueWrapper;

/** 当前用例创建的容器元素，逐例从文档中移除。 */
let container: HTMLElement | undefined;

/**
 * 固定元素的布局矩形，替代真实布局引擎。
 * @param element 需要固定尺寸的元素。
 * @param rect 元素的左边距、上边距、宽度与高度。
 */
function stubRect(element: Element, rect: RectFixture) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    /** 按夹具尺寸返回布局矩形，替代真实布局引擎。 */
    value: () => new DOMRect(rect.left, rect.top, rect.width, rect.height),
  });
}

/**
 * 固定文档客户区尺寸，替代真实视口测量。
 * @param width 视口客户区宽度。
 * @param height 视口客户区高度。
 */
function stubViewport(width: number, height: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: height,
  });
}

/**
 * 挂载拖拽宿主并固定目标元素矩形。
 * @param options 拖拽开关、居中标记与容器选择器。
 * @param options.centered 是否按居中定位计算位移文本。
 * @param options.container 限制拖拽范围的容器选择器；空串表示不限制。
 * @param options.draggable 是否允许拖拽。
 * @returns 已挂载的宿主包装器。
 * @throws Error composable 未交出状态时抛出，避免用例静默地什么都不验证。
 */
async function mountHost(
  options: { centered?: boolean; container?: string; draggable?: boolean } = {},
) {
  // happy-dom 的客户区尺寸默认为 0，先固定为可预期的视口再挂载
  stubViewport(1000, 800);
  wrapper = mount(DraggableHost, { props: options });
  await nextTick();
  if (!captured.state) {
    throw new Error('拖拽 composable 未交出状态');
  }
  stubRect(wrapper.find('.drag-target').element, {
    height: 100,
    left: 100,
    top: 50,
    width: 200,
  });
  return wrapper;
}

/**
 * 在把手上按下鼠标，开始一次拖拽。
 * @param target 已挂载的宿主包装器。
 * @param clientX 按下时的横坐标。
 * @param clientY 按下时的纵坐标。
 */
function pressHandle(target: VueWrapper, clientX: number, clientY: number) {
  target
    .find('.drag-handle')
    .element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX, clientY }),
    );
}

/**
 * 在文档上移动鼠标。
 * @param clientX 移动到的横坐标。
 * @param clientY 移动到的纵坐标。
 */
function moveMouse(clientX: number, clientY: number) {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
}

/** 在文档上松开鼠标，结束当前拖拽。 */
function releaseMouse() {
  document.dispatchEvent(new MouseEvent('mouseup'));
}

/**
 * 读取目标元素当前的位移样式。
 * @param target 已挂载的宿主包装器。
 * @returns 目标元素 style.transform 的真实值。
 */
function transformStyle(target: VueWrapper) {
  return (target.find('.drag-target').element as HTMLElement).style.transform;
}

afterEach(
  /** 卸载宿主并清理视口与容器替身，避免监听和尺寸跨用例残留。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
    container?.remove();
    container = undefined;
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
    captured.state = undefined;
    captured.targetRef = undefined;
  },
);

describe('拖拽监听注册', /** 拖拽开关决定把手是否响应鼠标按下，禁用时必须真的不响应。 */ () => {
  it('允许拖拽时按下把手即可移动目标元素', /** 监听未注册会让弹窗完全拖不动。 */ async () => {
    const target = await mountHost({ draggable: true });

    pressHandle(target, 150, 80);
    moveMouse(200, 100);

    expect(captured.state?.transform).toEqual({ offsetX: 50, offsetY: 20 });
    expect(transformStyle(target)).toBe('translate(50px, 20px)');
    expect(captured.state?.dragging.value).toBe(true);
    releaseMouse();
  });

  it('禁用拖拽时把手不注册监听', /** 禁用后仍能拖动会让只读弹窗被移出可视区域。 */ async () => {
    const target = await mountHost({ draggable: false });

    pressHandle(target, 150, 80);
    moveMouse(200, 100);

    expect(captured.state?.transform).toEqual({ offsetX: 0, offsetY: 0 });
    expect(transformStyle(target)).toBe('');
    expect(captured.state?.dragging.value).toBe(false);
  });

  it('运行中关闭拖拽后把手不再响应', /** 开关切换必须真正解绑，否则禁用只对首次挂载生效。 */ async () => {
    const target = await mountHost({ draggable: true });
    await target.setProps({ draggable: false });
    await nextTick();

    pressHandle(target, 150, 80);
    moveMouse(200, 100);

    expect(captured.state?.transform).toEqual({ offsetX: 0, offsetY: 0 });
    expect(transformStyle(target)).toBe('');
  });

  it('目标元素不存在时按下把手不产生位移', /** 元素已销毁仍继续拖动会写入无效状态并残留文档监听。 */ async () => {
    const target = await mountHost({ draggable: true });
    if (!captured.targetRef) {
      throw new Error('用例未取得目标元素引用');
    }
    captured.targetRef.value = undefined;

    pressHandle(target, 150, 80);
    moveMouse(200, 100);

    expect(captured.state?.transform).toEqual({ offsetX: 0, offsetY: 0 });
    expect(transformStyle(target)).toBe('');
  });
});

describe('拖拽位移夹取', /** 夹取边界决定弹窗能拖多远，算错会让标题栏移出可点击区域。 */ () => {
  it('未指定容器时按视口尺寸夹取上下左右边界', /** 视口边界算错会让弹窗被拖出屏幕且无法拖回。 */ async () => {
    const target = await mountHost({ draggable: true });

    pressHandle(target, 150, 80);
    moveMouse(2000, 2000);
    expect(captured.state?.transform).toEqual({ offsetX: 700, offsetY: 650 });
    expect(transformStyle(target)).toBe('translate(700px, 650px)');

    moveMouse(-500, -500);
    expect(captured.state?.transform).toEqual({ offsetX: -100, offsetY: -50 });
    expect(transformStyle(target)).toBe('translate(-100px, -50px)');
    releaseMouse();
  });

  it('指定容器时按容器矩形夹取', /** 容器限制失效会让弹窗盖住容器外的固定操作区。 */ async () => {
    container = document.createElement('div');
    container.className = 'drag-container';
    document.body.append(container);
    stubRect(container, { height: 400, left: 10, top: 20, width: 500 });
    const target = await mountHost({
      container: '.drag-container',
      draggable: true,
    });

    pressHandle(target, 150, 80);
    moveMouse(2000, 2000);
    expect(captured.state?.transform).toEqual({ offsetX: 210, offsetY: 270 });

    moveMouse(-500, -500);
    expect(captured.state?.transform).toEqual({ offsetX: -90, offsetY: -30 });
    releaseMouse();
  });

  it('容器选择器匹配不到元素时回退到视口尺寸', /** 容器被条件渲染移除后仍按视口夹取，避免弹窗卡死不动。 */ async () => {
    const target = await mountHost({
      container: '.missing-container',
      draggable: true,
    });

    pressHandle(target, 150, 80);
    moveMouse(2000, 2000);

    expect(captured.state?.transform).toEqual({ offsetX: 700, offsetY: 650 });
    releaseMouse();
  });

  it('居中定位时位移文本保留垂直居中偏移', /** 居中弹窗少算 -50% 会让标题栏与内容错位。 */ async () => {
    const target = await mountHost({ centered: true, draggable: true });

    pressHandle(target, 150, 80);
    moveMouse(200, 100);

    expect(transformStyle(target)).toBe('translate(50px, calc(-50% + 20px))');
    releaseMouse();
  });
});

describe('拖拽结束与复位', /** 松开鼠标或复位必须清空状态，否则下次打开会沿用旧位置。 */ () => {
  it('松开鼠标后拖拽状态结束且不再跟随移动', /** 未解绑文档监听会让弹窗在松手后仍跟着鼠标跑。 */ async () => {
    const target = await mountHost({ draggable: true });
    pressHandle(target, 150, 80);
    moveMouse(200, 100);

    releaseMouse();

    expect(captured.state?.dragging.value).toBe(false);
    moveMouse(400, 400);
    expect(captured.state?.transform).toEqual({ offsetX: 50, offsetY: 20 });
    expect(transformStyle(target)).toBe('translate(50px, 20px)');
  });

  it('复位把位移与样式一起清空', /** 只清状态不清样式会让弹窗视觉位置与内部状态不一致。 */ async () => {
    const target = await mountHost({ draggable: true });
    pressHandle(target, 150, 80);
    moveMouse(200, 100);
    releaseMouse();

    captured.state?.resetPosition();

    expect(captured.state?.transform).toEqual({ offsetX: 0, offsetY: 0 });
    expect(transformStyle(target)).toBe('');
  });

  it('组件卸载后把手不再产生位移', /** 卸载未解绑会让已销毁弹窗的把手继续响应按下事件。 */ async () => {
    const target = await mountHost({ draggable: true });
    const handle = target.find('.drag-handle').element;
    wrapper?.unmount();
    wrapper = undefined;

    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 150, clientY: 80 }),
    );
    moveMouse(200, 100);

    expect(captured.state?.transform).toEqual({ offsetX: 0, offsetY: 0 });
    expect(captured.state?.dragging.value).toBe(false);
  });
});
