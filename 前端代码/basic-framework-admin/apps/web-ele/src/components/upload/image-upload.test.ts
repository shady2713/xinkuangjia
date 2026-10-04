/**
 * 图片上传组件（apps/web-ele 的 upload/image-upload）真实行为回归。
 *
 * 组件在文件上传能力之上提供卡片式列表与图片预览：绑定值重建决定页面初始显示哪些图片，
 * 内部操作标记决定删除/上传回写是否与外部值形成回环，预览在缺少地址时必须回退到本地
 * 文件生成 base64，上传前校验决定哪些文件允许进入上传链路，取值组装决定表单收到字符串
 * 还是数组。用例挂载真实 `ImageUpload` 与真实 `ElUpload`，只替换图标、文案与消息提示，
 * 绑定值重建、预览、校验分支、失败路径与返回值组装全部真实执行。
 */
import type { UploadFile } from 'element-plus';

import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { ElDialog, ElUpload } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { showError, showErrorMessage } from '#/utils/feedback';

import ImageUpload from './image-upload.vue';

/** 两张图片共享的毫秒时间戳：把批次内两次上传的完成时刻固定在同一毫秒。 */
const SAME_MILLISECOND = 1_700_000_000_000;

vi.hoisted(
  /**
   * `use-upload` 在模块加载期读取运行时配置（上传模式与接口地址），
   * 因此必须在组件被导入之前建立最小替身；该配置只在首次导入时读取一次。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_GLOB_API_URL: '/api',
      VITE_UPLOAD_TYPE: 'server',
    });
  },
);

vi.mock(
  '@vben/icons',
  /** 图标与上传链路无关，替换成可点击的最小元素。 */ () => ({
    IconifyIcon: { name: 'IconifyIcon', template: '<i data-test="icon"></i>' },
  }),
);

vi.mock(
  '@vben/locales',
  /**
   * 只把文案函数替换成返回键名，保留语言包加载等其余真实能力：
   * 组件依赖链上的 `#/locales` 会用到 `loadLocalesMapFromDir`。
   */
  async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vben/locales')>();
    return {
      ...actual,
      /** 返回键名，使断言不依赖真实语言包。 */
      $t: (key: string) => key,
    };
  },
);

vi.mock(
  '#/utils/feedback',
  /** 消息提示会向 document.body 追加节点，测试中只记录调用。 */ () => ({
    showError: vi.fn(),
    showErrorMessage: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

/** 当前用例挂载的上传组件；用例结束统一卸载，避免残留组件影响后续用例。 */
let wrapper: undefined | VueWrapper;

afterEach(
  /** 卸载组件、还原时间替身并清空 DOM。 */
  () => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  },
);

/**
 * 通过真实文件输入框“选择”一批图片，并等待上传链路完成。
 * happy-dom 不允许直接赋值 `input.files`，因此用属性定义注入选中的文件集合。
 * @param target 已挂载的上传组件。
 * @param files 本次要选择的原始图片，顺序即 Element Plus 分配 uid 的顺序。
 */
async function selectFiles(target: VueWrapper, files: File[]) {
  const input = target.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: files,
  });
  await input.trigger('change');
  await flushPromises();
}

/**
 * 读取 ElUpload 当前持有的文件列表。
 * `v-model:file-list` 双向绑定到组件内部列表，这里读到的是参与删除过滤的真实数据。
 * @param target 已挂载的上传组件。
 * @returns 当前文件列表项，每项都带 Element Plus 生成或组件写入的 uid。
 */
function readFileList(target: VueWrapper): UploadFile[] {
  return target.getComponent(ElUpload).props('fileList') as UploadFile[];
}

/**
 * 点击真实列表项上的关闭图标，走 ElUpload 的 uid 过滤删除链路。
 * @param target 已挂载的上传组件。
 * @param index 要删除的列表项下标。
 */
async function removeByIcon(target: VueWrapper, index: number) {
  const icons = target.findAll('.el-upload-list__item .el-icon--close');
  await icons[index]?.trigger('click');
  await flushPromises();
}

/**
 * 点击真实列表项上的预览图标，走 ElUpload 的预览链路。
 * @param target 已挂载的上传组件。
 * @param index 要预览的列表项下标。
 */
async function previewByIcon(target: VueWrapper, index: number) {
  const icons = target.findAll('.el-upload-list__item-preview');
  await icons[index]?.trigger('click');
  await flushPromises();
}

describe('图片上传完成项标识', /** 同一毫秒完成的多图片上传必须各自持有唯一标识，删除只影响目标图片。 */ () => {
  it('同一毫秒完成的两张图片 uid 不同，删除一张不影响另一张（缺陷回归）', /** 用固定毫秒时间戳复现 Date.now() 冲突，再通过真实删除图标验证只删掉目标项。 */ async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SAME_MILLISECOND);
    wrapper = mount(ImageUpload, {
      props: {
        /** 上传接口替身：按文件名返回稳定地址，不发起真实网络请求。 */
        api: async (file: File) => `https://files.test/${file.name}`,
        maxNumber: 2,
        multiple: true,
      },
    });

    await selectFiles(wrapper, [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ]);

    const files = readFileList(wrapper);
    expect(files).toHaveLength(2);
    // 关键断言：同一毫秒完成也不能共享标识。
    expect(files.at(0)?.uid).not.toBe(files.at(1)?.uid);
    expect(
      files.map(/** 取出完成项文件名，核对批次顺序。 */ (item) => item.name),
    ).toEqual(['a.png', 'b.png']);

    await removeByIcon(wrapper, 0);

    const remaining = readFileList(wrapper);
    expect(remaining).toHaveLength(1);
    expect(remaining.at(0)?.name).toBe('b.png');
    expect(wrapper.findAll('.el-upload-list__item')).toHaveLength(1);
    // 卡片列表用缩略图展示已完成的图片，地址即被保留项的地址。
    expect(wrapper.get('.el-upload-list__item img').attributes('src')).toBe(
      'https://files.test/b.png',
    );
  });
});

describe('绑定值重建图片列表', /** 绑定值决定页面初始显示哪些图片，重建错会让用户看不到已有图片。 */ () => {
  it('字符串绑定值按地址解析出文件名并可预览', /** 单个地址字符串未归一化会让列表直接空白。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: { maxNumber: 2, value: 'https://files.test/dir/图片.png' },
    });

    const files = readFileList(wrapper);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: '图片.png',
      status: 'success',
      url: 'https://files.test/dir/图片.png',
    });

    await previewByIcon(wrapper, 0);

    expect(wrapper.get('.el-dialog__title').text()).toBe('图片.png');
    expect(wrapper.get('.el-dialog img').attributes('src')).toBe(
      'https://files.test/dir/图片.png',
    );
  });

  it('对象形式的列表项按既有字段透传', /** 表单回填的对象项被丢弃会让编辑页看不到已上传图片。 */ () => {
    wrapper = mount(ImageUpload, {
      props: {
        maxNumber: 3,
        value: [
          { name: '已上传.png', uid: 7, url: 'https://files.test/a.png' },
          { name: '无名项' },
          // 无法识别的元素必须被剔除，不能作为列表项进入渲染。
          0,
        ] as unknown as string[],
      },
    });

    const files = readFileList(wrapper);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      name: '已上传.png',
      uid: 7,
      url: 'https://files.test/a.png',
    });
    // 缺少 uid 时按数组下标生成稳定的负数标识，避免与真实 uid 冲突。
    expect(files[1]?.uid).toBe(-1);
    expect(files[1]?.status).toBe('success');
  });

  it('组件自身触发的变更复位标记后不再重建列表', /** 不回环才能让删除结果稳定，否则删除会被外部旧值覆盖。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: {
        maxNumber: 3,
        value: ['https://files.test/a.png', 'https://files.test/b.png'],
      },
    });
    expect(readFileList(wrapper)).toHaveLength(2);

    await removeByIcon(wrapper, 0);
    expect(readFileList(wrapper)).toHaveLength(1);
    expect(wrapper.emitted('delete')).toHaveLength(1);

    // 删除已把内部标记置位：紧接着的外部回写只复位标记，不重建列表、不再抛事件。
    wrapper.setProps({
      value: ['https://files.test/a.png', 'https://files.test/b.png'],
    });
    await flushPromises();

    expect(readFileList(wrapper)).toHaveLength(1);
    expect(wrapper.emitted('change')).toHaveLength(1);
  });

  it('初始化不通知变更、外部值变化恰好通知一次', /** 初始化被当成用户修改会误报表单变更，外部变化不通知会让表单一直拿到旧图片列表。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: { maxNumber: 3, value: ['https://files.test/a.png'] },
    });

    // 首次渲染只建立内部列表，此时不得抛出变更事件。
    expect(wrapper.emitted('change')).toBeUndefined();

    wrapper.setProps({ value: ['https://files.test/b.png'] });
    await flushPromises();

    const files = readFileList(wrapper);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('b.png');
    // 外部变化必须恰好通知一次，载荷是新值。
    expect(wrapper.emitted('change')).toEqual([[['https://files.test/b.png']]]);

    // 调用方按 v-model 把同一载荷写回时值没有变化，不得再次通知，避免双向绑定回环。
    wrapper.setProps({
      value: wrapper.emitted('change')?.[0]?.[0] as string[],
    });
    await flushPromises();

    expect(wrapper.emitted('change')).toHaveLength(1);
  });
});

describe('图片预览', /** 预览决定用户能否确认已上传的图片内容，缺少兜底会让预览失败。 */ () => {
  it('无地址但保留原始文件时用 base64 兜底预览', /** 上传中的图片没有地址，不回退到本地文件会让预览空白。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: {
        api: vi.fn(
          /**
           * 上传接口替身：保持挂起，使列表项停留在"有原始文件、无地址"的上传中状态。
           * @returns 永不结算的上传结果。
           */
          () =>
            new Promise<never>(/** 永不结算，模拟上传仍在进行中。 */ () => {}),
        ),
        maxNumber: 1,
        // 文本列表不会为上传中的文件生成 blob 地址，才能走本地文件的 base64 兜底分支。
        listType: 'text',
      },
    });

    await selectFiles(wrapper, [
      new File(['png-bytes'], 'raw.png', { type: 'image/png' }),
    ]);

    const files = readFileList(wrapper);
    expect(files).toHaveLength(1);
    expect(files[0]?.url).toBeUndefined();
    expect(files[0]?.raw).toBeDefined();

    const target = wrapper;
    await target.get('.el-upload-list__item-name').trigger('click');

    // FileReader 的 load 是宏任务，等待弹窗里出现真实生成的 base64 地址。
    await vi.waitFor(
      /** 等待读取本地文件并打开预览弹窗。 */ () => {
        expect(target.find('.el-dialog img').attributes('src')).toMatch(
          /^data:image\/png;base64,/u,
        );
      },
      { timeout: 2000 },
    );
    expect(target.get('.el-dialog__title').text()).toBe('raw.png');
  });

  it('缺少文件名时按地址推导预览标题', /** 标题为空会让预览弹窗没有可识别的标题。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: {
        maxNumber: 2,
        value: [
          { url: 'https://files.test/dir/推导.png' },
        ] as unknown as string[],
      },
    });

    await previewByIcon(wrapper, 0);

    expect(wrapper.get('.el-dialog__title').text()).toBe('推导.png');
  });

  it('既无地址也无原始文件时不打开预览', /** 对空文件调用 FileReader 会抛错并让弹窗停在错误状态。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: {
        maxNumber: 2,
        value: [{ name: '无地址.png' }] as unknown as string[],
      },
    });

    await previewByIcon(wrapper, 0);

    expect(wrapper.find('.el-dialog').exists()).toBe(false);
  });

  it('关闭预览弹窗时清空标题并收起弹窗', /** 标题残留会让下一次预览先闪出上一张图片的名字。 */ async () => {
    wrapper = mount(ImageUpload, {
      // 对话框的 close 与 update:modelValue 由真实过渡钩子发出，必须关闭 VTU 对 Transition 的默认桩化。
      global: { stubs: { transition: false } },
      props: { maxNumber: 2, value: 'https://files.test/dir/图片.png' },
    });
    await previewByIcon(wrapper, 0);
    expect(wrapper.get('.el-dialog__title').text()).toBe('图片.png');

    await wrapper.get('.el-dialog__headerbtn').trigger('click');

    // 关闭事件由真实过渡钩子发出，等待组件清空标题并把弹窗收起来。
    const target = wrapper;
    await vi.waitFor(
      /** 等待关闭过渡结束后组件清空标题并隐藏遮罩。 */ () => {
        expect(target.get('.el-dialog__title').text()).toBe('');
        expect(target.get('.el-overlay').attributes('style')).toContain(
          'display: none',
        );
      },
      { timeout: 2000 },
    );
    expect(target.findComponent(ElDialog).props('modelValue')).toBe(false);
  });
});

describe('上传前校验', /** 校验决定哪些图片允许进入上传链路，漏判会让非法文件占用服务端资源。 */ () => {
  it('数量上限为 0 时组件自身拒绝上传', /** 禁用上传的配置必须由组件自己兜底，不能因为外部控件放行就真的上传。 */ async () => {
    const api = vi.fn();
    wrapper = mount(ImageUpload, { props: { api, maxNumber: 0 } });

    await selectFiles(wrapper, [
      new File(['a'], 'a.png', { type: 'image/png' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.maxNumber');
    expect(api).not.toHaveBeenCalled();
  });

  it('类型不在白名单时拒绝上传并提示允许的类型', /** 类型校验失效会让可执行文件被当作图片上传。 */ async () => {
    const api = vi.fn();
    wrapper = mount(ImageUpload, {
      props: { accept: ['png'], api, maxNumber: 2 },
    });

    await selectFiles(wrapper, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.acceptUpload');
    expect(api).not.toHaveBeenCalled();
  });

  it('超过大小上限时拒绝上传并提示上限', /** 大小校验失效会让超大文件打满服务端存储。 */ async () => {
    const api = vi.fn();
    wrapper = mount(ImageUpload, {
      // 白名单按扩展名比较，写成带点的形式会被真实校验判为不匹配。
      props: { accept: ['png'], api, maxNumber: 2, maxSize: 0.001 },
    });

    await selectFiles(wrapper, [
      new File(['x'.repeat(2048)], 'big.png', { type: 'image/png' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.maxSizeMultiple');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('上传失败路径', /** 失败路径决定用户能否知道上传没成功以及列表是否留下错误的成功状态。 */ () => {
  it('上传请求失败时提示错误并移除失败项', /** 失败不提示会让用户以为图片已上传，保留失败项会污染图片值。 */ async () => {
    const error = new Error('图片上传接口不可用');
    const api = vi.fn().mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 屏蔽组件自身的错误日志，只保留断言所需的调用记录。 */ () => {},
      );
    wrapper = mount(ImageUpload, { props: { api, maxNumber: 2 } });

    await selectFiles(wrapper, [
      new File(['a'], 'a.png', { type: 'image/png' }),
    ]);

    expect(api).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(error, 'ui.upload.uploadError');
    // Element Plus 的失败处理会把失败项移出列表，组件自身不得再抛成功类的变更事件。
    expect(readFileList(wrapper)).toHaveLength(0);
    expect(wrapper.emitted('change')).toBeUndefined();
    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('返回值格式', /** 返回格式由单值/多值与绑定参数共同决定，写错会让表单收到错误形状的值。 */ () => {
  it('单值模式下字符串绑定值返回单个地址', /** 单值表单收到数组会让后端字段解析失败。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: { maxNumber: 1, value: 'https://files.test/a.png' },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toBe('');
  });

  it('单值模式下数组绑定值返回单个地址', /** 数组绑定同样按单值口径返回，不能返回空数组。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: {
        maxNumber: 1,
        value: ['https://files.test/a.png'] as unknown as string,
      },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toBe('');
  });

  it('多值模式下数组 modelValue 返回数组', /** 多值表单收到逗号字符串会让后端无法拆分多张图片。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: {
        maxNumber: 2,
        modelValue: ['https://files.test/a.png', 'https://files.test/b.png'],
      },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([
      'https://files.test/b.png',
    ]);
  });

  it('多值模式下字符串 modelValue 保持字符串形状', /** 字符串绑定必须保持字符串形状，返回数组会破坏调用方约定。 */ async () => {
    wrapper = mount(ImageUpload, {
      props: {
        maxNumber: 2,
        modelValue: 'https://files.test/a.png',
      },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('');
  });
});
