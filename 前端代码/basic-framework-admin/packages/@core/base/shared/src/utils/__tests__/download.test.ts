/**
 * 文件下载工具的测试。
 *
 * 覆盖 URL、Base64、Blob、BlobPart 四条下载通道，以及画布导出图片、文件名推导与各种非法入参。
 * 浏览器侧的对象 URL、锚点点击、图片解码与画布上下文都由本文件替换，替换前提见同目录的环境能力用例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  base64ToFile,
  dataURLtoBlob,
  downloadFileFromBase64,
  downloadFileFromBlob,
  downloadFileFromBlobPart,
  downloadFileFromImageUrl,
  downloadFileFromUrl,
  downloadImageByCanvas,
  triggerDownload,
  urlToBase64,
} from '../download';
import { openWindow } from '../window';

vi.mock(
  '../window',
  /** 打开新窗口是浏览器副作用，这里替换为可断言的桩。 */ () => ({
    openWindow: vi.fn(),
  }),
);

/** 保存未被替换的真实创建函数，供桩工厂自身创建元素时使用，避免自调用死循环。 */
const realCreateElement = document.createElement.bind(document);

/** Navigator 的原型；userAgent 是原型上的访问器，只能在原型上打桩才能被自动还原。 */
const navigatorPrototype: Navigator = Object.getPrototypeOf(window.navigator);

/** 记录每次真实触发的下载锚点，供断言文件名、地址与 target 使用。 */
const clickedAnchors: HTMLAnchorElement[] = [];

/** 本轮创建的全部桩 canvas，画布导出会先后创建外层画布与转码画布，顺序确定。 */
const createdCanvases: HTMLCanvasElement[] = [];

/** canvas 元素与其绘图上下文桩的对应关系。 */
const canvasContexts = new WeakMap<HTMLCanvasElement, StubContext>();

/** 画布桩配置；为 undefined 表示 canvas 标签不使用桩，直接走真实元素。 */
let canvasStub: undefined | { dataUrl: string; withoutContext: boolean };

/** 画布绘图上下文的最小替身，只记录调用以便断言绘制参数。 */
interface StubContext {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

/** 图片解码替身：继承真实事件目标，由用例派发 load 事件模拟解码完成。 */
class FakeImage extends EventTarget {
  crossOrigin = '';
  height = 0;
  width = 0;
  /** 读取图片地址。 @returns 当前设置的地址。 */
  get src(): string {
    return this.#src;
  }

  /** 记录图片地址。 @param value 目标地址。 */
  set src(value: string) {
    this.#src = value;
  }

  /** 由用例写入的图片地址。 */
  #src = '';
  /** 记录实例，供用例按创建顺序取出。 */
  constructor() {
    super();
    fakeImages.push(this);
  }

  /** 模拟图片解码完成，向已注册的 load 监听器派发事件。 */
  emitLoad(): void {
    this.dispatchEvent(new Event('load'));
  }
}

/** 由替身类记录全部被创建的图片实例，供用例按顺序手动触发 load 事件。 */
const fakeImages: FakeImage[] = [];

/** 构造一个绘图上下文与数据地址都可控的 canvas 元素。
 * @param dataUrl toDataURL 返回的数据地址。
 * @param withoutContext 是否让 getContext 返回 null，用于模拟画布不可用。
 * @returns canvas 元素与其绘图上下文桩。
 */
function createStubCanvas(
  dataUrl: string,
  withoutContext = false,
): { canvas: HTMLCanvasElement; context: StubContext } {
  const context: StubContext = { clearRect: vi.fn(), drawImage: vi.fn() };
  const canvas = realCreateElement('canvas');
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    /** 按配置返回绘图上下文或 null，用于模拟画布不可用。 */
    value: () => (withoutContext ? null : context),
  });
  Object.defineProperty(canvas, 'toDataURL', {
    configurable: true,
    /** 固定导出结果，避免依赖真实编码实现。 */
    value: () => dataUrl,
  });
  canvasContexts.set(canvas, context);
  return { canvas, context };
}

/** 让 canvas 标签总是返回带桩上下文的元素，其它标签继续使用真实元素。
 * @param dataUrl toDataURL 返回的数据地址。
 * @param withoutContext 是否让 getContext 返回 null。
 */
function stubAllCanvases(dataUrl: string, withoutContext = false): void {
  canvasStub = { dataUrl, withoutContext };
}

/** 取出第 index 块桩 canvas。
 * @param index 创建顺序。
 * @returns 该 canvas 元素。
 * @throws 创建顺序不足时抛出，说明用例漏掉了必要的解码触发。
 */
function canvasAt(index: number): HTMLCanvasElement {
  const canvas = createdCanvases[index];
  if (!canvas) {
    throw new TypeError(`第 ${index} 块画布尚未创建`);
  }
  return canvas;
}

/** 取出第 index 块画布的绘图上下文桩。
 * @param index 创建顺序。
 * @returns 该画布的绘图上下文桩。
 * @throws 画布不存在或没有上下文时抛出。
 */
function contextAt(index: number): StubContext {
  const context = canvasContexts.get(canvasAt(index));
  if (!context) {
    throw new TypeError(`第 ${index} 块画布没有绘图上下文`);
  }
  return context;
}

/** 取出第 index 张替身图片。
 * @param index 创建顺序。
 * @returns 该图片实例。
 * @throws 尚未创建时抛出，说明用例漏掉了调用。
 */
function imageAt(index: number): FakeImage {
  const image = fakeImages[index];
  if (!image) {
    throw new TypeError(`第 ${index} 张图片尚未创建`);
  }
  return image;
}

/** 取出第 index 次触发的下载锚点。
 * @param index 点击顺序。
 * @returns 该锚点。
 * @throws 尚未发生点击时抛出，说明该用例本应触发一次下载。
 */
function anchorAt(index: number): HTMLAnchorElement {
  const anchor = clickedAnchors[index];
  if (!anchor) {
    throw new TypeError(`第 ${index} 次下载尚未触发`);
  }
  return anchor;
}

/** 把用户代理固定为指定字符串。
 * @param userAgent 目标用户代理字符串。
 */
function setUserAgent(userAgent: string): void {
  vi.spyOn(navigatorPrototype, 'userAgent', 'get').mockReturnValue(userAgent);
}

/** 逐个触发所有图片实例的 load 事件，直到不再产生新实例。
 * 画布导出会在 load 回调里再创建一张图片来生成 Base64，因此需要循环到收敛。
 */
function emitAllLoads(): void {
  for (const fakeImage of fakeImages) {
    fakeImage?.emitLoad();
  }
}

/** 等待挂起的 Promise 链完成：图片导出先转 Base64 再触发下载，发生在微任务里。 */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

/** 返回一个非 Error 的第三方异常载荷，用于覆盖错误包装的兜底文案。
 * @returns 一个普通字符串。
 */
function nonErrorFailure(): string {
  return 'boom';
}

/** 三个主流浏览器的用户代理：Chrome 同时命中 chrome 与 safari，Firefox 两者都不命中。 */
const UA = {
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  firefox:
    'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
  iOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

/** 屏蔽控制台输出，只保留可断言的调用记录。
 * @returns 拦截后的 Spy。
 */
function silenceError() {
  return vi
    .spyOn(console, 'error')
    .mockImplementation(/** 不真正打印日志，只让 Spy 记录调用。 */ () => {});
}

beforeEach(
  /** 为每个用例重建全部浏览器侧桩。 */ () => {
    clickedAnchors.length = 0;
    createdCanvases.length = 0;
    fakeImages.length = 0;
    canvasStub = undefined;
    vi.spyOn(document, 'createElement').mockImplementation(
      /** canvas 走用例配置的桩，其它标签用真实元素。 */
      (tagName: string, options?: ElementCreationOptions) => {
        if (canvasStub && tagName.toLowerCase() === 'canvas') {
          const stubbed = createStubCanvas(
            canvasStub.dataUrl,
            canvasStub.withoutContext,
          );
          createdCanvases.push(stubbed.canvas);
          return stubbed.canvas;
        }
        return realCreateElement(tagName, options);
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      /** 记录被点击的锚点，真实点击会触发浏览器下载。 */
      function clickStub(this: HTMLAnchorElement) {
        clickedAnchors.push(this);
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock/1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(
      /** 真实地址不存在，释放动作只做记录。 */ () => {},
    );
    vi.stubGlobal('Image', FakeImage);
    vi.useFakeTimers();
  },
);

afterEach(
  /** 交还真实计时器与全局对象，避免影响其它测试文件。 */ () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe('triggerDownload', /** 通用下载触发：造隐藏锚点、点击、再延迟释放临时地址。 */ () => {
  it('未给文件名时使用默认名', /** 调用方没给名字时不能生成空文件名。 */ () => {
    triggerDownload('blob:mock/1', undefined);

    expect(anchorAt(0).download).toBe('downloaded_file');
    expect(anchorAt(0).href).toBe('blob:mock/1');
  });

  it('点击后把锚点从文档中移除', /** 残留锚点会在页面上累积垃圾节点。 */ () => {
    triggerDownload('blob:mock/1', 'a.png');

    expect(document.body.contains(anchorAt(0))).toBe(false);
  });

  it('按传入延迟释放临时地址', /** 立即释放会让还没开始的下载拿不到地址。 */ () => {
    triggerDownload('blob:mock/1', 'a.png', 50);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock/1');
  });

  it('默认延迟 100 毫秒释放', /** 默认延迟同样是延后释放，不能同步释放。 */ () => {
    triggerDownload('blob:mock/1', 'a.png');
    vi.advanceTimersByTime(99);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('浏览器不支持 download 属性时改用新窗口打开', /** 老浏览器忽略 download，只能靠 target 触发下载。 */ () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'download', 'get').mockReturnValue(
      undefined,
    );

    triggerDownload('https://host.com/a.png', 'a.png');

    expect(anchorAt(0).getAttribute('target')).toBe('_blank');
  });
});

describe('downloadFileFromUrl', /** 通过 URL 下载：按浏览器能力分流，iOS 直接放弃并提示。 */ () => {
  it('地址为空时拒绝', /** 空地址会触发一次无意义的下载。 */ async () => {
    setUserAgent(UA.chrome);

    await expect(downloadFileFromUrl({ source: '' })).rejects.toThrow(
      'Invalid URL.',
    );
  });

  it('iOS 浏览器直接放弃下载', /** iOS 屏蔽了下载能力，必须提示而不是静默失败。 */ async () => {
    setUserAgent(UA.iOS);
    const error = silenceError();

    await downloadFileFromUrl({ source: 'https://host.com/a.png' });

    expect(error).toHaveBeenCalledWith(
      'Your browser does not support download!',
    );
    expect(clickedAnchors).toHaveLength(0);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('chrome 走锚点下载并从地址推导文件名', /** 未给文件名时取 URL 最后一段。 */ async () => {
    setUserAgent(UA.chrome);

    await downloadFileFromUrl({ source: 'https://host.com/files/a.png' });

    expect(anchorAt(0).download).toBe('a.png');
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('safari 同样走锚点下载', /** Safari 与 Chrome 走同一条通道。 */ async () => {
    setUserAgent(UA.safari);

    await downloadFileFromUrl({ source: 'https://host.com/files/a.png' });

    expect(anchorAt(0).download).toBe('a.png');
  });

  it('显式文件名优先于地址推导', /** 业务上给出的中文名比地址里的编码名更可读。 */ async () => {
    setUserAgent(UA.chrome);

    await downloadFileFromUrl({
      fileName: '报表.png',
      source: 'https://host.com/files/a.png',
    });

    expect(anchorAt(0).download).toBe('报表.png');
  });

  it('地址以斜杠结尾时回退到默认文件名', /** 目录地址推不出文件名。 */ async () => {
    setUserAgent(UA.chrome);

    await downloadFileFromUrl({ source: 'https://host.com/files/' });

    expect(anchorAt(0).download).toBe('downloaded_file');
  });

  it('其它浏览器给地址补上 download 参数并新开窗口', /** 老浏览器没有锚点下载能力。 */ async () => {
    setUserAgent(UA.firefox);

    await downloadFileFromUrl({ source: 'https://host.com/a.png' });

    expect(openWindow).toHaveBeenCalledWith('https://host.com/a.png?download', {
      target: '_blank',
    });
    expect(clickedAnchors).toHaveLength(0);
  });

  it('地址已带查询串时不重复追加参数', /** 已有参数再追加会破坏签名。 */ async () => {
    setUserAgent(UA.firefox);

    await downloadFileFromUrl({ source: 'https://host.com/a.png?token=1' });

    expect(openWindow).toHaveBeenCalledWith('https://host.com/a.png?token=1', {
      target: '_blank',
    });
  });

  it('按传入的 target 打开窗口', /** 调用方可以要求在当前窗口打开。 */ async () => {
    setUserAgent(UA.firefox);

    await downloadFileFromUrl({
      source: 'https://host.com/a.png',
      target: '_self',
    });

    expect(openWindow).toHaveBeenCalledWith('https://host.com/a.png?download', {
      target: '_self',
    });
  });
});

describe('downloadFileFromBase64', /** 直接用 Base64 串触发下载。 */ () => {
  it('数据为空时抛错', /** 空数据下载会得到一个 0 字节文件。 */ () => {
    expect(
      /** 传空数据验证入参校验。 */ () =>
        downloadFileFromBase64({ source: '' }),
    ).toThrow('Invalid Base64 data.');
  });

  it('未给文件名时使用默认名', /** 调用方没给名字时不能生成空文件名。 */ () => {
    downloadFileFromBase64({ source: 'QUJD' });

    expect(anchorAt(0).download).toBe('downloaded_file');
  });

  it('按给定文件名下载', /** 业务文件名优先。 */ () => {
    downloadFileFromBase64({ fileName: 'a.txt', source: 'QUJD' });

    expect(anchorAt(0).download).toBe('a.txt');
  });
});

describe('downloadFileFromBlob', /** 用 Blob 触发下载，临时地址由浏览器生成。 */ () => {
  it('不是 Blob 时抛 TypeError', /** 类型不符说明调用方传错了通道。 */ () => {
    expect(
      /** 传入字符串验证通道类型校验。 */ () =>
        downloadFileFromBlob({ source: 'not-a-blob' }),
    ).toThrow(TypeError);
  });

  it('为 Blob 生成对象地址并下载', /** 下载地址必须来自 createObjectURL。 */ () => {
    const blob = new Blob(['abc'], { type: 'text/plain' });

    downloadFileFromBlob({ fileName: 'a.txt', source: blob });

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchorAt(0).href).toBe('blob:mock/1');
  });

  it('未给文件名时使用默认名', /** 默认名保证浏览器不会取到空名字。 */ () => {
    downloadFileFromBlob({ source: new Blob(['abc']) });

    expect(anchorAt(0).download).toBe('downloaded_file');
  });
});

describe('downloadFileFromBlobPart', /** 兼容 Blob、字符串及其它 BlobPart，非 Blob 会被包一层。 */ () => {
  it('已经是 Blob 时直接使用', /** 重复包装会丢失调用方指定的类型。 */ () => {
    const blob = new Blob(['abc'], { type: 'text/csv' });

    downloadFileFromBlobPart({ fileName: 'a.csv', source: blob });

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('非 Blob 内容按二进制流包装', /** 字符串内容要包成 Blob 才能生成下载地址。 */ () => {
    downloadFileFromBlobPart({ fileName: 'a.txt', source: 'abc' });

    const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0] ?? [];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob).toHaveProperty('type', 'application/octet-stream');
  });

  it('未给文件名时使用默认名', /** 与其它下载通道保持同一默认名。 */ () => {
    downloadFileFromBlobPart({ source: 'abc' });

    expect(anchorAt(0).download).toBe('downloaded_file');
  });
});

describe('dataURLtoBlob', /** 把 data URL 还原成带 MIME 类型的 Blob。 */ () => {
  it('还原出正确的 MIME 与字节长度', /** 字节数必须与解码结果一致。 */ () => {
    const blob = dataURLtoBlob('data:image/png;base64,iVBORw0KGgo=');

    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(8);
  });
});

describe('urlToBase64', /** 把图片地址转成 Base64，需要图片解码完成与可用的画布。 */ () => {
  it('解码后返回画布导出的数据地址', /** 输出即画布的 toDataURL 结果。 */ () => {
    stubAllCanvases('data:image/png;base64,AAA');
    const pending = urlToBase64('https://host.com/a.png');

    imageAt(0).emitLoad();

    return expect(pending).resolves.toBe('data:image/png;base64,AAA');
  });

  it('按传入的类型导出', /** jpg 等其它格式需要显式指定导出类型。 */ () => {
    stubAllCanvases('data:image/jpeg;base64,BBB');
    const pending = urlToBase64('https://host.com/a.png', 'image/jpeg');

    imageAt(0).emitLoad();

    return expect(pending).resolves.toBe('data:image/jpeg;base64,BBB');
  });

  it('图片地址被写入图片对象', /** 地址是解码的输入来源。 */ () => {
    stubAllCanvases('data:image/png;base64,AAA');
    const pending = urlToBase64('https://host.com/a.png');

    expect(imageAt(0).src).toBe('https://host.com/a.png');
    imageAt(0).emitLoad();

    return pending;
  });

  it('画布上下文不可用时拒绝', /** 拿不到上下文就无法导出，必须失败而不是返回空串。 */ () => {
    stubAllCanvases('', true);
    const pending = urlToBase64('https://host.com/a.png');

    imageAt(0).emitLoad();

    return expect(pending).rejects.toThrow('Failed to create canvas.');
  });
});

describe('downloadFileFromImageUrl', /** 图片地址先转 Base64 再走 Base64 下载通道。 */ () => {
  it('用转换后的 Base64 作为下载地址', /** 下载地址必须是画布导出的数据地址。 */ async () => {
    stubAllCanvases('data:image/png;base64,AAA');

    const pending = downloadFileFromImageUrl({
      source: 'https://host.com/a.png',
    });
    emitAllLoads();
    await pending;

    expect(anchorAt(0).href).toBe('data:image/png;base64,AAA');
  });

  it('未指定文件名时走 Base64 通道的默认名', /** 本函数不自行命名，命名由 Base64 通道决定。 */ async () => {
    stubAllCanvases('data:image/png;base64,AAA');

    const pending = downloadFileFromImageUrl({
      source: 'https://host.com/a.png',
    });
    emitAllLoads();
    await pending;

    expect(anchorAt(0).download).toBe('downloaded_file');
  });

  it('按调用方给的文件名下载', /** 显式文件名优先于默认名。 */ async () => {
    stubAllCanvases('data:image/png;base64,AAA');

    const pending = downloadFileFromImageUrl({
      fileName: 'avatar.png',
      source: 'https://host.com/a.png',
    });
    emitAllLoads();
    await pending;

    expect(anchorAt(0).download).toBe('avatar.png');
  });
});

describe('downloadImageByCanvas', /** 把图片画到画布上再导出，跨域图片据此绕过防盗链。 */ () => {
  it('默认带上图片的宽高绘制', /** 画布尺寸跟随图片，保证导出不失真。 */ () => {
    stubAllCanvases('data:image/png;base64,AAA');

    downloadImageByCanvas({ url: 'https://host.com/a.png' });
    const image = imageAt(0);
    image.width = 320;
    image.height = 240;
    image.emitLoad();
    emitAllLoads();

    expect(contextAt(0).drawImage).toHaveBeenCalledWith(image, 0, 0, 320, 240);
  });

  it('按传入尺寸设置画布', /** 调用方可以指定导出分辨率。 */ () => {
    stubAllCanvases('data:image/png;base64,AAA');

    downloadImageByCanvas({
      canvasHeight: 100,
      canvasWidth: 200,
      url: 'https://host.com/a.png',
    });
    const image = imageAt(0);
    image.width = 320;
    image.height = 240;
    image.emitLoad();
    emitAllLoads();

    expect(canvasAt(0).width).toBe(200);
    expect(canvasAt(0).height).toBe(100);
    expect(contextAt(0).drawImage).toHaveBeenCalledWith(image, 0, 0, 320, 240);
  });

  it('尺寸为 0 时回退到图片自身尺寸', /** 0 是未指定而不是要真的画成 0 宽。 */ async () => {
    stubAllCanvases('data:image/png;base64,AAA');

    downloadImageByCanvas({
      canvasHeight: 0,
      canvasWidth: 0,
      url: 'https://host.com/a.png',
    });
    const image = imageAt(0);
    image.width = 320;
    image.height = 240;
    image.emitLoad();
    emitAllLoads();
    await flushMicrotasks();

    expect(canvasAt(0).width).toBe(320);
    expect(canvasAt(0).height).toBe(240);
    expect(anchorAt(0).download).toBe('image.png');
  });

  it('关闭宽高时按原尺寸绘制', /** 不带宽高是浏览器 drawImage 的原生语义。 */ () => {
    stubAllCanvases('data:image/png;base64,AAA');

    downloadImageByCanvas({
      drawWithImageSize: false,
      url: 'https://host.com/a.png',
    });
    const image = imageAt(0);
    image.width = 320;
    image.height = 240;
    image.emitLoad();
    emitAllLoads();

    expect(contextAt(0).drawImage).toHaveBeenCalledWith(image, 0, 0);
  });

  it('绘制前先清空画布', /** 复用画布时残留内容会叠加到导出结果里。 */ () => {
    stubAllCanvases('data:image/png;base64,AAA');

    downloadImageByCanvas({ url: 'https://host.com/a.png' });
    const image = imageAt(0);
    image.width = 320;
    image.height = 240;
    image.emitLoad();
    emitAllLoads();

    expect(contextAt(0).clearRect).toHaveBeenCalledWith(0, 0, 320, 240);
  });

  it('画布上下文不可用时绘制失败', /** 没有上下文就无法导出，必须暴露失败而不是静默产出空文件。 */ () => {
    stubAllCanvases('', true);

    downloadImageByCanvas({ url: 'https://host.com/a.png' });
    const image = imageAt(0);
    image.width = 320;
    image.height = 240;

    expect(
      /** 触发解码完成，绘制阶段应当失败。 */
      () => image.emitLoad(),
    ).toThrow(TypeError);
  });
});

describe('base64ToFile', /** 把 data URL 还原成可上传的 File，非法输入必须给明确报错。 */ () => {
  it('还原出带后缀与 MIME 的文件', /** 后缀与类型都来自 data URL 的声明。 */ () => {
    const file = base64ToFile('data:image/png;base64,QUJD', 'avatar');

    expect(file.name).toBe('avatar.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(3);
  });

  it('空字符串抛错', /** 空输入会得到 0 字节文件。 */ () => {
    expect(
      /** 传空串验证入参校验。 */ () => base64ToFile('', 'avatar'),
    ).toThrow('base64 参数必须是非空字符串');
  });

  it('缺少逗号分隔时抛错', /** 纯 Base64 串没有 MIME，无法确定文件类型。 */ () => {
    expect(
      /** 传入不含逗号的字符串验证格式校验。 */
      () => base64ToFile('QUJD', 'avatar'),
    ).toThrow('无效的 base64 格式');
  });

  it('前缀里没有类型时抛错', /** 声明为空同样无法确定类型。 */ () => {
    expect(
      /** 传入无类型的 data URL 验证类型解析失败。 */ () =>
        base64ToFile('data:;base64,QUJD', 'avatar'),
    ).toThrow('无法解析 base64 类型信息');
  });

  it('mIME 缺少子类型时抛错', /** 拼不出文件后缀。 */ () => {
    expect(
      /** 传入缺少斜杠的 MIME 验证格式校验。 */ () =>
        base64ToFile('data:imagepng;base64,QUJD', 'avatar'),
    ).toThrow('无效的 MIME 类型格式');
  });

  it('解码失败时抛出带原因的错误', /** 底层异常要透出原因，便于定位是数据还是编码问题。 */ () => {
    vi.spyOn(window, 'atob').mockImplementation(
      /** 模拟 atob 拒绝非法 Base64。 */ () => {
        throw new TypeError('invalid base64');
      },
    );

    expect(
      /** 格式合法但内容无法解码，验证错误包装。 */ () =>
        base64ToFile('data:image/png;base64,%%%', 'avatar'),
    ).toThrow('Base64 解码失败: invalid base64');
  });

  it('解码抛出非 Error 时给出未知错误文案', /** 非 Error 异常也要能拼出可读信息。 */ () => {
    vi.spyOn(window, 'atob').mockImplementation(
      /** 模拟第三方抛出的非 Error 异常。 */ () => {
        throw nonErrorFailure();
      },
    );

    expect(
      /** 模拟第三方抛出的非 Error 异常时调用。 */
      () => base64ToFile('data:image/png;base64,QUJD', 'avatar'),
    ).toThrow('Base64 解码失败: 未知错误');
  });
});
