<script setup lang="ts">
/**
 * 个人中心页面容器：左侧资料卡加右侧标签页，聚合基本设置与密码设置。
 *
 * 挂载时拉取用户资料，子组件保存成功后刷新资料并同步用户状态；
 * 表单字段与保存逻辑在 modules 下的子组件中，本页只做编排与状态共享。
 */
import type { SystemUserProfileApi } from '#/api/system/user/profile';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

import { ElCard, ElTabPane, ElTabs } from 'element-plus';

import { getAuthPermissionInfoApi } from '#/api';
import { getUserProfile } from '#/api/system/user/profile';

import BaseInfo from './modules/base-info.vue';
import ProfileUser from './modules/profile-user.vue';
import ResetPwd from './modules/reset-pwd.vue';

const userStore = useUserStore();
const activeName = ref('basicInfo');

/** 加载个人信息 */
const profile = ref<SystemUserProfileApi.UserProfileRespVO>();
/**
 * 向后端请求当前登录用户的完整资料并写入页面共享的 profile。
 * 挂载时执行一次，子组件保存成功后由 refreshProfile 再次调用；
 * 接口失败时异常继续向上抛出，profile 保留上一次成功加载的资料，不会被清空。
 */
async function loadProfile() {
  profile.value = await getUserProfile();
}

/** 刷新个人信息 */
async function refreshProfile() {
  // 加载个人信息
  await loadProfile();

  // 更新 store
  const authPermissionInfo = await getAuthPermissionInfoApi();
  userStore.setUserInfo(authPermissionInfo.user);
}

/** 初始化 */
onMounted(loadProfile);
</script>

<template>
  <Page auto-content-height>
    <div class="flex">
      <!-- 左侧 个人信息 -->
      <ElCard class="w-2/5" title="个人信息">
        <ProfileUser :profile="profile" @success="refreshProfile" />
      </ElCard>

      <!-- 右侧 标签页 -->
      <ElCard class="ml-3 w-3/5">
        <ElTabs v-model="activeName" class="-mt-4">
          <ElTabPane name="basicInfo" label="基本设置">
            <BaseInfo :profile="profile" @success="refreshProfile" />
          </ElTabPane>
          <ElTabPane name="resetPwd" label="密码设置">
            <ResetPwd />
          </ElTabPane>
        </ElTabs>
      </ElCard>
    </div>
  </Page>
</template>
