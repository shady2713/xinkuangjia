# Page 组件模板使用

当前应用为 Element Plus。代码块展示组合片段；业务回调、数据类型和实际接口需按目标模块补齐，不能把示例名称当作已有实现。

## 模板用途
生成 CRUD 页面时 Page 组件的基础结构

## 基础结构
```vue
<template>
  <Page title="页面标题" description="页面说明">
    <template #extra>
      <!-- 头部右侧操作按钮 -->
      <ElButton type="primary" @click="handleAdd">
        <Plus />
        Add
      </ElButton>
    </template>

    <!-- 主内容区域 -->
    <div class="content-wrapper">
      <!-- 业务内容 -->
    </div>

    <template #footer>
      <!-- 底部内容（可选） -->
    </template>
  </Page>
</template>

<script setup lang="ts">
import { ElButton } from 'element-plus';
import { Page } from '@vben/common-ui';
import { Plus } from '@vben/icons';

/** 打开当前业务的新增入口，生成时替换为真实表单调用。 */
const handleAdd = () => {
  // 新增操作
};
</script>
```

## 必需导入
```typescript
import { Page } from '@vben/common-ui';
import { Download, Plus, RefreshCw } from '@vben/icons';
import { ElButton } from 'element-plus';
```

## 使用规则
1. **标题与描述**：通过 `title` 和 `description` 属性传入
2. **操作按钮**：放在 `extra` 插槽中
3. **主内容**：放在默认插槽中
4. **底部内容**：可选，使用 `footer` 插槽

## 常见操作按钮

```vue
<!-- 新增按钮 -->
<ElButton type="primary" @click="handleAdd">
  <Plus />
  Add
</ElButton>

<!-- 导出按钮 -->
<ElButton @click="handleExport">
  <Download />
  Export
</ElButton>

<!-- 刷新按钮 -->
<ElButton @click="handleRefresh">
  <RefreshCw />
  Refresh
</ElButton>
```