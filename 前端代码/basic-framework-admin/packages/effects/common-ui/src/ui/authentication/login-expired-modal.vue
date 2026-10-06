<script setup lang="ts">
/**
 * 登录过期弹窗：由 open 模型控制显隐，提示用户重新登录，正文以默认插槽交给上层。
 * z-index 默认取页面现有最大值加一以盖住其它浮层；不负责刷新令牌或跳转登录页。
 */
import type { AuthenticationProps } from './types';

import { computed, watch } from 'vue';

import { $t } from '@vben/locales';

import { useVbenModal } from '@vben-core/popup-ui';
import { Slot, VbenAvatar } from '@vben-core/shadcn-ui';

/** 登录过期弹窗属性：认证页公共属性，另加头像地址与自定义层级。 */
interface Props extends AuthenticationProps {
  avatar?: string;
  zIndex?: number;
}

defineOptions({
  name: 'LoginExpiredModal',
});

const props = withDefaults(defineProps<Props>(), {
  avatar: '',
  zIndex: 0,
});

const open = defineModel<boolean>('open');

const [Modal, modalApi] = useVbenModal();

watch(
  () => open.value,
  (val) => {
    modalApi.setState({ isOpen: val });
  },
);

/** 弹窗层级：优先使用传入的 zIndex，为 0 时按页面现有最大层级加一。 */
const getZIndex = computed(() => {
  return props.zIndex || calcZIndex();
});

/**
 * 排除ant-message和loading:9999的z-index
 */
const zIndexExcludeClass = ['ant-message', 'loading'];
/** 判断元素是否属于需要排除的消息与加载浮层；这些元素的层级不参与最大值统计。 */
function isZIndexExcludeClass(element: Element) {
  return zIndexExcludeClass.some((className) =>
    element.classList.contains(className),
  );
}

/**
 * 获取最大的zIndex值
 */
function calcZIndex() {
  let maxZ = 0;
  const elements = document.querySelectorAll('*');
  [...elements].forEach((element) => {
    const style = window.getComputedStyle(element);
    const zIndex = style.getPropertyValue('z-index');
    if (
      zIndex &&
      !Number.isNaN(Number.parseInt(zIndex)) &&
      !isZIndexExcludeClass(element)
    ) {
      maxZ = Math.max(maxZ, Number.parseInt(zIndex));
    }
  });
  return maxZ + 1;
}
</script>

<template>
  <div>
    <Modal
      :closable="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :footer="false"
      :fullscreen-button="false"
      :header="false"
      :z-index="getZIndex"
      class="border-none px-10 py-6 text-center shadow-xl sm:w-[600px] sm:rounded-2xl md:h-[unset]"
    >
      <VbenAvatar :src="avatar" class="mx-auto mb-6 size-20" />
      <Slot
        :show-forget-password="false"
        :show-register="false"
        :show-remember-me="false"
        :sub-title="$t('authentication.loginAgainSubTitle')"
        :title="$t('authentication.loginAgainTitle')"
      >
        <slot> </slot>
      </Slot>
    </Modal>
  </div>
</template>
