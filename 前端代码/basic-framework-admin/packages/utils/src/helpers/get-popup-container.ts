/**
 * 弹层挂载容器解析：getPopupContainer 让弹层优先挂到最近的 form，其次父节点，最后 body；
 * getVxePopupContainer 让表格内弹层挂到 vxe-table 的滚动区，一个页面有多个表格时必须传表格 id。
 * 只负责挑选并返回 DOM 容器，弹层创建、定位与销毁由调用方组件完成。
 */
/**
 * 解析弹层的挂载容器：节点在表单内时返回该表单，否则返回其父节点，未传节点时返回 body。
 *
 * @param node 触发弹层的元素；省略时直接落到 body
 * @returns 弹层应当挂载的容器元素，保证始终返回一个真实节点
 */
export function getPopupContainer(node?: HTMLElement): HTMLElement {
  return (
    node?.closest('form') ?? (node?.parentNode as HTMLElement) ?? document.body
  );
}

// TODO @xingyu：这个后续再评估是否需要沉淀为通用能力。
/**
 * VxeTable 专用弹窗层
 * 解决表格内弹窗挂载容器不正确的问题
 * 单表格用法跟上面getPopupContainer一样
 * 一个页面(body下)有多个表格元素 必须先指定ID & ID参数传入该函数
 * <BasicTable id="xxx" />
 * getVxePopupContainer="(node) => getVxePopupContainer(node, 'xxx')"
 * @param _node 触发的元素
 * @param id 表格唯一id 当页面(该窗口)有>=两个表格 必须提供ID
 * @returns 挂载节点
 */
export function getVxePopupContainer(
  _node?: HTMLElement,
  id?: string,
): HTMLElement {
  let selector = 'div.vxe-table--body-wrapper.body--wrapper';
  if (id) {
    selector = `div#${id} ${selector}`;
  }
  // 挂载到vxe-table的滚动区域
  const vxeTableContainerNode = document.querySelector(selector);
  if (!vxeTableContainerNode) {
    console.warn('无法找到vxe-table元素, 将会挂载到body.');
    return document.body;
  }
  return vxeTableContainerNode as HTMLElement;
}
