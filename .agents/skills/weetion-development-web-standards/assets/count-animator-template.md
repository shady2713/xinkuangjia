# CountToAnimator 使用示例模板

当前应用为 Element Plus。代码块展示组合片段；业务回调、数据类型和实际接口需按目标模块补齐，不能把示例名称当作已有实现。

## 模板用途
用于生成数字动画组件的使用示例模板

## 1. 基础用法

```vue
<template>
  <VbenCountToAnimator :end-val="30000" />
</template>

<script setup lang="ts">
import { VbenCountToAnimator } from '@vben/common-ui';
</script>
```

## 2. 自定义前缀和分隔符

```vue
<template>
  <VbenCountToAnimator
    :duration="3000"
    :end-val="2000000"
    :start-val="1"
    prefix="$"
    separator="/"
  />
</template>

<script setup lang="ts">
import { VbenCountToAnimator } from '@vben/common-ui';
</script>
```

## 3. 自定义后缀

```vue
<template>
  <VbenCountToAnimator
    :end-val="99.99"
    :decimals="2"
    suffix="%"
  />
</template>

<script setup lang="ts">
import { VbenCountToAnimator } from '@vben/common-ui';
</script>
```

## 4. 自定义颜色和时长

```vue
<template>
  <VbenCountToAnimator
    :end-val="10000"
    :duration="5000"
    color="#ff6b6b"
  />
</template>

<script setup lang="ts">
import { VbenCountToAnimator } from '@vben/common-ui';
</script>
```

## 5. 手动控制动画

```vue
<template>
  <div>
    <VbenCountToAnimator
      ref="countToRef"
      :end-val="50000"
      :autoplay="false"
    />
    <div class="mt-4">
      <ElButton @click="handleStart">Start</ElButton>
      <ElButton @click="handleReset">Reset</ElButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElButton } from 'element-plus';
import { ref } from 'vue';
import { VbenCountToAnimator } from '@vben/common-ui';

const countToRef = ref();

const handleStart = () => {
  countToRef.value?.start();
};

const handleReset = () => {
  countToRef.value?.reset();
};
</script>
```

## 6. 监听动画事件

```vue
<template>
  <VbenCountToAnimator
    :end-val="88888"
    @started="handleStarted"
    @finished="handleFinished"
  />
</template>

<script setup lang="ts">
import { VbenCountToAnimator } from '@vben/common-ui';

const handleStarted = () => {
  console.log('Animation started');
};

const handleFinished = () => {
  console.log('Animation finished');
};
</script>
```

## 7. 小数位数

```vue
<template>
  <VbenCountToAnimator
    :end-val="3.1415926"
    :decimals="4"
  />
</template>

<script setup lang="ts">
import { VbenCountToAnimator } from '@vben/common-ui';
</script>
```

## 8. 禁用缓动

```vue
<template>
  <VbenCountToAnimator
    :end-val="100000"
    :use-easing="false"
  />
</template>

<script setup lang="ts">
import { VbenCountToAnimator } from '@vben/common-ui';
</script>
```
