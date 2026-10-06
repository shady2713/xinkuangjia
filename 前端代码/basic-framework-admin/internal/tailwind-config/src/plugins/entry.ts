/**
 * 列表进出场动画工具类的唯一来源：为四个方向各生成 1~5 级
 * nth-child 延迟工具类，并补齐配套关键帧，交由 Tailwind 注入样式。
 *
 * 当前未注册进共享预设，需要该动效的构建方自行装载。
 */
import plugin from 'tailwindcss/plugin.js';

/**
 * 生成进出场动画的 Tailwind 插件。
 *
 * 为 .enter-x/.enter-y/.-enter-x/.-enter-y 四个方向各生成 1~5 级子元素延迟，
 * 让列表逐项进入时错开 0.1s 递增的时长；配合 enter-x-animation/enter-y-animation 关键帧
 * 实现位移淡入。所有工具类通过 addUtilities 注入，不依赖额外 CSS 文件。
 */
const enterAnimationPlugin = plugin(
  /**
   * 逐级生成四个方向的进出场工具类与配套关键帧，并注册到 Tailwind。
   *
   * @param options Tailwind 传入的插件 API 对象
   * @param options.addUtilities 工具类注册函数
   */
  ({ addUtilities }) => {
    const maxChild = 5;
    // 选择器到声明块的映射；声明值全部是字符串，交给 addUtilities 前无需再转换。
    const utilities: Record<string, Record<string, string>> = {};
    for (let i = 1; i <= maxChild; i++) {
      const baseDelay = 0.1;
      const delay = `${baseDelay * i}s`;

      utilities[`.enter-x:nth-child(${i})`] = {
        animation: `enter-x-animation 0.3s ease-in-out ${delay} forwards`,
        opacity: '0',
        transform: `translateX(50px)`,
      };

      utilities[`.enter-y:nth-child(${i})`] = {
        animation: `enter-y-animation 0.3s ease-in-out ${delay} forwards`,
        opacity: '0',
        transform: `translateY(50px)`,
      };

      utilities[`.-enter-x:nth-child(${i})`] = {
        animation: `enter-x-animation 0.3s ease-in-out ${delay} forwards`,
        opacity: '0',
        transform: `translateX(-50px)`,
      };

      utilities[`.-enter-y:nth-child(${i})`] = {
        animation: `enter-y-animation 0.3s ease-in-out ${delay} forwards`,
        opacity: '0',
        transform: `translateY(-50px)`,
      };
    }

    // 添加动画关键帧
    addUtilities(utilities);
    addUtilities({
      '@keyframes enter-x-animation': {
        to: {
          opacity: '1',
          transform: 'translateX(0)',
        },
      },
      '@keyframes enter-y-animation': {
        to: {
          opacity: '1',
          transform: 'translateY(0)',
        },
      },
    });
  },
);

export { enterAnimationPlugin };
