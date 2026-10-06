<script setup lang="ts">
/**
 * 版本更新提醒：定时向部署入口发 HEAD 请求，比对版本标记判断更新。
 * 发现变化即弹窗引导刷新，页面隐藏时停表、恢复可见时补查一次；
 * 仅在非 localhost 生效，不解析版本号，也不接管资源缓存与刷新策略。
 */
import { onMounted, onUnmounted, ref } from 'vue';

import { $t } from '@vben/locales';

import { useVbenModal } from '@vben-core/popup-ui';

interface Props {
  // 轮询时间，分钟
  checkUpdatesInterval?: number;
  // 检查更新的地址
  checkUpdateUrl?: string;
}

defineOptions({ name: 'CheckUpdates' });

const props = withDefaults(defineProps<Props>(), {
  checkUpdatesInterval: 1,
  checkUpdateUrl: import.meta.env.BASE_URL || '/',
});

let isCheckingUpdates = false;
/** 组件是否已卸载：卸载后在途检查的续接逻辑一律不再安装定时器。 */
let disposed = false;
const currentVersionTag = ref('');
const lastVersionTag = ref('');
const timer = ref<ReturnType<typeof setInterval>>();

const [UpdateNoticeModal, modalApi] = useVbenModal({
  closable: false,
  closeOnPressEscape: false,
  closeOnClickModal: false,
  onConfirm() {
    lastVersionTag.value = currentVersionTag.value;
    window.location.reload();
    // handleSubmitLogout();
  },
});

async function getVersionTag() {
  try {
    if (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    ) {
      return null;
    }
    const response = await fetch(props.checkUpdateUrl, {
      cache: 'no-cache',
      method: 'HEAD',
      redirect: 'manual',
    });

    return (
      response.headers.get('etag') || response.headers.get('last-modified')
    );
  } catch {
    console.error('Failed to fetch version tag');
    return null;
  }
}

async function checkForUpdates() {
  const versionTag = await getVersionTag();
  if (!versionTag) {
    return;
  }

  // 首次运行时不提示更新
  if (!lastVersionTag.value) {
    lastVersionTag.value = versionTag;
    return;
  }

  if (lastVersionTag.value !== versionTag && versionTag) {
    clearInterval(timer.value);
    handleNotice(versionTag);
  }
}
function handleNotice(versionTag: string) {
  currentVersionTag.value = versionTag;
  modalApi.open();
}

/**
 * 启动版本轮询：间隔配置为非正数时视为关闭轮询，不安装定时器。
 * 挂载与「页面恢复可见」都会走到这里，重复调用必须只留下一个定时器。
 */
function start() {
  if (props.checkUpdatesInterval <= 0) {
    return;
  }

  // 挂载与「页面恢复可见」都会调用 start()，可能先后落在同一个仍存活的定时器上。
  // 直接覆盖句柄会让旧定时器失去引用后继续轮询，stop() 也再停不掉它，因此先清掉既有定时器。
  stop();

  // 每 checkUpdatesInterval(默认值为1) 分钟检查一次
  timer.value = setInterval(
    checkForUpdates,
    props.checkUpdatesInterval * 60 * 1000,
  );
}

/**
 * 文档可见性变化的处理入口：隐藏时停表，避免后台标签页继续发请求；
 * 重新可见时先补做一次检查，用进行中标记挡住并发的重复检查，结束后再恢复轮询。
 */
function handleVisibilitychange() {
  if (document.hidden) {
    stop();
  } else {
    if (!isCheckingUpdates) {
      isCheckingUpdates = true;
      checkForUpdates().finally(
        /**
         * 收尾这次补偿检查：先复位进行中标记，
         * 组件若已在检查期间卸载则直接返回，不再安装无人清理的定时器。
         */
        () => {
          isCheckingUpdates = false;
          // 检查期间组件可能已被卸载：此时再安装定时器会留下一个无人清理的轮询。
          if (disposed) {
            return;
          }
          start();
        },
      );
    }
  }
}

function stop() {
  clearInterval(timer.value);
}

onMounted(() => {
  start();
  document.addEventListener('visibilitychange', handleVisibilitychange);
});

onUnmounted(
  /**
   * 卸载收尾：先标记组件已销毁，让在途检查不再续接定时器，
   * 再停掉当前轮询并移除文档级可见性监听，避免已销毁的实例继续发请求。
   */
  () => {
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange', handleVisibilitychange);
  },
);
</script>
<template>
  <UpdateNoticeModal
    :cancel-text="$t('common.cancel')"
    :confirm-text="$t('common.refresh')"
    :fullscreen-button="false"
    :title="$t('ui.widgets.checkUpdatesTitle')"
    centered
    content-class="px-8 min-h-10"
    footer-class="border-none mb-3 mr-3"
    header-class="border-none"
  >
    {{ $t('ui.widgets.checkUpdatesDescription') }}
  </UpdateNoticeModal>
</template>
