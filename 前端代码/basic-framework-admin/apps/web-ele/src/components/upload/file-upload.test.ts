/**
 * 文件上传组件完成项唯一标识的真实回归测试。
 *
 * 挂载真实 `FileUpload` 与真实 `ElUpload`，只替换图标、文案与消息提示，
 * 锁定已确认缺陷：上传成功后不能用 `Date.now()` 作为完成项标识。
 * 同一毫秒完成的两个文件会拿到相同标识，而 Element Plus 删除时按 uid 过滤
 * （`use-handlers` 的 `removeFile` 会一次性过滤掉所有同 uid 项），删除一个会连带移除另一个。
 */
import type { UploadFile } from 'element-plus';

import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { ElUpload } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FileUpload from './file-upload.vue';

/** 两个文件共享的毫秒时间戳：把批次内两次上传的完成时刻固定在同一毫秒。 */
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
 * 通过真实文件输入框“选择”一批文件，并等待上传链路完成。
 * happy-dom 不允许直接赋值 `input.files`，因此用属性定义注入选中的文件集合。
 * @param target 已挂载的上传组件。
 * @param files 本次要选择的原始文件，顺序即 Element Plus 分配 uid 的顺序。
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

describe('文件上传完成项标识', /** 同一毫秒完成的多文件上传必须各自持有唯一标识，删除只影响目标文件。 */ () => {
  it('同一毫秒完成的两个文件 uid 不同，删除一个不影响另一个（缺陷回归）', /** 用固定毫秒时间戳复现 Date.now() 冲突，再通过真实删除图标验证只删掉目标项。 */ async () => {
    vi.spyOn(Date, 'now').mockReturnValue(SAME_MILLISECOND);
    wrapper = mount(FileUpload, {
      props: {
        /** 上传接口替身：按文件名返回稳定地址，不发起真实网络请求。 */
        api: async (file: File) => `https://files.test/${file.name}`,
        maxNumber: 2,
        multiple: true,
      },
    });

    await selectFiles(wrapper, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
    ]);

    const files = readFileList(wrapper);
    expect(files).toHaveLength(2);
    // 关键断言：同一毫秒完成也不能共享标识。
    expect(files.at(0)?.uid).not.toBe(files.at(1)?.uid);
    expect(
      files.map(/** 取出完成项文件名，核对批次顺序。 */ (item) => item.name),
    ).toEqual(['a.txt', 'b.txt']);

    await removeByIcon(wrapper, 0);

    const remaining = readFileList(wrapper);
    expect(remaining).toHaveLength(1);
    expect(remaining.at(0)?.name).toBe('b.txt');
    expect(wrapper.findAll('.el-upload-list__item')).toHaveLength(1);
    expect(wrapper.text()).toContain('b.txt');
  });
});
