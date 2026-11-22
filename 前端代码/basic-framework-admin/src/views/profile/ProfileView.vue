<script setup lang="ts">
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';

import {
  getUserProfileApi,
  updateUserPasswordApi,
  updateUserProfileApi,
  type UserProfileResp,
} from '@/api/system/profile';
import UploadField from '@/components/UploadField.vue';
import {
  emailRule,
  FIELD_LIMITS,
  maxLenRule,
  mobileRule,
  passwordComplexityRule,
  requiredRule,
} from '@/constants/validation';
import { useUserStore } from '@/stores/user';
import { formatDateTime } from '@/utils/format';
import { encryptPassword } from '@/utils/sm2';

const userStore = useUserStore();
const loading = ref(false);
const savingBasic = ref(false);
const savingPwd = ref(false);
const profile = ref<UserProfileResp | null>(null);
const activeTab = ref<'basic' | 'password'>('basic');

const basicFormRef = ref<FormInstance>();
const basicForm = reactive({
  nickname: '',
  mobile: '',
  email: '',
  sex: 1,
  avatar: '',
});
const basicRules: FormRules = {
  nickname: [
    requiredRule('用户昵称'),
    maxLenRule('用户昵称', FIELD_LIMITS.NICKNAME),
  ],
  mobile: [mobileRule()],
  email: [emailRule(), maxLenRule('邮箱', FIELD_LIMITS.EMAIL)],
};

const pwdFormRef = ref<FormInstance>();
const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const pwdRules: FormRules = {
  oldPassword: [requiredRule('旧密码')],
  newPassword: [requiredRule('新密码'), passwordComplexityRule()],
  confirmPassword: [
    requiredRule('确认密码'),
    {
      validator: (_r, v, cb) => {
        if (v !== pwdForm.newPassword) cb(new Error('两次输入的密码不一致'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

async function loadProfile() {
  loading.value = true;
  try {
    const res = await getUserProfileApi();
    profile.value = res;
    basicForm.nickname = res.nickname || '';
    basicForm.mobile = res.mobile || '';
    basicForm.email = res.email || '';
    basicForm.sex = res.sex ?? 1;
    basicForm.avatar = res.avatar || '';
  } finally {
    loading.value = false;
  }
}

async function handleSaveBasic() {
  const valid = await basicFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  savingBasic.value = true;
  try {
    await updateUserProfileApi({
      nickname: basicForm.nickname.trim(),
      mobile: basicForm.mobile.trim() || undefined,
      email: basicForm.email.trim() || undefined,
      sex: basicForm.sex,
      avatar: basicForm.avatar || undefined,
    });
    ElMessage.success('个人资料已更新');
    await loadProfile();
    await userStore.fetchPermissionInfo();
  } finally {
    savingBasic.value = false;
  }
}

async function handleAvatarUploaded(url: string) {
  basicForm.avatar = url;
  await updateUserProfileApi({
    nickname: basicForm.nickname.trim() || profile.value?.nickname || '',
    avatar: url,
  });
  ElMessage.success('头像已更新');
  await loadProfile();
  await userStore.fetchPermissionInfo();
}

async function handleSavePassword() {
  const valid = await pwdFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  savingPwd.value = true;
  try {
    const oldPassword = await encryptPassword(pwdForm.oldPassword);
    const newPassword = await encryptPassword(pwdForm.newPassword);
    await updateUserPasswordApi({ oldPassword, newPassword });
    ElMessage.success('密码修改成功');
    pwdForm.oldPassword = '';
    pwdForm.newPassword = '';
    pwdForm.confirmPassword = '';
  } finally {
    savingPwd.value = false;
  }
}

onMounted(() => {
  void loadProfile();
});
</script>

<template>
  <el-row v-loading="loading" :gutter="16">
    <el-col :xs="24" :md="9" class="mb-4 md:mb-0">
      <el-card shadow="never">
        <template #header>
          <span class="font-semibold text-[#18181b]">个人信息</span>
        </template>
        <div class="mb-5 flex flex-col items-center">
          <UploadField
            v-model="basicForm.avatar"
            mode="image"
            :cropper="true"
            :aspect-ratio="1"
            directory="avatar"
            tip="点击更换头像（支持裁剪）"
            @uploaded="handleAvatarUploaded"
          />
        </div>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="用户账号">
            {{ profile?.username || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="用户昵称">
            {{ profile?.nickname || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="手机号码">
            {{ profile?.mobile || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="用户邮箱">
            {{ profile?.email || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="所属部门">
            {{ profile?.dept?.name || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="所属角色">
            {{ profile?.roles?.map((r) => r.name).join('、') || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(profile?.createTime) }}
          </el-descriptions-item>
          <el-descriptions-item label="最近登录">
            {{ formatDateTime(profile?.loginDate) }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </el-col>

    <el-col :xs="24" :md="15">
      <el-card shadow="never">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="基本资料" name="basic">
            <el-form
              ref="basicFormRef"
              :model="basicForm"
              :rules="basicRules"
              label-width="90px"
              class="mt-3 max-w-[480px]"
            >
              <el-form-item label="用户昵称" prop="nickname">
                <el-input
                  v-model="basicForm.nickname"
                  :maxlength="FIELD_LIMITS.NICKNAME"
                  placeholder="请输入用户昵称"
                />
              </el-form-item>
              <el-form-item label="手机号码" prop="mobile">
                <el-input
                  v-model="basicForm.mobile"
                  :maxlength="FIELD_LIMITS.MOBILE"
                  placeholder="请输入 11 位手机号码"
                />
              </el-form-item>
              <el-form-item label="用户邮箱" prop="email">
                <el-input
                  v-model="basicForm.email"
                  :maxlength="FIELD_LIMITS.EMAIL"
                  placeholder="请输入常用邮箱地址"
                />
              </el-form-item>
              <el-form-item label="性别">
                <el-radio-group v-model="basicForm.sex">
                  <el-radio :value="1">男</el-radio>
                  <el-radio :value="2">女</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="savingBasic" @click="handleSaveBasic">
                  保存修改
                </el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="修改密码" name="password">
            <el-form
              ref="pwdFormRef"
              :model="pwdForm"
              :rules="pwdRules"
              label-width="90px"
              class="mt-3 max-w-[480px]"
            >
              <el-form-item label="旧密码" prop="oldPassword">
                <el-input
                  v-model="pwdForm.oldPassword"
                  type="password"
                  show-password
                  :maxlength="FIELD_LIMITS.PASSWORD_MAX"
                  placeholder="请输入当前密码"
                />
              </el-form-item>
              <el-form-item label="新密码" prop="newPassword">
                <el-input
                  v-model="pwdForm.newPassword"
                  type="password"
                  show-password
                  :maxlength="FIELD_LIMITS.PASSWORD_MAX"
                  placeholder="请输入 8~32 位含大小写字母及数字的新密码"
                />
              </el-form-item>
              <el-form-item label="确认密码" prop="confirmPassword">
                <el-input
                  v-model="pwdForm.confirmPassword"
                  type="password"
                  show-password
                  :maxlength="FIELD_LIMITS.PASSWORD_MAX"
                  placeholder="请再次输入新密码"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="savingPwd" @click="handleSavePassword">
                  修改密码
                </el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </el-col>
  </el-row>
</template>
