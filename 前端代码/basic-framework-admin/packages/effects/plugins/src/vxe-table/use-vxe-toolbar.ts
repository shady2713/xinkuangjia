/**
 * 原生表格工具栏绑定：返回工具栏与表格的模板 ref、搜索栏显隐状态，
 * 并在表格挂载后延迟把 toolbar 连到表格实例，重复触发由 isBound 拦截。
 * 只做连接，不加载数据，刷新动作由工具栏按钮自身触发。
 */
import type { VxeTableInstance, VxeToolbarInstance } from 'vxe-table';

import { ref, watch } from 'vue';

import VbenVxeTableToolbar from './table-toolbar.vue';

/**
 * vxe 原生工具栏挂载封装
 * 解决每个组件使用 vxe-table 组件时都需要写一遍的问题
 * @returns hiddenSearchBar 搜索栏显隐状态，tableToolbarRef 工具栏组件引用，tableRef 表格实例引用。
 */
export function useTableToolbar() {
  const hiddenSearchBar = ref(false); // 隐藏搜索栏
  const tableToolbarRef = ref<InstanceType<typeof VbenVxeTableToolbar>>();
  const tableRef = ref<VxeTableInstance>();
  const isBound = ref<boolean>(false);

  /** 挂载 toolbar 工具栏 */
  async function bindTableToolbar() {
    const table = tableRef.value;
    const tableToolbar = tableToolbarRef.value;
    if (table && tableToolbar) {
      // 延迟 1 秒，确保 toolbar 组件已经挂载
      setTimeout(async () => {
        const toolbar = tableToolbar.getToolbarRef();
        if (!toolbar) {
          console.error('[toolbar 挂载失败] Table toolbar not found');
        }
        await table.connectToolbar(toolbar as VxeToolbarInstance);
        isBound.value = true;
      }, 1000); // 延迟挂载确保 toolbar 正确挂载
    }
  }

  watch(
    () => tableRef.value,
    async (val) => {
      if (!val || isBound.value) return;
      await bindTableToolbar();
    },
    { immediate: true },
  );

  return {
    hiddenSearchBar,
    tableToolbarRef,
    tableRef,
  };
}
