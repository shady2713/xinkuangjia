<script lang="ts" setup>
/**
 * 表单项控件容器：用 Slot 包住真实输入控件，注入 id 与无障碍描述。
 * id 供 FormLabel 的 for 关联，出错时把消息 id 并入 aria-describedby；
 * 必须在 FormField 与 FormItem 之内使用，本身不渲染表单元素。
 */
import { Slot } from 'reka-ui';

import { useFormField } from './useFormField';

const { error, formDescriptionId, formItemId, formMessageId } = useFormField();
</script>

<template>
  <Slot
    :id="formItemId"
    :aria-describedby="
      !error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`
    "
    :aria-invalid="!!error"
  >
    <slot></slot>
  </Slot>
</template>
