/**
 * 伪 DOM 浏览器能力前提测试。
 *
 * 下载、上传与首屏 loading 的测试需要替换若干浏览器 API（对象 URL、atob、画布、锚点 download
 * 属性、transitionend 事件）。这些替换只有在对应能力真实存在时才是有意义的降级，因此在这里
 * 把前提固定下来，避免环境变化后其它用例以"看起来像业务失败"的方式变红。
 */
import { describe, expect, it } from 'vitest';

describe('伪 DOM 提供的浏览器能力', /** 只断言下载链路依赖的 API 形状，不校验其业务语义。 */ () => {
  it('提供对象 URL 的创建与释放', /** Blob 下载依赖 createObjectURL 生成临时地址、revokeObjectURL 释放内存。 */ () => {
    expect(typeof URL.createObjectURL).toBe('function');
    expect(typeof URL.revokeObjectURL).toBe('function');
  });

  it('提供 Base64 解码能力', /** Base64 下载与文件还原都依赖 atob 把字符串还原成字节。 */ () => {
    expect(typeof window.atob).toBe('function');
    expect(window.atob('QUJD')).toBe('ABC');
  });

  it('提供 File 构造函数', /** base64ToFile 需要按解码结果构造真实 File 对象。 */ () => {
    expect(new File(['abc'], 'a.txt').name).toBe('a.txt');
  });

  it('锚点的 download 是可读写属性', /** 触发下载时靠它设置文件名，不支持时需要改用 target 兜底。 */ () => {
    const anchor = document.createElement('a');
    anchor.download = 'report.pdf';

    expect(anchor.download).toBe('report.pdf');
  });

  it('元素宽度是原型上的可覆写访问器', /** 滚动条宽度测量依赖 offsetWidth，测试用原型 getter 给出确定差值。 */ () => {
    expect(
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
        ?.get,
    ).toBeTypeOf('function');
  });

  it('支持 transitionend 事件派发', /** 首屏 loading 靠过渡动画结束后再卸载节点。 */ () => {
    const element = document.createElement('div');
    let fired = 0;
    element.addEventListener(
      'transitionend',
      /** 统计事件到达次数，确认伪 DOM 支持该事件。 */
      () => {
        fired += 1;
      },
    );

    element.dispatchEvent(new Event('transitionend'));

    expect(fired).toBe(1);
  });

  it('画布元素可创建但取不到绘图上下文', /** 画布导出用例必须自行注入绘图上下文，这里固定该前提。 */ () => {
    const canvas = document.createElement('canvas');

    expect(canvas.getContext('2d')).toBeNull();
  });
});
