<script setup lang="ts">
/**
 * 个人中心页面外壳：左侧资料卡与竖向页签，右侧渲染 content 插槽。
 *
 * 头像与昵称取 userInfo，缺失时回退偏好设置的默认头像；
 * 选中页签通过 modelValue 双向绑定，资料请求与区块内容均由外层提供。
 */
import type { Props } from './types';

import { preferences } from '@vben-core/preferences';
import {
  Card,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  VbenAvatar,
} from '@vben-core/shadcn-ui';

import { Page } from '../../components';

defineOptions({
  name: 'ProfileUI',
});

withDefaults(defineProps<Props>(), {
  title: '关于项目',
  /** 标签页清单默认值：空数组，未传入时不渲染任何标签。 */
  tabs: () => [],
});

const tabsValue = defineModel<string>('modelValue');
</script>
<template>
  <Page auto-content-height>
    <div class="flex h-full w-full">
      <Card class="w-1/6 flex-none">
        <div class="mt-4 flex h-40 flex-col items-center justify-center gap-4">
          <VbenAvatar
            :src="userInfo?.avatar ?? preferences.app.defaultAvatar"
            class="size-20"
          />
          <span class="text-lg font-semibold">
            {{ userInfo?.nickname ?? '' }}
          </span>
          <span class="text-foreground/80 text-sm">
            {{ userInfo?.username ?? '' }}
          </span>
        </div>
        <Separator class="my-4" />
        <Tabs v-model="tabsValue" orientation="vertical" class="m-4">
          <TabsList class="bg-card grid w-full grid-cols-1">
            <TabsTrigger
              v-for="tab in tabs"
              :key="tab.value"
              :value="tab.value"
              class="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-12 justify-start"
            >
              {{ tab.label }}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Card>
      <Card class="ml-4 w-5/6 flex-auto p-8">
        <slot name="content"></slot>
      </Card>
    </div>
  </Page>
</template>
