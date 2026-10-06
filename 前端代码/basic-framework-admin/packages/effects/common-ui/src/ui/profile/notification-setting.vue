<script setup lang="ts">
/**
 * 通知设置表单：按 formSchema 把每项渲染成标签、说明与开关。
 *
 * 切换开关只抛出 { fieldName, value }，保存与请求由外层页面负责；
 * 具体通知渠道与字段由 formSchema 提供方定义，本组件不感知。
 */
import type { Recordable } from '@vben/types';

import type { SettingProps } from './types';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  Switch,
} from '@vben-core/shadcn-ui';

withDefaults(defineProps<SettingProps>(), {
  /** 开关字段清单默认值：空数组，未传入时不渲染任何开关项。 */
  formSchema: () => [],
});

const emit = defineEmits<{
  change: [Recordable<unknown>];
}>();

/** 单个开关变化时把字段名与新值合并后抛给调用方；本组件不保存取值。 */
function handleChange(fieldName: string, value: boolean) {
  emit('change', { fieldName, value });
}
</script>
<template>
  <Form class="space-y-8">
    <div class="space-y-4">
      <template v-for="item in formSchema" :key="item.fieldName">
        <FormField type="checkbox" :name="item.fieldName">
          <FormItem
            class="flex flex-row items-center justify-between rounded-lg border p-4"
          >
            <div class="space-y-0.5">
              <FormLabel class="text-base"> {{ item.label }} </FormLabel>
              <FormDescription>
                {{ item.description }}
              </FormDescription>
            </div>
            <FormControl>
              <Switch
                :model-value="item.value"
                @update:model-value="handleChange(item.fieldName, $event)"
              />
            </FormControl>
          </FormItem>
        </FormField>
      </template>
    </div>
  </Form>
</template>
