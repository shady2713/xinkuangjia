<script setup lang="ts">
/**
 * 验证码分隔符：在两段验证码之间渲染静态圆点，可用插槽替换内容。
 * 不承载输入与焦点行为，放进根节点插槽即可，无需额外配置。
 */
import type { PrimitiveProps } from 'reka-ui';

import { Dot } from 'lucide-vue-next';
import { Primitive, useForwardProps } from 'reka-ui';

const props = defineProps<PrimitiveProps>();
const forwardedProps = useForwardProps(props);
</script>

<template>
  <Primitive v-bind="forwardedProps">
    <slot>
      <Dot />
    </slot>
  </Primitive>
</template>
