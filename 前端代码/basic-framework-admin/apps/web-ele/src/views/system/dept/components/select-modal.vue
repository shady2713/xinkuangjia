<script lang="ts" setup>
// 说明：当前实现已按本项目的 web-ele 结构整理。
import type { SystemDeptApi } from '#/api/system/dept';

import { nextTick, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { handleTree } from '@vben/utils';

import { ElCard, ElCol, ElRow, ElTree } from 'element-plus';

import { getSimpleDeptList } from '#/api/system/dept';

defineOptions({ name: 'DeptSelectModal' });

const props = withDefaults(
  defineProps<{
    // 取消按钮文本
    cancelText?: string;
    // checkable 状态下节点选择完全受控
    checkStrictly?: boolean;
    // 确认按钮文本
    confirmText?: string;
    // 是否支持多选
    multiple?: boolean;
    // 标题
    title?: string;
  }>(),
  {
    cancelText: '取消',
    checkStrictly: false,
    confirmText: '确认',
    multiple: true,
    title: '部门选择',
  },
);

const emit = defineEmits<{
  confirm: [deptList: SystemDeptApi.Dept[]];
}>();

// 部门树形结构；由 handleTree 在扁平部门列表上重组而来，节点形状与部门一致
const deptTree = ref<SystemDeptApi.Dept[]>([]);
// 选中的部门 ID 列表
const selectedDeptIds = ref<number[]>([]);
// 部门数据
const deptData = ref<SystemDeptApi.Dept[]>([]);
// Tree 组件引用
const treeRef = ref();

// 对话框配置
const [Modal, modalApi] = useVbenModal({
  /**
   * 确认选择：按勾选口径取出部门主键，映射回部门对象后向上抛出并关闭弹窗。
   * @returns 关闭弹窗的 Promise。
   */
  async onConfirm() {
    // 获取选中的部门ID
    const selectedIds: number[] = props.checkStrictly
      ? treeRef.value?.getCheckedKeys() || []
      : selectedDeptIds.value;

    // 缺少 id 的部门无法被勾选命中，天然排除，无需当作合法 id 参与匹配
    const deptArray = deptData.value.filter(
      /**
       * 只保留主键存在且被勾选的部门。
       * @param dept 待判定的部门。
       * @returns 该部门需要被选中时返回 true。
       */
      (dept) => dept.id !== undefined && selectedIds.includes(dept.id),
    );
    emit('confirm', deptArray);
    // 关闭并提示
    await modalApi.close();
  },
  /**
   * 弹窗开合时加载或清空部门树。
   * 打开时先取回调用方传入的待勾选部门，加载完成后回填勾选状态；
   * 关闭时清空本地状态，避免下次打开残留上一次的勾选。
   * @param isOpen 弹窗当前是否处于打开状态
   */
  async onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      deptTree.value = [];
      selectedDeptIds.value = [];
      return;
    }
    // 加载数据；调用方通过 setData 传入待勾选的部门列表
    const data = modalApi.getData<{ selectedList?: SystemDeptApi.Dept[] }>();
    if (!data) {
      return;
    }
    modalApi.lock();
    try {
      deptData.value = await getSimpleDeptList();
      deptTree.value = handleTree(deptData.value);
      // 等待 DOM 更新后再设置选中的节点
      await nextTick();
      // 设置已选择的部门
      if (data.selectedList?.length) {
        // Dept.id 为可选字段；setCheckedKeys 只接受真实主键，未落库的部门天然无法被勾选命中。
        /**
         * 剔除主键缺失的部门。
         * @param id 部门主键，可能为 undefined。
         * @returns 该主键有效时为 true。
         */
        const isValidDeptId = (id: number | undefined): id is number =>
          id !== undefined;

        /**
         * 回显已选部门：只把主键有效的部门交给树组件，未落库的部门无法被 setCheckedKeys 命中。
         */
        const selectedIds = data.selectedList
          .map((dept: SystemDeptApi.Dept) => dept.id)
          .filter(
            /**
             * 过滤时顺带收窄类型，避免 setCheckedKeys 收到 number | undefined。
             * @param id 部门主键，可能为 undefined。
             * @returns 该主键有效时为 true。
             */
            (id): id is number => isValidDeptId(id),
          );
        selectedDeptIds.value = selectedIds;
        treeRef.value.setCheckedKeys(selectedIds);
      }
    } finally {
      modalApi.unlock();
    }
  },
  destroyOnClose: true,
});

/**
 * 处理勾选状态变化：把 ElTree 回传的 key 统一成数字 ID 并同步到本地状态。
 * 单选模式下只保留最后一个节点，并让 ElTree 收敛到同一选择。
 * @param _data 触发勾选的节点数据，本组件不依赖。
 * @param context ElTree 的勾选上下文，取其中的 checkedKeys。
 * @param context.checkedKeys 当前所有勾选节点的 key。
 */
function handleCheck(
  _data: unknown,
  { checkedKeys }: { checkedKeys: (number | string)[] },
) {
  // 确保 checkedKeys 都是 number 类型
  const keys = checkedKeys.map((key) =>
    typeof key === 'string' ? Number(key) : key,
  );

  if (props.multiple) {
    selectedDeptIds.value = keys;
  } else {
    // 单选模式下，只保留最后选择的节点
    const lastSelectedId = keys[keys.length - 1];
    if (lastSelectedId) {
      selectedDeptIds.value = [lastSelectedId];
      treeRef.value?.setCheckedKeys([lastSelectedId]);
    }
  }
}
</script>
<template>
  <Modal :title="title" key="dept-select-modal" class="w-3/5">
    <ElRow class="h-full">
      <ElCol :span="24">
        <ElCard class="h-full">
          <ElTree
            v-if="deptTree.length > 0"
            ref="treeRef"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            :check-strictly="checkStrictly"
            :default-expand-all="true"
            show-checkbox
            check-on-click-node
            node-key="id"
            @check="handleCheck"
          />
        </ElCard>
      </ElCol>
    </ElRow>
  </Modal>
</template>
