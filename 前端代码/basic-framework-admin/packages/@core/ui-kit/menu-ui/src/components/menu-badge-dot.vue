<script setup lang="ts">
/**
 * 菜单徽标圆点：渲染带扩散动画的小圆点，颜色与尺寸由外部传入。
 *
 * 自身不判断是否显示，显隐与取值由菜单徽标组件决定。
 */
import type { CSSProperties } from 'vue';

/**
 * 菜单圆点徽标属性：dotClass 决定底色类名，dotStyle 用于传入非类名的颜色值。
 * 尺寸与扩散动画由组件内固定类名控制，显隐判断交给外层菜单徽标。
 */
interface Props {
  dotClass?: string;
  dotStyle?: CSSProperties;
}

/** 注册圆点徽标属性，dotClass 缺省空串、dotStyle 缺省空对象，保证模板直接绑定不报错。 */
withDefaults(defineProps<Props>(), {
  dotClass: '',
  /** 缺省返回空样式对象，保证圆点只依赖 dotClass 上色，模板直接绑定也不会拿到 undefined。 */
  dotStyle: () => ({}),
});
</script>
<template>
  <span class="relative mr-1 flex size-1.5">
    <span
      :class="dotClass"
      :style="dotStyle"
      class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
    >
    </span>
    <span
      :class="dotClass"
      :style="dotStyle"
      class="relative inline-flex size-1.5 rounded-full"
    ></span>
  </span>
</template>
