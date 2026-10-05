/**
 * 头像裁剪上传（components/cropper/cropper-avatar.vue）真实行为回归。
 *
 * 该组件展示圆形头像并把裁剪弹窗接进页面：宽度决定头像与上传图标的尺寸；点击头像或
 * 上传按钮打开弹窗；裁剪结果上传成功后要同步头像地址、抛 change 并提示成功。尺寸或
 * 同步链路写错会让用户看到破图，或换了头像却在别处仍是旧图。用例真实挂载组件，只把
 * 弹窗容器、图标、按钮、消息与语言边界替换为替身。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import CropperAvatar from './cropper-avatar.vue';

/** 上传接口替身签名。 */
type UploadApi = () => Promise<string>;

/** 弹窗替身记录的配置与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立可设置返回值、可断言的链式弹窗替身容器。 */ () => ({
    api: {
      close: vi.fn(),
      open: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 消息提示替身；上传成功后必须给出成功反馈。 */
const messageProbe = vi.hoisted(
  /** 建立可断言的成功提示实例。 */ () => ({ success: vi.fn() }),
);

/** 裁剪弹窗替身收到的属性；用例按此核对组件声明的连接契约。 */
const connectedProbe = vi.hoisted(
  /** 建立可读取属性的连接组件替身容器。 */ () => ({
    props: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器与注册机制，组件自身的开关与同步逻辑保持真实实现。 */ () => {
    const ConnectedStub = defineComponent({
      name: 'CropperModalStub',
      props: {
        /** 图片大小上限，单位 MB，由头像组件原样透传。 */
        size: { default: 0, type: Number },
        /** 待裁剪图片地址，弹窗打开前应等于当前头像。 */
        src: { default: '', type: String },
        /** 上传接口，弹窗确认时调用。 */
        uploadApi: { default: undefined, type: Function },
      },
      emits: ['upload-success'],
      /**
       * 记录收到的属性并渲染一个可触发上传成功的按钮。
       * @param props 连接组件替身声明的属性。
       * @param context 组件上下文，用于派发事件。
       * @param context.emit 组件事件派发函数。
       * @returns 连接组件替身渲染函数。
       */
      setup(props, { emit }) {
        connectedProbe.props = props;
        return /** 渲染可定位的上传成功入口。 */ () =>
          h('div', { class: 'cropper-modal-stub' }, [
            h(
              'button',
              {
                class: 'modal-upload-success',
                // 真实弹窗上传成功后派发同名事件，这里复刻同一契约。
                /** 模拟裁剪结果上传成功。 */
                onClick: () =>
                  emit('upload-success', {
                    data: 'https://files.test/DUMMY-avatar.png',
                    source: 'data:image/png;base64,DUMMY-cropped',
                  }),
              },
              '上传成功',
            ),
          ]);
      },
    });
    return {
      /**
       * 记录头像组件声明的弹窗配置并返回替身组件与替身实例。
       * @param options 头像组件传给 useVbenModal 的配置。
       * @returns 替身连接组件与替身 API 的二元组。
       */
      useVbenModal: (options: Record<string, unknown>) => {
        modalProbe.options = options;
        return [ConnectedStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '@vben/icons',
  /** 图标是纯展示边界，替换成最小可识别节点。 */ () => ({
    IconifyIcon: defineComponent({
      name: 'IconifyIconStub',
      /**
       * 渲染带标记的图标占位节点。
       * @returns 图标替身渲染函数。
       */
      setup() {
        return /** 渲染图标占位节点。 */ () =>
          h('i', { class: 'iconify-stub' });
      },
    }),
  }),
);

vi.mock(
  '@vben/locales',
  /** 只替换翻译边界，断言读取的语言键而不是绑定具体译文。 */ () => ({
    /**
     * 回显语言键，便于核对组件请求的文案键。
     * @param key 组件请求的语言键。
     * @returns 语言键本身。
     */
    $t: (key: string) => key,
  }),
);

vi.mock(
  'element-plus',
  /** 只替换按钮与消息提示边界，组件自身的调用时机保持真实实现。 */ () => ({
    ElAvatar: defineComponent({
      name: 'ElAvatarStub',
      /**
       * 渲染头像占位节点。
       * @returns 头像替身渲染函数。
       */
      setup() {
        return /** 渲染头像占位节点。 */ () =>
          h('span', { class: 'el-avatar' });
      },
    }),
    ElButton: defineComponent({
      name: 'ElButtonStub',
      /**
       * 渲染按钮节点并透出插槽文案。
       * @param _props 按钮属性，替身不解释，透传给根节点供断言。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 按钮传入的插槽表。
       * @returns 按钮替身渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染按钮节点与插槽文案。 */ () =>
          h('button', { class: 'el-button-stub' }, slots.default?.());
      },
    }),
    ElMessage: messageProbe,
    ElSpace: defineComponent({
      name: 'ElSpaceStub',
      /**
       * 渲染间距容器。
       * @param _props 间距属性，替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 容器插槽表。
       * @returns 间距容器渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染间距容器与内容。 */ () =>
          h('div', { class: 'el-space-stub' }, slots.default?.());
      },
    }),
    ElTooltip: defineComponent({
      name: 'ElTooltipStub',
      /**
       * 渲染提示容器。
       * @param _props 提示属性，替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 容器插槽表。
       * @returns 提示容器渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染提示容器与内容。 */ () =>
          h('div', { class: 'el-tooltip-stub' }, slots.default?.());
      },
    }),
    ElUpload: defineComponent({
      name: 'ElUploadStub',
      /**
       * 渲染上传容器。
       * @param _props 上传属性，替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 容器插槽表。
       * @returns 上传容器渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染上传容器与内容。 */ () =>
          h('div', { class: 'el-upload-stub' }, slots.default?.());
      },
    }),
  }),
);

beforeEach(
  /** 清空替身调用与记录，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    connectedProbe.props = undefined;
    modalProbe.api.open.mockResolvedValue(undefined);
    modalProbe.api.close.mockResolvedValue(undefined);
  },
);

/**
 * 挂载头像组件并等待首次渲染完成。
 * @param options 挂载选项，用于传入属性。
 * @returns 已挂载的头像组件包装器。
 */
async function mountAvatar(options: Parameters<typeof mount>[1] = {}) {
  const wrapper = mount(CropperAvatar, options);
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('头像尺寸契约', /** 头像与上传图标尺寸不匹配会破坏个人中心的布局。 */ () => {
  it('数值宽度按像素写入头像容器与图片包装器', /** 缺少 px 会让头像塌陷成不可点击的小块。 */ async () => {
    const wrapper = await mountAvatar({ props: { width: 200 } });

    const container = wrapper.find('div');
    const imageWrapper = wrapper.find('.overflow-hidden');
    expect(container.attributes('style')).toContain('width: 200px');
    expect(imageWrapper.attributes('style')).toContain('width: 200px');
    expect(imageWrapper.attributes('style')).toContain('height: 200px');
    expect(wrapper.find('.iconify-stub').attributes('style')).toContain(
      'width: 100px',
    );
    expect(wrapper.find('.iconify-stub').attributes('style')).toContain(
      'height: 100px',
    );
    expect(wrapper.find('.iconify-stub').attributes('style')).toContain(
      'line-height: 100px',
    );
  });

  it('带单位的宽度不会重复拼接 px', /** 出现 300pxpx 会让头像尺寸失效。 */ async () => {
    const wrapper = await mountAvatar({ props: { width: '300px' } });

    const container = wrapper.find('div');
    expect(container.attributes('style')).toContain('width: 300px');
    expect(wrapper.find('.iconify-stub').attributes('style')).toContain(
      'width: 150px',
    );
  });
});

describe('头像与按钮展示', /** 头像地址与上传入口的展示直接决定用户能否完成换头像。 */ () => {
  it('未设置头像时不渲染图片节点', /** 无地址仍渲染图片会显示破图。 */ async () => {
    const wrapper = await mountAvatar({ props: { value: '' } });

    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('已有头像时按地址渲染图片', /** 地址未绑定会让用户看不到当前头像。 */ async () => {
    const wrapper = await mountAvatar({
      props: { value: 'https://files.test/DUMMY-old.png' },
    });

    const image = wrapper.find('img');
    expect(image.attributes('src')).toBe('https://files.test/DUMMY-old.png');
    expect(image.attributes('alt')).toBe('avatar');
  });

  it('把当前头像、大小上限与上传接口交给裁剪弹窗', /** 属性漏传会让弹窗拿不到原图或放宽大小限制。 */ async () => {
    const uploadApi = vi.fn();
    await mountAvatar({
      props: {
        size: 3,
        uploadApi,
        value: 'https://files.test/DUMMY-old.png',
      },
    });

    expect(connectedProbe.props).toMatchObject({
      size: 3,
      src: 'https://files.test/DUMMY-old.png',
      uploadApi,
    });
    expect(modalProbe.options?.connectedComponent).toBeDefined();
  });

  it('未提供上传接口时使用不做真实上传的空实现', /** 缺少默认实现会让仅展示头像的页面在点击时抛出。 */ async () => {
    await mountAvatar({});
    const uploadApi = connectedProbe.props?.uploadApi as undefined | UploadApi;

    await expect(uploadApi?.()).resolves.toBe('');
  });

  it('关闭上传按钮时只保留头像', /** 只读场景仍显示上传按钮会误导用户。 */ async () => {
    const wrapper = await mountAvatar({ props: { showBtn: false } });

    expect(wrapper.find('.el-button-stub').exists()).toBe(false);
  });

  it('未指定按钮文案时使用国际化默认文案', /** 默认文案缺失会让按钮显示语言键或空白。 */ async () => {
    const wrapper = await mountAvatar({});

    expect(wrapper.find('.el-button-stub').text()).toBe(
      'ui.cropper.selectImage',
    );
  });

  it('指定按钮文案与按钮属性时按调用方渲染', /** 覆盖失效会让调用方无法按场景调整按钮。 */ async () => {
    const wrapper = await mountAvatar({
      props: {
        btnProps: { plain: true, type: 'primary' },
        btnText: '更换头像',
      },
    });

    const button = wrapper.find('.el-button-stub');
    expect(button.text()).toBe('更换头像');
    expect(button.attributes('plain')).toBe('true');
    expect(button.attributes('type')).toBe('primary');
  });
});

describe('弹窗开关契约', /** 开关链路断开会让用户点击头像没有任何反应。 */ () => {
  it('点击头像打开裁剪弹窗', /** 头像是最主要的点击热区。 */ async () => {
    const wrapper = await mountAvatar({});

    await wrapper.find('.overflow-hidden').trigger('click');

    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('点击上传按钮打开裁剪弹窗', /** 按钮是键盘与触屏用户的主要入口。 */ async () => {
    const wrapper = await mountAvatar({});

    await wrapper.find('.el-button-stub').trigger('click');

    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('暴露打开与关闭弹窗的方法', /** 父组件需要主动收起弹窗时依赖该契约。 */ async () => {
    const wrapper = await mountAvatar({});
    const exposed = wrapper.vm as unknown as {
      /** 关闭弹窗方法签名。 */
      closeModal: () => void;
      /** 打开弹窗方法签名。 */
      openModal: () => void;
    };

    exposed.openModal();
    exposed.closeModal();

    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
  });
});

describe('头像同步契约', /** 上传成功后不同步会让页面各处显示不一致的头像。 */ () => {
  it('外部头像地址变化时抛出 update:value', /** 缺少回抛会让 v-model 失效，父组件状态永远停在旧值。 */ async () => {
    const wrapper = await mountAvatar({ props: { value: '' } });

    await wrapper.setProps({ value: 'https://files.test/DUMMY-new.png' });

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([
      'https://files.test/DUMMY-new.png',
    ]);
  });

  it('上传成功后同步头像地址、抛出 change 并提示成功', /** 三步缺一都会让用户以为头像没换成。 */ async () => {
    const wrapper = await mountAvatar({
      props: { value: 'https://files.test/DUMMY-old.png' },
    });

    await wrapper.find('.modal-upload-success').trigger('click');

    expect(wrapper.emitted('change')?.[0]?.[0]).toEqual({
      data: 'https://files.test/DUMMY-avatar.png',
      source: 'data:image/png;base64,DUMMY-cropped',
    });
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([
      'data:image/png;base64,DUMMY-cropped',
    ]);
    expect(wrapper.find('img').attributes('src')).toBe(
      'data:image/png;base64,DUMMY-cropped',
    );
    expect(messageProbe.success).toHaveBeenCalledWith(
      'ui.cropper.uploadSuccess',
    );
  });
});
