<script setup lang="ts">
import axios from 'axios';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  FIELD_LIMITS,
  passwordComplexityRule,
  requiredRule,
} from '@/constants/validation';
import { useUserStore } from '@/stores/user';
import { getSessionId } from '@/utils/token';

const router = useRouter();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const rules: FormRules = {
  oldPassword: [requiredRule('当前密码')],
  newPassword: [requiredRule('新密码'), passwordComplexityRule()],
  confirmPassword: [
    requiredRule('确认新密码'),
    {
      validator: (_r, v, cb) => {
        if (v !== form.newPassword) cb(new Error('两次输入的密码不一致'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

async function handleSubmit() {
  const owner = getSessionId();
  if (!owner) return;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid || getSessionId() !== owner) return;
  loading.value = true;
  try {
    if (!(await userStore.changeOwnPassword(owner, form.oldPassword, form.newPassword))) return;
    ElMessage.success('密码修改成功，请重新登录');
    await router.replace('/login');
  } catch (error) {
    if (!axios.isCancel(error)) throw error;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-[520px] pt-8">
    <el-card shadow="never">
      <template #header>
        <span class="text-base font-semibold">首次登录请先修改初始密码</span>
      </template>
      <el-alert
        type="warning"
        :closable="false"
        title="为满足安全合规要求，修改密码后方可继续使用系统功能。"
        class="mb-4"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="95px">
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input
            v-model="form.oldPassword"
            type="password"
            show-password
            :maxlength="FIELD_LIMITS.PASSWORD_MAX"
            placeholder="请输入当前密码"
          />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            show-password
            :maxlength="FIELD_LIMITS.PASSWORD_MAX"
            placeholder="请输入 8~32 位含大小写字母及数字的新密码"
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            :maxlength="FIELD_LIMITS.PASSWORD_MAX"
            placeholder="请再次输入新密码"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleSubmit">
            确认修改
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>
