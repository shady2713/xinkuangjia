# Modal 组件使用模板

当前应用为 Element Plus。代码块展示组合片段；业务回调、数据类型和实际接口需按目标模块补齐，不能把示例名称当作已有实现。

## 模板用途
用于生成 CRUD 页面的 Modal 配置模板

## 必需的导入

```typescript
import { useVbenModal } from '@vben/common-ui';
```

## 1. 基础 Modal 模板

### 基础结构

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'Title',
  onConfirm: async () => {
    // 确认操作
    console.log('Confirmed');
  },
});
```

### 带内容的 Modal

```vue
<template>
  <Modal>
    <div class="p-4">
      <p>This is modal content</p>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { useVbenModal } from '@vben/common-ui';

const [Modal, modalApi] = useVbenModal({
  title: 'Notice',
  onConfirm: async () => {
    console.log('Confirm action');
  },
});
</script>
```

## 2. 组件分离模板

### 外部组件

```vue
<template>
  <Modal />
</template>

<script setup lang="ts">
import { useVbenModal } from '@vben/common-ui';
import ModalContent from './modal-content.vue';

const [Modal, modalApi] = useVbenModal({
  title: 'Edit',
  connectedComponent: ModalContent,
  onConfirm: async () => {
    const data = modalApi.getData();
    console.log('Submit data:', data);
  },
});

// 打开弹窗
const handleOpen = () => {
  modalApi.open();
};
</script>
```

### 内部组件（modal-content.vue）

```vue
<template>
  <div class="p-4">
    <ElInput v-model="formData.name" placeholder="Please enter name" />
  </div>
</template>

<script setup lang="ts">
import { ElInput } from 'element-plus';
import { useVbenModal } from '@vben/common-ui';
import { reactive } from 'vue';

const [Modal, modalApi] = useVbenModal({});

const formData = reactive({
  name: '',
});

// 设置共享数据
modalApi.setData(formData);
</script>
```

## 3. 常用配置模板

### 可拖拽 Modal

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'Draggable',
  draggable: true,
});
```

### 全屏 Modal

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'Fullscreen',
  fullscreen: true,
});
```

### 居中显示

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'Centered',
  centered: true,
});
```

### 自定义宽度

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'Custom Width',
  class: 'w-[800px]',
});
```

### 隐藏底部按钮

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'No Footer',
  footer: false,
});
```

### 自定义按钮文本

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'Custom Buttons',
  confirmText: 'Submit',
  cancelText: 'Back',
});
```

## 4. API 使用模板

### 打开/关闭 Modal

```typescript
// 打开
modalApi.open();

// 关闭
modalApi.close();
```

### 动态设置状态

```typescript
// 设置标题
modalApi.setState({
  title: 'New Title',
});

// 设置加载状态
modalApi.setState({
  loading: true,
});

// 禁用确认按钮
modalApi.setState({
  confirmDisabled: true,
});
```

### 数据共享

```typescript
// 设置数据
modalApi.setData({
  id: 1,
  name: 'John',
});

// 获取数据
const data = modalApi.getData();
console.log(data);
```

### 锁定/解锁

```typescript
// 锁定（提交中）
modalApi.lock(true);

// 解锁
modalApi.unlock();
```

## 5. 事件处理模板

### 完整事件示例

```typescript
const [Modal, modalApi] = useVbenModal({
  title: 'Event Example',

  // 打开/关闭状态变化
  onOpenChange: (isOpen) => {
    console.log('Modal state:', isOpen);
  },

  // 打开动画完成
  onOpened: () => {
    console.log('Opened');
  },

  // 关闭前确认
  onBeforeClose: async () => {
    const confirm = await showConfirm('Are you sure to close?');
    return confirm; // 返回 false 可阻止关闭
  },

  // 确认按钮
  onConfirm: async () => {
    try {
      modalApi.lock(true);
      await submitData();
      modalApi.close();
    } finally {
      modalApi.unlock();
    }
  },

  // 取消按钮
  onCancel: () => {
    console.log('Cancelled');
  },

  // 关闭动画完成
  onClosed: () => {
    console.log('Closed');
  },
});
```

## 6. 插槽使用模板

### 自定义底部按钮

```vue
<template>
  <Modal>
    <div class="p-4">
      <p>Content area</p>
    </div>

    <template #prepend-footer>
      <ElButton>Extra Button</ElButton>
    </template>

    <template #append-footer>
      <ElButton link>Help</ElButton>
    </template>
  </Modal>
</template>
```

### 完全自定义底部

```vue
<template>
  <Modal>
    <div class="p-4">
      <p>Content area</p>
    </div>

    <template #footer>
      <div class="flex justify-between">
        <ElButton @click="handleReset">Reset</ElButton>
        <div>
          <ElButton @click="modalApi.close()">Cancel</ElButton>
          <ElButton type="primary" @click="handleSubmit">Submit</ElButton>
        </div>
      </div>
    </template>
  </Modal>
</template>
```

## 7. 完整示例

### 编辑用户 Modal

```vue
<template>
  <div>
    <ElButton type="primary" @click="handleEdit">Edit User</ElButton>
    <Modal />
  </div>
</template>

<script setup lang="ts">
import { ElButton } from 'element-plus';
import { useVbenModal } from '@vben/common-ui';
import { reactive } from 'vue';
import UserForm from './user-form.vue';

const [Modal, modalApi] = useVbenModal({
  title: 'Edit User',
  class: 'w-[600px]',
  connectedComponent: UserForm,

  onOpenChange: (isOpen) => {
    if (isOpen) {
      // 打开时加载数据
      loadUserData();
    }
  },

  onConfirm: async () => {
    try {
      modalApi.lock(true);
      const formData = modalApi.getData();
      await updateUser(formData);
      message.success('Saved successfully');
      modalApi.close();
    } catch (error) {
      message.error('Save failed');
    } finally {
      modalApi.unlock();
    }
  },
});

const handleEdit = () => {
  modalApi.open();
};

const loadUserData = async () => {
  modalApi.setState({ loading: true });
  try {
    const data = await fetchUser(1);
    modalApi.setData(data);
  } finally {
    modalApi.setState({ loading: false });
  }
};
</script>
```
