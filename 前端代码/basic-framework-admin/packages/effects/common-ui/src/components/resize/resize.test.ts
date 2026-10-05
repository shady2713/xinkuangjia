/**
 * 可调整尺寸容器（common-ui 的 resize/resize.vue）真实行为回归。
 *
 * 组件把鼠标与触摸的按下、移动、松开换算成整体的位置平移或单边缩放，并在拖动过程中按父容器、
 * 最小宽高、锁定比例与网格吸附逐层收敛。换算错误会直接造成用户可见故障：拖动方向反了会让
 * 元素往反方向跑，未按父容器夹紧会把元素拖出可视区，最小宽高兜底缺失会把元素缩成一条线，
 * 比例锁定失效会让调整后的元素变形，网格吸附算错会让拖拽抖动或跳格，程序化改属性时不重算
 * 会让外部数据与界面不一致，卸载未解绑会让已移除的元素继续响应鼠标。
 *
 * 用例真实挂载组件、真实在文档上派发鼠标与触摸序列、真实按下控制点与拖拽手柄；happy-dom 不
 * 排版，父容器尺寸与内容尺寸按浏览器契约注入，组件自身的换算逻辑全部真实执行。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Resize from './resize.vue';

/** 用例挂载的组件包装器，用例结束后统一卸载，避免全局监听残留。 */
let wrapper: ReturnType<typeof mount> | undefined;

/** 父容器宽度，所有位置换算的基准。 */
const PARENT_W = 600;

/** 父容器高度，所有位置换算的基准。 */
const PARENT_H = 400;

/** 元素默认宽度。 */
const WIDTH = 200;

/** 元素默认高度。 */
const HEIGHT = 200;

/**
 * 挂载可调整尺寸容器。
 * @param props 传给组件的属性。
 * @returns 已挂载的组件包装器。
 */
function mountResize(props: Record<string, unknown> = {}) {
  wrapper = mount(Resize, {
    props: { parentH: PARENT_H, parentW: PARENT_W, ...props },
    slots: { default: '<i class="DUMMY-content"></i>' },
  });
  return wrapper;
}

/**
 * 取元素根节点的行内样式。
 * @param target 已挂载的组件包装器。
 * @returns 根元素的行内样式对象。
 */
function rootStyle(target: ReturnType<typeof mount>) {
  return (target.element as HTMLElement).style;
}

/**
 * 取内容容器的行内样式。
 * @param target 已挂载的组件包装器。
 * @returns 内容容器的行内样式对象。
 */
function contentStyle(target: ReturnType<typeof mount>) {
  return (target.find('.content-container').element as HTMLElement).style;
}

/**
 * 构造带页面坐标的鼠标事件。
 * happy-dom 的 MouseEvent 构造器不读取 pageX/pageY，这里按浏览器契约注入。
 * @param type 事件类型。
 * @param x 页面横坐标。
 * @param y 页面纵坐标。
 * @returns 可直接派发的鼠标事件。
 */
function mouseEvent(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0 });
  Object.defineProperty(event, 'pageX', { configurable: true, value: x });
  Object.defineProperty(event, 'pageY', { configurable: true, value: y });
  return event;
}

/**
 * 在文档根节点上派发鼠标事件。
 * @param type 事件类型。
 * @param x 页面横坐标。
 * @param y 页面纵坐标。
 */
function fireOnDocument(type: string, x: number, y: number) {
  document.documentElement.dispatchEvent(mouseEvent(type, x, y));
}

/**
 * 完成一次整体拖动。
 * @param target 已挂载的组件包装器。
 * @param from 按下时的页面坐标。
 * @param from.x 按下时的页面横坐标。
 * @param from.y 按下时的页面纵坐标。
 * @param to 移动到的页面坐标。
 * @param to.x 移动到的页面横坐标。
 * @param to.y 移动到的页面纵坐标。
 */
async function dragBody(
  target: ReturnType<typeof mount>,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await target.trigger('mousedown', {
    button: 0,
    pageX: from.x,
    pageY: from.y,
  });
  fireOnDocument('mousemove', to.x, to.y);
  await nextTick();
  fireOnDocument('mouseup', to.x, to.y);
  await nextTick();
}

/** 未显式给出按下位置时的默认起点：页面左上角。 */
const DEFAULT_FROM = { x: 0, y: 0 };

/**
 * 完成一次控制点缩放。
 * @param target 已挂载的组件包装器。
 * @param stick 控制点标识，例如 br。
 * @param to 移动到的页面坐标；对右下类控制点，坐标变大即放大。
 * @param to.x 移动到的页面横坐标。
 * @param to.y 移动到的页面纵坐标。
 * @param from 按下时的页面坐标，缺省为 (0, 0)。
 * @param from.x 按下时的页面横坐标。
 * @param from.y 按下时的页面纵坐标。
 */
async function dragStick(
  target: ReturnType<typeof mount>,
  stick: string,
  to: { x: number; y: number },
  from: { x: number; y: number } = DEFAULT_FROM,
) {
  await target
    .find(`.resize-stick-${stick}`)
    .trigger('mousedown', { button: 0, pageX: from.x, pageY: from.y });
  fireOnDocument('mousemove', to.x, to.y);
  await nextTick();
  fireOnDocument('mouseup', to.x, to.y);
  await nextTick();
}

/**
 * 构造带触摸点信息的触摸事件。
 * @param type 触摸事件类型。
 * @param pageX 触点相对页面左边缘的横坐标。
 * @param pageY 触点相对页面顶边缘的纵坐标。
 * @returns 已注入触摸点的可派发事件。
 */
function touchEvent(type: string, pageX: number, pageY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  // happy-dom 不提供 TouchEvent 构造器，这里按浏览器契约注入触点列表。
  Object.defineProperty(event, 'touches', {
    value: [{ pageX, pageY }],
  });
  return event;
}

afterEach(
  /** 卸载组件，避免文档上的监听影响其它用例。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
  },
);

describe('可调整尺寸容器渲染', /** 初始位置与尺寸决定元素是否落在预期的位置。 */ () => {
  it('按父容器与宽高渲染位置、尺寸与八个控制点', /** 位置或控制点缺失会让用户无法拖动或缩放。 */ async () => {
    const target = mountResize();
    await nextTick();

    expect(rootStyle(target).top).toBe('0px');
    expect(rootStyle(target).left).toBe('0px');
    expect(contentStyle(target).width).toBe(`${WIDTH}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT}px`);
    expect(target.findAll('.resize-stick')).toHaveLength(8);
    expect(target.find('.DUMMY-content').exists()).toBe(true);
    expect(target.classes()).toContain('inactive');
  });

  it('传入初始坐标与层级时写入样式', /** 初始坐标丢失会让弹窗每次打开都跳到左上角。 */ async () => {
    const target = mountResize({ x: 30, y: 40, z: 5 });
    await nextTick();

    expect(rootStyle(target).top).toBe('40px');
    expect(rootStyle(target).left).toBe('30px');
    expect(rootStyle(target).zIndex).toBe('5');
  });

  it('层级为 auto 时按原值写入，交给浏览器决定层级', /** 层级处理与取值不一致会让外部样式表失去控制权。 */ async () => {
    const target = mountResize({ z: 'auto' });
    await nextTick();

    expect(rootStyle(target).zIndex).toBe('auto');
  });

  it('宽高为 auto 时把尺寸交给内容决定', /** auto 被当成像素值会让内容自适应失效。 */ async () => {
    const target = mount(Resize, {
      props: { h: 'auto', parentH: PARENT_H, parentW: PARENT_W, w: 'auto' },
      slots: { default: '<i class="DUMMY-content"></i>' },
    });
    wrapper = target;
    // happy-dom 不排版且挂载后才拿得到容器，按浏览器契约注入内容实际占用的尺寸。
    const container = target.find('.content-container').element;
    Object.defineProperty(container, 'scrollWidth', {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 80,
    });
    // 改父容器触发一次按内容尺寸重算边距的真实流程。
    await target.setProps({ parentH: PARENT_H + 1 });
    await nextTick();

    expect(contentStyle(target).width).toBe('auto');
    expect(contentStyle(target).height).toBe('auto');
    expect(container.scrollWidth).toBe(120);
  });

  it('关闭缩放时控制点带不可调整标记', /** 标记缺失会让用户以为还能拉伸。 */ () => {
    const target = mountResize({ isResizable: false });

    expect(target.find('.resize-stick-br').classes()).toContain(
      'not-resizable',
    );
  });

  it('激活状态下渲染 active 类名并在失活时抛出事件', /** 激活态缺失会让用户看不出当前选中的是哪个元素。 */ async () => {
    const target = mountResize({ isActive: true });

    expect(target.classes()).toContain('active');
    expect(target.emitted('activated')).toHaveLength(1);

    await target.setProps({ isActive: false });

    expect(target.classes()).toContain('inactive');
    expect(target.emitted('deactivated')).toHaveLength(1);
  });
});

describe('可调整尺寸容器整体拖动', /** 拖动是组件最核心的交互，位置算错用户立刻能看出来。 */ () => {
  it('按下并移动时按位移平移并抛出事件', /** 位移算反会让元素往鼠标反方向跑。 */ async () => {
    const target = mountResize();
    await nextTick();

    await dragBody(target, { x: 100, y: 100 }, { x: 150, y: 130 });

    expect(rootStyle(target).left).toBe('50px');
    expect(rootStyle(target).top).toBe('30px');
    expect(target.emitted('dragging')?.[0]?.[0]).toEqual({
      height: HEIGHT,
      left: 50,
      top: 30,
      width: WIDTH,
    });
    expect(target.emitted('dragstop')).toHaveLength(1);
    expect(target.emitted('clicked')).toHaveLength(1);
  });

  it('未按下时移动鼠标不改变位置', /** 未按下就跟随会让鼠标经过时元素乱跑。 */ async () => {
    const target = mountResize();
    await nextTick();

    fireOnDocument('mousemove', 500, 500);
    await nextTick();

    expect(rootStyle(target).left).toBe('0px');
    expect(rootStyle(target).top).toBe('0px');
    expect(target.emitted('dragging')).toBeUndefined();
  });

  it('父容器限制下不能拖出边界', /** 不夹紧会把元素拖出可视区再也点不到。 */ async () => {
    const target = mountResize({ parentLimitation: true });
    await nextTick();

    await dragBody(target, { x: 0, y: 0 }, { x: -500, y: -500 });
    expect(rootStyle(target).left).toBe('0px');
    expect(rootStyle(target).top).toBe('0px');

    await dragBody(target, { x: 0, y: 0 }, { x: 5000, y: 5000 });

    // 可用行程是父容器尺寸减去元素尺寸。
    expect(rootStyle(target).left).toBe(`${PARENT_W - WIDTH}px`);
    expect(rootStyle(target).top).toBe(`${PARENT_H - HEIGHT}px`);
  });

  it('限制轴向时只允许单方向拖动', /** 轴向限制失效会让固定栏也能被拖走。 */ async () => {
    const horizontal = mountResize({ axis: 'x' });
    await nextTick();
    await dragBody(horizontal, { x: 0, y: 0 }, { x: 50, y: 50 });
    expect(rootStyle(horizontal).left).toBe('50px');
    expect(rootStyle(horizontal).top).toBe('0px');

    horizontal.unmount();

    const vertical = mountResize({ axis: 'y' });
    await nextTick();
    await dragBody(vertical, { x: 0, y: 0 }, { x: 50, y: 50 });
    expect(rootStyle(vertical).left).toBe('0px');
    expect(rootStyle(vertical).top).toBe('50px');

    vertical.unmount();

    const fixed = mountResize({ axis: 'none' });
    await nextTick();
    await dragBody(fixed, { x: 0, y: 0 }, { x: 50, y: 50 });
    expect(rootStyle(fixed).left).toBe('0px');
    expect(rootStyle(fixed).top).toBe('0px');
  });

  it('网格吸附把位置对齐到网格', /** 吸附算错会让拖动一格跳两格。 */ async () => {
    const target = mountResize({ gridX: 50, gridY: 50, snapToGrid: true });
    await nextTick();

    await dragBody(target, { x: 0, y: 0 }, { x: 60, y: 60 });

    expect(rootStyle(target).left).toBe('50px');
    expect(rootStyle(target).top).toBe('50px');
  });

  it('网格吸附同时处理两侧偏差并选择更近的一侧', /** 只处理单侧偏差会让拖动比网格更小时抖动。 */ async () => {
    const target = mountResize({
      gridX: 50,
      gridY: 50,
      h: 180,
      snapToGrid: true,
      w: 180,
    });
    await nextTick();

    await dragBody(target, { x: 0, y: 0 }, { x: 30, y: 30 });

    // 两侧偏差都超过半格时按更近的一侧对齐。
    expect(rootStyle(target).left).toBe('20px');
    expect(rootStyle(target).top).toBe('20px');
  });

  it('网格吸附在另一侧偏差较大时按该侧对齐', /** 只按一侧偏差对齐会让吸附结果偏离更近的网格线。 */ async () => {
    const target = mountResize({
      gridX: 50,
      gridY: 50,
      h: 180,
      snapToGrid: true,
      w: 180,
    });
    await nextTick();

    await dragBody(target, { x: 0, y: 0 }, { x: 46, y: 46 });

    // 两侧偏差都超过半格时分别归位，最终贴在同一列网格线上。
    expect(rootStyle(target).left).toBe('50px');
    expect(rootStyle(target).top).toBe('50px');
  });

  it('点击组件外部时失活', /** 点击别处不失活会让选中态永远留在上一个元素上。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.trigger('mousedown', { button: 0, pageX: 0, pageY: 0 });
    await nextTick();
    expect(target.classes()).toContain('active');

    document.documentElement.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    await nextTick();

    expect(target.classes()).toContain('inactive');
    expect(target.emitted('deactivated')).toHaveLength(1);
  });

  it('禁止自动激活时点击外部也不失活', /** 外部控件托管选中态时组件不能自行取消激活。 */ async () => {
    const target = mountResize({
      isActive: true,
      preventActiveBehavior: true,
    });
    await nextTick();

    document.documentElement.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    await nextTick();

    // 托管模式下组件不自行取消激活，因此不会抛出失活事件。
    expect(target.emitted('deactivated')).toBeUndefined();
  });

  it('禁止自动激活时点击不改变激活状态', /** 该开关用于外部控件的选中态，失效会让选中被抢走。 */ async () => {
    const target = mountResize({ preventActiveBehavior: true });

    await target.trigger('mousedown', { button: 0, pageX: 0, pageY: 0 });
    await nextTick();

    expect(target.emitted('activated')).toBeUndefined();
    expect(target.classes()).toContain('inactive');
  });

  it('右键按下不触发拖动', /** 右键也被当作拖动会让右键菜单与拖动冲突。 */ async () => {
    const target = mountResize();

    await target.trigger('mousedown', { button: 2, pageX: 0, pageY: 0 });

    expect(target.emitted('clicked')).toBeUndefined();
    expect(target.emitted('dragging')).toBeUndefined();
  });

  it('触摸拖动与鼠标走同一条换算链路', /** 只支持鼠标会让移动端无法移动元素。 */ async () => {
    const target = mountResize();
    await nextTick();

    target.element.dispatchEvent(touchEvent('touchstart', 0, 0));
    document.documentElement.dispatchEvent(touchEvent('touchmove', 60, 40));
    await nextTick();
    document.documentElement.dispatchEvent(touchEvent('touchend', 60, 40));
    await nextTick();

    expect(rootStyle(target).left).toBe('60px');
    expect(rootStyle(target).top).toBe('40px');
  });

  it('缺少页面坐标的事件按 0 处理不抛错', /** 触摸抬起等事件没有坐标，未兜底会让拖动中断并报错。 */ async () => {
    const target = mountResize();
    await nextTick();
    await target.trigger('mousedown', { button: 0, pageX: 0, pageY: 0 });

    // 直接派发不带任何坐标信息的移动事件，组件必须安全处理。
    document.documentElement.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true }),
    );
    await nextTick();

    expect(target.emitted('dragging')).toHaveLength(1);
  });

  it('未开始拖动时松开鼠标不抛错', /** 空松开未兜底会让页面上的任意松开都触发计算。 */ async () => {
    const target = mountResize();
    await nextTick();

    fireOnDocument('mouseup', 0, 0);
    await nextTick();

    expect(target.emitted('dragstop')).toBeUndefined();
  });
});

describe('可调整尺寸容器控制点缩放', /** 缩放方向与边界决定元素尺寸是否可用。 */ () => {
  it('拖拽右下角同时放大宽高并抛出事件', /** 缩放方向反了会让元素越缩越小。 */ async () => {
    const target = mountResize({ isActive: true });
    await nextTick();

    await dragStick(target, 'br', { x: 50, y: 30 });

    expect(contentStyle(target).width).toBe(`${WIDTH + 50}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT + 30}px`);
    expect(target.emitted('resizing')).toHaveLength(2);
    expect(target.emitted('resizestop')).toHaveLength(1);
  });

  it('拖拽左上角按反方向缩小', /** 左上角方向算反会让元素反向缩放。 */ async () => {
    const target = mountResize({ isActive: true });
    await nextTick();

    await dragStick(target, 'tl', { x: 50, y: 30 });

    expect(contentStyle(target).width).toBe(`${WIDTH - 50}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT - 30}px`);
  });

  it('拖拽上边与左边控制点只改一个方向', /** 单边控制点同时改两个方向会破坏元素布局。 */ async () => {
    const target = mountResize({ isActive: true });
    await nextTick();

    await dragStick(target, 'tm', { x: 500, y: 30 });
    expect(contentStyle(target).width).toBe(`${WIDTH}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT - 30}px`);

    await dragStick(target, 'ml', { x: 20, y: 500 });
    expect(contentStyle(target).width).toBe(`${WIDTH - 20}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT - 30}px`);
  });

  it('缩到最小宽高时停止', /** 最小尺寸兜底缺失会把元素缩成一条线。 */ async () => {
    const target = mountResize({ isActive: true, minh: 60, minw: 80 });
    await nextTick();

    await dragStick(target, 'br', { x: -5000, y: -5000 });

    expect(contentStyle(target).width).toBe('80px');
    expect(contentStyle(target).height).toBe('60px');
  });

  it('父容器限制下放大到边界即停', /** 允许无限放大会让元素盖住整页。 */ async () => {
    const target = mountResize({
      isActive: true,
      minh: 50,
      minw: 50,
      parentLimitation: true,
    });
    await nextTick();

    await dragStick(target, 'br', { x: 5000, y: 5000 });

    // 开启父容器限制后对边最小为 0，元素最多铺满父容器。
    expect(contentStyle(target).width).toBe(`${PARENT_W}px`);
    expect(contentStyle(target).height).toBe(`${PARENT_H}px`);
  });

  it('未开启父容器限制时可以放大到超出父容器', /** 关闭限制后组件按位移原样放大，业务方需自行兜底。 */ async () => {
    const target = mountResize({ isActive: true, minh: 50, minw: 50 });
    await nextTick();

    await dragStick(target, 'br', { x: 1000, y: 0 });

    expect(contentStyle(target).width).toBe(`${WIDTH + 1000}px`);
  });

  it('未激活时控制点不能拖动', /** 未激活仍能缩放会让多个元素互相干扰。 */ async () => {
    const target = mountResize();
    await nextTick();

    await dragStick(target, 'br', { x: 50, y: 50 });

    expect(contentStyle(target).width).toBe(`${WIDTH}px`);
    expect(target.emitted('resizing')).toBeUndefined();
  });

  it('关闭缩放时控制点不能拖动', /** 只读元素被缩放会破坏外部数据。 */ async () => {
    const target = mountResize({ isActive: true, isResizable: false });
    await nextTick();

    await dragStick(target, 'br', { x: 50, y: 50 });

    expect(contentStyle(target).width).toBe(`${WIDTH}px`);
  });

  it('网格吸附把缩放结果对齐到网格', /** 缩放不吸附会让元素尺寸永远对不齐网格。 */ async () => {
    const target = mountResize({
      gridX: 50,
      gridY: 50,
      isActive: true,
      snapToGrid: true,
    });
    await nextTick();

    await dragStick(target, 'br', { x: 60, y: 60 });

    // 右边与下边位移 60 后按网格吸附到 50 的整数倍。
    expect(contentStyle(target).width).toBe('250px');
    expect(contentStyle(target).height).toBe('250px');
  });

  it('比例锁定时按左边与上边基准换算', /** 左边与上边的换算基准错会让裁剪框跳到容器外。 */ async () => {
    const target = mountResize({
      aspectRatio: true,
      isActive: true,
      minh: 50,
      minw: 50,
      y: 50,
    });
    await nextTick();

    // 竖直方向收缩更多时按新的高度反推宽度，并以右边界为基准重算左边。
    await dragStick(target, 'tl', { x: 20, y: 100 });

    expect(contentStyle(target).width).toBe('100px');
    expect(contentStyle(target).height).toBe('100px');
    expect(rootStyle(target).left).toBe('100px');
  });

  it('比例锁定时以上边为基准重算高度', /** 上边界换算缺失会让裁剪框跳出容器顶部。 */ async () => {
    const target = mountResize({
      aspectRatio: true,
      isActive: true,
      minh: 50,
      minw: 50,
      y: 50,
    });
    await nextTick();

    // 水平方向收缩更多时按新的宽度反推高度，并以下边界为基准重算上边。
    await dragStick(target, 'tl', { x: 100, y: 20 });

    expect(contentStyle(target).width).toBe('100px');
    expect(contentStyle(target).height).toBe('100px');
    expect(rootStyle(target).top).toBe('150px');
  });

  it('网格吸附同时作用在上边与左边', /** 只吸附右下角会让左上角拖动大幅抖动。 */ async () => {
    const target = mountResize({
      gridX: 50,
      gridY: 50,
      isActive: true,
      snapToGrid: true,
    });
    await nextTick();

    await dragStick(target, 'tl', { x: -60, y: -60 });

    expect(contentStyle(target).width).toBe('250px');
    expect(contentStyle(target).height).toBe('250px');
  });

  it('父容器限制下控制点不能超出边界', /** 控制点越界会让元素被拉到父容器外。 */ async () => {
    const target = mountResize({ isActive: true, parentLimitation: true });
    await nextTick();

    await dragStick(target, 'tl', { x: 5000, y: 5000 });

    expect(contentStyle(target).width).toBe('50px');
    expect(contentStyle(target).height).toBe('50px');
  });

  it('比例锁定时拖拽右边中点按宽度换算并上下对称扩张', /** 比例锁失效会让元素变形或偏移。 */ async () => {
    const target = mountResize({
      aspectRatio: true,
      isActive: true,
      minh: 50,
      minw: 50,
      y: 50,
    });
    await nextTick();

    await dragStick(target, 'mr', { x: 100, y: 0 });

    // 宽度增加 100 后高度同步增加 100，围绕原中心上下对称扩张。
    expect(contentStyle(target).width).toBe('300px');
    expect(contentStyle(target).height).toBe('300px');
    expect(rootStyle(target).top).toBe('0px');
  });

  it('比例锁定时拖拽下边中点按高度换算并左右对称收缩', /** 竖直方向的比例换算错会让元素比例失真。 */ async () => {
    const target = mountResize({
      aspectRatio: true,
      isActive: true,
      minh: 50,
      minw: 50,
      y: 50,
    });
    await nextTick();

    await dragStick(target, 'bm', { x: 0, y: -100 });

    expect(contentStyle(target).width).toBe('100px');
    expect(contentStyle(target).height).toBe('100px');
    expect(rootStyle(target).left).toBe('50px');
  });

  it('比例锁定时拖拽角点按较大位移换算', /** 角点换算方向选错会让拖拽不跟手。 */ async () => {
    const target = mountResize({
      aspectRatio: true,
      isActive: true,
      minh: 50,
      minw: 50,
    });
    await nextTick();

    await dragStick(target, 'br', { x: 100, y: 100 });

    expect(contentStyle(target).width).toBe('300px');
    expect(contentStyle(target).height).toBe('300px');
  });

  it('比例锁定时最小尺寸互相推导（宽度主导）', /** 最小宽高与比例不一致会让元素一拖就跳到最小值。 */ async () => {
    const target = mountResize({
      aspectRatio: true,
      isActive: true,
      minh: 50,
      minw: 120,
    });
    await nextTick();

    await dragStick(target, 'br', { x: -5000, y: -5000 });

    // 比例修正以未被改写的最小高度为准，最终收敛到 50 的正方形。
    expect(contentStyle(target).width).toBe('50px');
    expect(contentStyle(target).height).toBe('50px');
  });

  it('比例锁定时最小尺寸互相推导（高度主导）', /** 另一种最小尺寸组合同样需要正确推导。 */ async () => {
    const target = mountResize({
      aspectRatio: true,
      isActive: true,
      minh: 150,
      minw: 50,
    });
    await nextTick();

    await dragStick(target, 'br', { x: -5000, y: -5000 });

    expect(contentStyle(target).width).toBe('50px');
    expect(contentStyle(target).height).toBe('50px');
  });

  it('触摸拖动控制点与鼠标走同一条换算链路', /** 只支持鼠标会让移动端无法调整尺寸。 */ async () => {
    const target = mountResize({ isActive: true });
    await nextTick();
    const stick = target.find('.resize-stick-br').element;

    stick.dispatchEvent(touchEvent('touchstart', 0, 0));
    document.documentElement.dispatchEvent(touchEvent('touchmove', 40, 20));
    await nextTick();
    document.documentElement.dispatchEvent(touchEvent('touchend', 40, 20));
    await nextTick();

    expect(contentStyle(target).width).toBe(`${WIDTH + 40}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT + 20}px`);
  });
});

describe('可调整尺寸容器程序化更新', /** 外部改属性时必须重算，保证数据与界面一致。 */ () => {
  it('改动 x 时整体平移', /** 外部改坐标不生效会让保存的布局下次打开就丢。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.setProps({ x: 40 });
    await nextTick();

    expect(rootStyle(target).left).toBe('40px');
    expect(target.emitted('dragging')).toHaveLength(2);
    expect(target.emitted('dragstop')).toHaveLength(1);
  });

  it('改动 y 时整体平移', /** 外部改纵坐标不生效会让元素停在旧位置。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.setProps({ y: 60 });
    await nextTick();

    expect(rootStyle(target).top).toBe('60px');
    expect(target.emitted('dragstop')).toHaveLength(1);
  });

  it('坐标未变化时不做任何计算', /** 无变化仍触发事件会让外部监听器收到噪声。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.setProps({ x: 0, y: 0 });
    await nextTick();

    expect(target.emitted('dragging')).toBeUndefined();
  });

  it('改动 w 时按右边界缩放', /** 外部改宽度不生效会让内容被裁切。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.setProps({ w: 300 });
    await nextTick();

    expect(contentStyle(target).width).toBe('300px');
    expect(target.emitted('resizestop')).toHaveLength(1);
  });

  it('改动 h 时按下边界缩放', /** 外部改高度不生效会让内容被裁切。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.setProps({ h: 320 });
    await nextTick();

    expect(contentStyle(target).height).toBe('320px');
  });

  it('宽高未变化时不做任何计算', /** 无变化仍缩放会让元素莫名抖动。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.setProps({ h: HEIGHT, w: WIDTH });
    await nextTick();

    expect(target.emitted('resizestop')).toBeUndefined();
  });

  it('改动父容器宽高时保持内容尺寸不变', /** 父容器变化未重算会让内容尺寸跟着变。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.setProps({ parentH: 500, parentW: 800 });
    await nextTick();

    expect(contentStyle(target).width).toBe(`${WIDTH}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT}px`);
    expect(rootStyle(target).left).toBe('0px');
  });

  it('拖动过程中外部改动被忽略', /** 拖动中被外部改值会让元素突然跳位。 */ async () => {
    const target = mountResize();
    await nextTick();

    await target.trigger('mousedown', { button: 0, pageX: 0, pageY: 0 });
    await target.setProps({ x: 200, y: 200 });
    await nextTick();

    expect(rootStyle(target).left).toBe('0px');
  });

  it('缩放过程中外部改动宽高被忽略', /** 缩放中被外部改值会让元素尺寸突然跳变。 */ async () => {
    const target = mountResize({ isActive: true });
    await nextTick();

    await target
      .find('.resize-stick-br')
      .trigger('mousedown', { button: 0, pageX: 0, pageY: 0 });
    await target.setProps({ h: 500, w: 500 });
    await nextTick();

    expect(contentStyle(target).width).toBe(`${WIDTH}px`);
    expect(contentStyle(target).height).toBe(`${HEIGHT}px`);
  });
});

describe('可调整尺寸容器手柄与卸载', /** 手柄过滤与监听解绑决定组件能否安全复用。 */ () => {
  it('配置拖拽手柄后仅手柄可拖动', /** 手柄过滤必须能取到本组件实例标识，取不到会让手柄与内容区一起失效。 */ async () => {
    const target = mount(Resize, {
      props: {
        dragHandle: '.DUMMY-handle',
        parentH: PARENT_H,
        parentW: PARENT_W,
      },
      slots: {
        default: '<i class="DUMMY-content"></i><i class="DUMMY-handle"></i>',
      },
    });
    wrapper = target;
    await nextTick();

    // 命中 dragHandle 选择器的元素带本实例标记，从这里按下才开始拖动。
    const handle = target.find('.DUMMY-handle').element;
    handle.dispatchEvent(mouseEvent('mousedown', 0, 0));
    fireOnDocument('mousemove', 40, 0);
    await nextTick();

    expect(rootStyle(target).left).toBe('40px');

    fireOnDocument('mouseup', 40, 0);
    await nextTick();
    // 内容区没有手柄标记，不属于可拖动起点，按下后位置保持不变。
    await target.find('.DUMMY-content').trigger('mousedown', {
      button: 0,
      pageX: 0,
      pageY: 0,
    });
    fireOnDocument('mousemove', 300, 0);
    await nextTick();

    expect(rootStyle(target).left).toBe('40px');
  });

  it('配置取消区后取消区按下不拖动', /** 取消标记必须能取到本组件实例标识，取不到会让取消区被拖走。 */ async () => {
    const target = mount(Resize, {
      props: {
        dragCancel: '.DUMMY-cancel',
        parentH: PARENT_H,
        parentW: PARENT_W,
      },
      slots: { default: '<i class="DUMMY-cancel"></i>' },
    });
    wrapper = target;
    await nextTick();

    await target.find('.DUMMY-cancel').trigger('mousedown', {
      button: 0,
      pageX: 0,
      pageY: 0,
    });
    fireOnDocument('mousemove', 60, 0);
    await nextTick();

    expect(rootStyle(target).left).toBe('0px');
  });

  it('关闭拖动后按下不改变位置', /** 拖动开关失效会让只读元素被移动。 */ async () => {
    const target = mountResize({ isDraggable: false });
    await nextTick();

    await dragBody(target, { x: 0, y: 0 }, { x: 100, y: 100 });

    expect(rootStyle(target).left).toBe('0px');
    expect(rootStyle(target).top).toBe('0px');
  });

  it('卸载时解绑文档上的拖动监听', /** 卸载未解绑会让已移除的元素继续响应鼠标。 */ async () => {
    const target = mountResize();
    await nextTick();
    const removeListener = vi.spyOn(
      document.documentElement,
      'removeEventListener',
    );

    target.unmount();
    wrapper = undefined;

    expect(removeListener).toHaveBeenCalledWith(
      'mousemove',
      expect.any(Function),
    );
    expect(removeListener).toHaveBeenCalledWith(
      'mouseup',
      expect.any(Function),
    );
  });

  it('全量传入属性以覆盖取值校验', /** 属性校验缺失会让非法取值直接进入换算逻辑。 */ async () => {
    const target = mountResize({
      contentClass: 'DUMMY-内容类',
      gridX: 10,
      gridY: 20,
      h: 120,
      minh: 40,
      minw: 40,
      parentScaleX: 2,
      parentScaleY: 2,
      stickSize: 10,
      sticks: ['br'],
      w: 150,
      x: 10,
      y: 10,
      z: 3,
    });
    await nextTick();

    expect(target.classes()).toContain('DUMMY-内容类');
    expect(contentStyle(target).width).toBe('150px');
    expect(contentStyle(target).height).toBe('120px');
    expect(target.findAll('.resize-stick')).toHaveLength(1);
  });
});
