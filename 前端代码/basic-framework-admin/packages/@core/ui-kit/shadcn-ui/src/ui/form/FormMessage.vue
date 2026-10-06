<script lang="ts" setup>
/**
 * 表单项错误提示：用 vee-validate 的 ErrorMessage 显示字段校验消息。
 * 通过 useFormField 取得字段名与消息 id，无错误时不输出内容；
 * 需处于 FormField 与 FormItem 内，具体文案由校验规则提供。
 */
import { toValue } from 'vue';

import { ErrorMessage } from 'vee-validate';

import { useFormField } from './useFormField';

const { formMessageId, name } = useFormField();
</script>

<template>
  <ErrorMessage
    :id="formMessageId"
    :name="toValue(name)"
    as="p"
    class="text-[0.8rem] text-destructive"
  />
</template>
