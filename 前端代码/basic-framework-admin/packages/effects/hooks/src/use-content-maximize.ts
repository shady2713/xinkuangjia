/**
 * 内容区最大化开关：通过偏好设置隐藏或恢复头部与侧边栏。
 *
 * 只改布局偏好，不动路由与页面数据；toggleMaximizeAndTabbarHidden
 * 额外在最大化时开关标签栏，供表格工具栏使用。
 */
import { updatePreferences, usePreferences } from '@vben/preferences';
/**
 * 主体区域最大化
 */
export function useContentMaximize() {
  const { contentIsMaximize } = usePreferences();

  function toggleMaximize() {
    const isMaximize = contentIsMaximize.value;

    updatePreferences({
      header: {
        hidden: !isMaximize,
      },
      sidebar: {
        hidden: !isMaximize,
      },
    });
  }

  /**
   * 切换最大化和隐藏 tabbar
   */
  function toggleMaximizeAndTabbarHidden() {
    const isMaximize = contentIsMaximize.value;
    updatePreferences({
      header: {
        hidden: !isMaximize,
      },
      sidebar: {
        hidden: !isMaximize,
      },
      tabbar: {
        enable: isMaximize,
      },
    });
  }

  return {
    contentIsMaximize,
    toggleMaximize,
    toggleMaximizeAndTabbarHidden,
  };
}
