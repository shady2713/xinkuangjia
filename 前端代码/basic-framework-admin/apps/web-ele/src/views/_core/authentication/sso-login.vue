<script lang="ts" setup>
/**
 * OAuth2 授权同意页：展示第三方应用申请的权限范围，由用户勾选后提交授权结果。
 */
import type { ComponentType, VbenFormSchema } from '#/adapter/form';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';

import { AuthenticationAuthTitle, VbenButton } from '@vben/common-ui';

import { useVbenForm } from '#/adapter/form';
import { authorize, getAuthorize } from '#/api/system/oauth2/open';

defineOptions({ name: 'SSOLogin' });

/** 授权表单值：用户本次勾选的授权范围。 */
type AuthorizeForm = {
  scopes: string[];
};

const { query } = useRoute();

const client = ref({
  name: '',
  logo: '',
}); // 客户端信息

const queryParams = reactive({
  responseType: '',
  clientId: '',
  redirectUri: '',
  state: '',
  scopes: [] as string[], // 优先从 query 参数获取；如果未传递，从后端获取
}); // URL 上的 client_id、scope 等参数

const loading = ref(false); // 表单是否提交中

/** 初始化授权信息 */
async function init() {
  // 防止在没有登录的情况下循环弹窗
  if (query.client_id === undefined) {
    return;
  }
  // 解析参数
  // 例如说【自动授权不通过】：client_id=default&redirect_uri=https%3A%2F%2Fwww.example.com&response_type=code&scope=user.read%20user.write
  // 例如说【自动授权通过】：client_id=default&redirect_uri=https%3A%2F%2Fwww.example.com&response_type=code&scope=user.read
  queryParams.responseType = query.response_type as string;
  queryParams.clientId = query.client_id as string;
  queryParams.redirectUri = query.redirect_uri as string;
  queryParams.state = query.state as string;
  if (query.scope) {
    queryParams.scopes = (query.scope as string).split(' ');
  }

  // 如果有 scope 参数，先执行一次自动授权，看看是否之前都授权过了。
  if (queryParams.scopes.length > 0) {
    const data = await doAuthorize(true, queryParams.scopes, []);
    if (data) {
      location.href = data;
      return;
    }
  }

  // 1.1 获取授权页的基本信息
  const data = await getAuthorize(queryParams.clientId);
  client.value = data.client;
  // 1.2 解析 scope
  let scopes: typeof data.scopes;
  // 如果 params.scope 非空，则过滤下返回的 scopes
  if (queryParams.scopes.length > 0) {
    scopes = data.scopes.filter(
      /**
       * 只保留客户端在授权请求中显式声明过的范围。
       * @param scope 后端返回的单个授权范围。
       * @returns 该范围是否在请求参数中出现。
       */
      (scope) => queryParams.scopes.includes(scope.key),
    );
    // 如果 params.scope 为空，则使用返回的 scopes 设置它
  } else {
    scopes = data.scopes;
    queryParams.scopes = scopes.map(
      /** 请求未声明范围时，默认接受后端返回的全部范围。 */
      (scope) => scope.key,
    );
  }

  // 2.设置表单的初始值
  formApi.setFieldValue(
    'scopes',
    scopes
      .filter(
        /**
         * 只把后端标记为默认勾选的范围作为初始值。
         * @param scope 待判断的授权范围。
         * @returns 该范围是否需要默认勾选。
         */
        (scope) => scope.value,
      )
      .map(
        /**
         * 表单只提交范围键，后端按键判定实际权限。
         * @param scope 单个授权范围。
         * @returns 该范围对应的键。
         */
        (scope) => scope.key,
      ),
  );
}

/**
 * 处理授权确认：同意时按用户勾选提交，拒绝时全部取消。
 * @param approved 用户是否同意授权。
 * @returns 授权请求完成后兑现；后端未返回跳转地址时不跳转。
 */
async function handleSubmit(approved: boolean) {
  // 计算 checkedScopes + uncheckedScopes
  let checkedScopes: string[];
  let uncheckedScopes: string[];
  if (approved) {
    // 同意授权，按照用户的选择
    const res = await formApi.getValues();
    checkedScopes = res.scopes;
    uncheckedScopes = queryParams.scopes.filter(
      /**
       * 未被勾选的范围按取消处理，后端据此回收既有授权。
       * @param item 当前待判断的授权范围键。
       * @returns 该范围是否未被勾选。
       */
      (item) => !checkedScopes.includes(item),
    );
  } else {
    // 拒绝，则都是取消
    checkedScopes = [];
    uncheckedScopes = queryParams.scopes;
  }

  // 提交授权的请求
  loading.value = true;
  try {
    const data = await doAuthorize(false, checkedScopes, uncheckedScopes);
    if (!data) {
      return;
    }
    // 跳转授权成功后的回调地址
    location.href = data;
  } finally {
    loading.value = false;
  }
}

/** 调用授权 API 接口 */
const doAuthorize = (
  autoApprove: boolean,
  checkedScopes: string[],
  uncheckedScopes: string[],
) => {
  return authorize(
    queryParams.responseType,
    queryParams.clientId,
    queryParams.redirectUri,
    queryParams.state,
    autoApprove,
    checkedScopes,
    uncheckedScopes,
  );
};

/** 格式化 scope 文本 */
function formatScope(scope: string) {
  // 格式化 scope 授权范围，方便用户理解。
  // 如果后续 scope 种类继续增加，建议收敛到字典数据，例如字典类型 "system_oauth2_scope"。
  switch (scope) {
    case 'user.read': {
      return '访问你的个人信息';
    }
    case 'user.write': {
      return '修改你的个人信息';
    }
    default: {
      return scope;
    }
  }
}

/**
 * 授权范围表单：范围列表在授权信息返回后才确定，因此整体用计算属性生成。
 */
const formSchema = computed(
  /**
   * 授权范围的可选项：范围列表在授权信息返回后才确定，必须整体重算。
   * @returns 只含“授权范围”一个字段的表单项列表。
   */
  (): VbenFormSchema[] => {
    return [
      {
        fieldName: 'scopes',
        label: '授权范围',
        component: 'CheckboxGroup',
        componentProps: {
          options: queryParams.scopes.map(
            /**
             * 每个范围键对应一个可勾选项，展示名由范围键格式化而来。
             * @param scope 授权范围的键。
             * @returns 勾选项的标签与取值。
             */
            (scope) => ({
              label: formatScope(scope),
              value: scope,
            }),
          ),
          class: 'flex flex-col gap-2',
        },
      },
    ];
  },
);

const [Form, formApi] = useVbenForm<ComponentType, AuthorizeForm>(
  reactive({
    commonConfig: {
      hideLabel: true,
      hideRequiredMark: true,
    },
    schema: formSchema,
    showDefaultActions: false,
  }),
);

onMounted(
  /** 首次进入授权页时拉取客户端信息与授权范围。 */
  () => {
    init();
  },
);
</script>

<template>
  <div @keydown.enter.prevent="handleSubmit(true)">
    <AuthenticationAuthTitle>
      <slot name="title">
        {{ `${client.name} 👋🏻` }}
      </slot>
      <template #desc>
        <span class="text-muted-foreground">
          此第三方应用请求获得以下权限：
        </span>
      </template>
    </AuthenticationAuthTitle>

    <Form />

    <div class="flex gap-2">
      <VbenButton
        :class="{
          'cursor-wait': loading,
        }"
        :loading="loading"
        aria-label="login"
        class="w-2/3"
        @click="handleSubmit(true)"
      >
        同意授权
      </VbenButton>
      <VbenButton
        :class="{
          'cursor-wait': loading,
        }"
        :loading="loading"
        aria-label="login"
        class="w-1/3"
        variant="outline"
        @click="handleSubmit(false)"
      >
        拒绝
      </VbenButton>
    </div>
  </div>
</template>
