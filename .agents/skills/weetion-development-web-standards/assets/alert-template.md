# Alert 使用示例模板

## 模板用途
用于生成警告、确认和输入对话框。当前管理应用使用 Element Plus；下列自定义内容组件采用其 `modelValue` / `update:modelValue` 契约，实际 API 以 `packages/@core/ui-kit/popup-ui/src/alert` 为准。

## 1. 基础 Alert

```typescript
import { alert } from '@vben/common-ui';

// 简单消息
alert('This is an alert message');

// 带标题
await alert('This is the message content', 'Alert Title');

// 带选项
await alert('This is the message content', 'Alert Title', {
  centered: true,
  confirmText: 'OK',
});
```

## 2. 自定义内容的 Alert

```typescript
import { h } from 'vue';
import { alert } from '@vben/common-ui';
import { ElResult } from 'element-plus';

alert({
  buttonAlign: 'center',
  content: h(ElResult, {
    icon: 'success',
    subTitle: 'Order created successfully. Order ID: 2017182818828182881',
    title: 'Operation Successful',
  }),
});
```

## 3. 不同图标的 Alert

```typescript
import { alert } from '@vben/common-ui';

// 成功图标
await alert('Operation completed successfully!', 'Success', {
  icon: 'success',
});

// 错误图标
await alert('An error occurred!', 'Error', {
  icon: 'error',
});

// 警告图标
await alert('Please be careful!', 'Warning', {
  icon: 'warning',
});

// 信息图标
await alert('Here is some information', 'Info', {
  icon: 'info',
});

// 疑问图标
await alert('Do you understand?', 'Question', {
  icon: 'question',
});
```

## 4. 基础确认对话框

```typescript
import { confirm, alert } from '@vben/common-ui';

// 简单确认
confirm('This is an alert message')
  .then(() => {
    alert('Confirmed');
  })
  .catch(() => {
    alert('Canceled');
  });

// 带标题和选项
try {
  await confirm('Are you sure you want to delete this item?', 'Confirm Delete', {
    confirmText: 'Delete',
    cancelText: 'Cancel',
    icon: 'warning',
  });
  console.log('User confirmed');
} catch {
  console.log('User cancelled');
}
```

## 5. 自定义底部的确认框

```typescript
import { h, ref } from 'vue';
import { confirm } from '@vben/common-ui';
import { ElCheckbox, ElMessage } from 'element-plus';

const checked = ref(false);

confirm({
  cancelText: 'No',
  confirmText: 'Yes',
  content:
    'Have you ever experienced something that feels like you\'ve been through it before?\nYou can even subconsciously predict what will happen next.\n\nSounds mysterious, have you ever felt this way?',
  footer: () =>
    h(
      ElCheckbox,
      {
        modelValue: checked.value,
        class: 'flex-1',
        // 同步复选框值，确认后再决定是否关闭后续提示。
        'onUpdate:modelValue': (value: boolean) => (checked.value = value),
      },
      'Do not show again',
    ),
  icon: 'question',
  title: 'Mystery',
}).then(() => {
  if (checked.value) {
    ElMessage.success('I won\'t bother you with this question again');
  } else {
    ElMessage.info('I will ask you again next time');
  }
});
```

## 6. 带 beforeClose 的异步确认框

```typescript
import { confirm, alert } from '@vben/common-ui';

confirm({
  beforeClose({ isConfirm }) {
    if (isConfirm) {
      // 此处可执行一些异步操作，返回 false 则对话框不会关闭
      return new Promise((resolve) => setTimeout(resolve, 2000));
    }
  },
  content: 'This is an alert message with async confirm',
  icon: 'success',
  contentMasking: true, // beforeClose 期间显示加载遮罩
}).then(() => {
  alert('Confirmed');
});
```

## 7. 自定义按钮对齐方式

```typescript
import { confirm } from '@vben/common-ui';

// 居中对齐
await confirm('Are you sure?', 'Confirm', {
  buttonAlign: 'center',
});

// 末端对齐（右侧）
await confirm('Are you sure?', 'Confirm', {
  buttonAlign: 'end',
});

// 起始对齐（左侧）
await confirm('Are you sure?', 'Confirm', {
  buttonAlign: 'start',
});
```

## 8. 基础 Prompt 输入对话框

```typescript
import { prompt } from '@vben/common-ui';

// 简单输入
const result = await prompt({
  title: 'Enter Your Name',
  content: 'Please enter your name:',
  defaultValue: 'John Doe',
});

if (result) {
  console.log('User entered:', result);
}
```

## 9. 自定义组件的 Prompt

```typescript
import { prompt } from '@vben/common-ui';
import { ElInput } from 'element-plus';

const result = await prompt({
  title: 'Enter Email',
  content: 'Please enter your email address:',
  component: ElInput,
  componentProps: {
    type: 'email',
    placeholder: 'example@email.com',
  },
  defaultValue: '',
});

console.log('Email:', result);
```

## 10. 带校验的 Prompt

```typescript
import { prompt, alert } from '@vben/common-ui';

const result = await prompt({
  title: 'Enter Age',
  content: 'Please enter your age (must be 18 or older):',
  defaultValue: '',
  beforeClose: ({ isConfirm, value }) => {
    if (isConfirm) {
      const age = Number(value);
      if (isNaN(age) || age < 18) {
        alert('Age must be 18 or older');
        return false; // 阻止关闭
      }
    }
    return true;
  },
});

console.log('Age:', result);
```

## 11. 自定义插槽与 useAlertContext 的 Prompt

```typescript
import { defineComponent, h } from 'vue';
import { prompt, useAlertContext, alert } from '@vben/common-ui';
import { ElInput } from 'element-plus';

prompt({
  component: defineComponent({
    props: { modelValue: String },
    emits: ['update:modelValue'],
    /** 透传输入双向绑定，并在回车时调用当前对话框的确认方法。 */
    setup(props, { emit }) {
      const { doConfirm } = useAlertContext();
      return () => h(ElInput, {
        modelValue: props.modelValue,
        'onUpdate:modelValue': (value: string) => emit('update:modelValue', value),
        /** 回车确认当前输入，阻止表单默认提交。 */
        onKeydown(event: KeyboardEvent) {
          if (event.key === 'Enter') {
            event.preventDefault();
            doConfirm();
          }
        },
        placeholder: '请输入金额',
        type: 'number',
      }, {
        prefix: () => '充值金额',
        append: () => '元',
      });
    },
  }),
  content:
    'This dialog demonstrates how to use custom slots and get the dialog context using useAlertContext.\nPress Enter in the input box to trigger the confirm operation.',
  icon: 'question',
  modelPropName: 'modelValue',
}).then((val) => {
  if (val) alert(`You entered ${val}`);
});
```

## 12. 使用 Select 组件的 Prompt

```typescript
import { prompt, alert } from '@vben/common-ui';
import { ElSelectV2 } from 'element-plus';

prompt({
  component: ElSelectV2,
  componentProps: {
    options: [
      { label: 'Option A', value: 'Option A' },
      { label: 'Option B', value: 'Option B' },
      { label: 'Option C', value: 'Option C' },
    ],
    placeholder: 'Please select',
    // 对话框会将 body 的 pointer-events 设为 none，会影响下拉框的点击事件
    popperClass: 'pointer-events-auto',
  },
  content: 'This dialog demonstrates how to pass custom components using component',
  icon: 'question',
  modelPropName: 'modelValue',
}).then((val) => {
  if (val) {
    alert(`You selected ${val}`);
  }
});
```

## 13. 带异步校验的 Prompt

```typescript
import { prompt, alert } from '@vben/common-ui';
import { defineComponent, h } from 'vue';
import { ElRadio, ElRadioGroup } from 'element-plus';

const ChoiceInput = defineComponent({
  props: { modelValue: String },
  emits: ['update:modelValue'],
  /** 将选项显式渲染为 Element Plus 单选子项并向对话框同步选值。 */
  setup(props, { emit }) {
    return () => h(ElRadioGroup, {
      modelValue: props.modelValue,
      'onUpdate:modelValue': (value: string) => emit('update:modelValue', value),
    }, () => ['option1', 'option2', 'option3'].map((value) =>
      h(ElRadio, { value }, () => value),
    ));
  },
});

/** 等待指定毫秒数，模拟确认前的异步校验。 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

prompt({
  /** 确认时执行异步校验，未选择时保留对话框供继续输入。 */
  async beforeClose(scope) {
    if (scope.isConfirm) {
      if (scope.value) {
        // 模拟异步操作，不成功时可返回 false
        await sleep(2000);
      } else {
        alert('Please select an option');
        return false;
      }
    }
  },
  component: ChoiceInput,
  componentProps: {
    class: 'flex flex-col',
  },
  content: 'Select an option and then click [Confirm]',
  icon: 'question',
  modelPropName: 'modelValue',
}).then((val) => {
  alert(`${val} has been set.`);
});
```

## 14. 自定义遮罩模糊

```typescript
import { alert } from '@vben/common-ui';

await alert('Dialog with blurred background', 'Blur Effect', {
  overlayBlur: 5,
});
```

## 15. 通过 useAlertContext 使用自定义组件

```vue
<template>
  <div>
    <p>Custom content in alert</p>
    <ElButton @click="handleConfirm">Confirm</ElButton>
    <ElButton @click="handleCancel">Cancel</ElButton>
  </div>
</template>

<script setup lang="ts">
import { useAlertContext } from '@vben/common-ui';
import { ElButton } from 'element-plus';

const { doConfirm, doCancel } = useAlertContext();

/** 确认当前自定义内容所在的对话框。 */
const handleConfirm = () => {
  // 执行一些校验或操作
  doConfirm();
};

/** 取消当前对话框，确认逻辑不会执行。 */
const handleCancel = () => {
  doCancel();
};
</script>
```

```typescript
// 使用方式
import { alert } from '@vben/common-ui';
import CustomContent from './CustomContent.vue';

await alert({
  title: 'Custom Component',
  content: CustomContent,
});
```
