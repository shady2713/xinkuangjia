# Drawer 组件使用模板

当前应用为 Element Plus。代码块展示组合片段；业务回调、数据类型和实际接口需按目标模块补齐，不能把示例名称当作已有实现。

## 模板用途
用于生成 CRUD 页面的 Drawer 配置模板

## 必需的导入

```typescript
import { useVbenDrawer } from '@vben/common-ui';
```

## 1. 基础 Drawer 模板

### 基础结构

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Title',
  onConfirm: async () => {
    // 确认操作
    console.log('Confirmed');
  },
});
```

### 带内容的 Drawer

```vue
<template>
  <Drawer>
    <div class="p-4">
      <p>This is drawer content</p>
    </div>
  </Drawer>
</template>

<script setup lang="ts">
import { useVbenDrawer } from '@vben/common-ui';

const [Drawer, drawerApi] = useVbenDrawer({
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
  <Drawer />
</template>

<script setup lang="ts">
import { useVbenDrawer } from '@vben/common-ui';
import DrawerContent from './drawer-content.vue';

const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Edit',
  connectedComponent: DrawerContent,
  onConfirm: async () => {
    const data = drawerApi.getData();
    console.log('Submit data:', data);
  },
});

// 打开抽屉
const handleOpen = () => {
  drawerApi.open();
};
</script>
```

### 内部组件（drawer-content.vue）

```vue
<template>
  <div class="p-4">
    <ElInput v-model="formData.name" placeholder="Please enter name" />
  </div>
</template>

<script setup lang="ts">
import { ElInput } from 'element-plus';
import { useVbenDrawer } from '@vben/common-ui';
import { reactive } from 'vue';

const [Drawer, drawerApi] = useVbenDrawer({});

const formData = reactive({
  name: '',
});

// 设置共享数据
drawerApi.setData(formData);
</script>
```

## 3. 常用配置模板

### 左侧弹出

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Left Drawer',
  placement: 'left',
});
```

### 顶部弹出

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Top Drawer',
  placement: 'top',
});
```

### 底部弹出

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Bottom Drawer',
  placement: 'bottom',
});
```

### 自定义宽度

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Custom Width',
  class: 'w-[800px]',
});
```

### 隐藏底部按钮

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'No Footer',
  footer: false,
});
```

### 自定义按钮文本

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Custom Buttons',
  confirmText: 'Submit',
  cancelText: 'Back',
});
```

## 4. API 使用模板

### 打开/关闭 Drawer

```typescript
// 打开
drawerApi.open();

// 关闭
drawerApi.close();
```

### 动态设置状态

```typescript
// 设置标题
drawerApi.setState({
  title: 'New Title',
});

// 设置加载状态
drawerApi.setState({
  loading: true,
});

// 禁用确认按钮
drawerApi.setState({
  confirmDisabled: true,
});
```

### 数据共享

```typescript
// 设置数据
drawerApi.setData({
  id: 1,
  name: 'John',
});

// 获取数据
const data = drawerApi.getData();
console.log(data);
```

### 锁定/解锁

```typescript
// 锁定（提交中）
drawerApi.lock(true);

// 解锁
drawerApi.unlock();
```

## 5. 事件处理模板

### 完整事件示例

```typescript
const [Drawer, drawerApi] = useVbenDrawer({
  title: 'Event Example',

  // 打开/关闭状态变化
  onOpenChange: (isOpen) => {
    console.log('Drawer state:', isOpen);
  },

  // 打开动画完成
  onOpened: () => {
    console.log('Opened');
  },

  // 关闭前确认
  onBeforeClose: () => {
    const confirm = window.confirm('Are you sure to close?');
    return confirm; // 返回 false 可阻止关闭
  },

  // 确认按钮
  onConfirm: async () => {
    try {
      drawerApi.lock(true);
      await submitData();
      drawerApi.close();
    } finally {
      drawerApi.unlock();
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
  <Drawer>
    <div class="p-4">
      <p>Content area</p>
    </div>

    <template #prepend-footer>
      <ElButton>Extra Button</ElButton>
    </template>

    <template #append-footer>
      <ElButton link>Help</ElButton>
    </template>
  </Drawer>
</template>
```

### 完全自定义底部

```vue
<template>
  <Drawer>
    <div class="p-4">
      <p>Content area</p>
    </div>

    <template #footer>
      <div class="flex justify-between">
        <ElButton @click="handleReset">Reset</ElButton>
        <div>
          <ElButton @click="drawerApi.close()">Cancel</ElButton>
          <ElButton type="primary" @click="handleSubmit">Submit</ElButton>
        </div>
      </div>
    </template>
  </Drawer>
</template>
```

### 自定义关闭图标

```vue
<template>
  <Drawer>
    <div class="p-4">
      <p>Content area</p>
    </div>

    <template #close-icon>
      <CloseCircleOutlined />
    </template>
  </Drawer>
</template>
```

### 标题右侧的额外内容

```vue
<template>
  <Drawer>
    <div class="p-4">
      <p>Content area</p>
    </div>

    <template #extra>
      <ElButton link>More Actions</ElButton>
    </template>
  </Drawer>
</template>
```

## 7. 完整示例

### 编辑用户 Drawer

```vue
<template>
  <div>
    <ElButton type="primary" @click="handleEdit">Edit User</ElButton>
    <Drawer />
  </div>
</template>

<script setup lang="ts">
import { ElButton } from 'element-plus';
import { useVbenDrawer } from '@vben/common-ui';
import { reactive } from 'vue';
import UserForm from './user-form.vue';

const [Drawer, drawerApi] = useVbenDrawer({
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
      drawerApi.lock(true);
      const formData = drawerApi.getData();
      await updateUser(formData);
      message.success('Saved successfully');
      drawerApi.close();
    } catch (error) {
      message.error('Save failed');
    } finally {
      drawerApi.unlock();
    }
  },
});

const handleEdit = () => {
  drawerApi.open();
};

const loadUserData = async () => {
  drawerApi.setState({ loading: true });
  try {
    const data = await fetchUser(1);
    drawerApi.setData(data);
  } finally {
    drawerApi.setState({ loading: false });
  }
};
</script>
```
