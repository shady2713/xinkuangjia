<!-- 认证页标题区：渲染主标题插槽与右上角描述插槽，供各登录表单复用。 -->
<template>
  <div class="mb-7 sm:mx-auto sm:w-full sm:max-w-md">
    <h2
      class="text-foreground mb-3 text-3xl font-bold leading-9 tracking-tight lg:text-4xl"
    >
      <slot></slot>
    </h2>

    <p class="text-muted-foreground lg:text-md text-sm">
      <slot name="desc"></slot>
    </p>
  </div>
</template>
