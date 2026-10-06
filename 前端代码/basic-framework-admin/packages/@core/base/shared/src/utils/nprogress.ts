/**
 * 顶部进度条控制：首次调用时动态引入 NProgress 并配置，之后复用同一实例。
 * 对外只暴露 startProgress 与 stopProgress，何时启停由路由与请求层决定。
 */
import type NProgress from 'nprogress';

// 创建一个NProgress实例的变量，初始值为null
let nProgressInstance: null | typeof NProgress = null;

/**
 * 动态加载NProgress库，并进行配置。
 * 此函数首先检查是否已经加载过NProgress库，如果已经加载过，则直接返回NProgress实例。
 * 否则，动态导入NProgress库，进行配置，然后返回NProgress实例。
 *
 * @returns  NProgress实例的Promise对象。
 */
async function loadNprogress() {
  if (nProgressInstance) {
    return nProgressInstance;
  }
  nProgressInstance = await import('nprogress');
  nProgressInstance.configure({
    showSpinner: true,
    speed: 300,
  });
  return nProgressInstance;
}

/**
 * 开始显示进度条。
 * 此函数首先加载NProgress库，然后调用NProgress的start方法开始显示进度条。
 */
async function startProgress() {
  const nprogress = await loadNprogress();
  nprogress?.start();
}

/**
 * 停止显示进度条，并隐藏进度条。
 * 此函数首先加载NProgress库，然后调用NProgress的done方法停止并隐藏进度条。
 */
async function stopProgress() {
  const nprogress = await loadNprogress();
  nprogress?.done();
}

export { startProgress, stopProgress };
