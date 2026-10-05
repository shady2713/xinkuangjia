/**
 * 个人资料卡片（views/_core/profile/modules/profile-user）真实行为回归。
 *
 * 卡片展示当前登录用户的头像、账号、角色、手机、邮箱、部门、岗位与两个时间字段，并接上
 * 头像裁剪上传链路：资料缺失时整块渲染会让用户在资料未加载时看到一堆空字段；角色或岗位
 * 列表未拼接会让多角色用户只看到第一项；岗位为空未回退为短横线会让界面出现空白或
 * undefined；头像兜底丢失会让未设置头像的用户看到破图；裁剪结果未上传或未同步资料会让
 * 用户换了头像却看不到变化。用例挂载真实卡片与真实 ElDescriptions，只替换图标、裁剪
 * 组件、上传边界、消息与网络边界。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { preferences } from '@vben/preferences';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateUserProfile } from '#/api/system/user/profile';

import ProfileUser from './profile-user.vue';

/** 上传边界与网络边界替身。 */
/** 头像上传回调参数：裁剪后的二进制与原始文件名。 */
interface AvatarUploadParams {
  /** 裁剪后的图片二进制。 */
  file: Blob;
  /** 原始文件名，上传时沿用以保持后端命名一致。 */
  filename: string;
}

/** 头像上传回调：返回上传后的头像地址。 */
type AvatarUploadApi = (params: AvatarUploadParams) => Promise<string>;

const spies = vi.hoisted(
  /** 建立用例可断言的外部边界替身。 */ () => ({
    httpRequest: vi.fn(),
  }),
);

/** 裁剪组件替身记录的属性；模块替身与用例读取同一实例。 */
const cropperProbe = vi.hoisted(
  /** 建立可读取属性的裁剪组件替身容器。 */ () => ({
    props: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/icons',
  /** 图标是纯展示边界，替换成最小可识别组件。 */ () => ({
    IconifyIcon: { name: 'IconifyIcon', template: '<i class="icon-stub" />' },
  }),
);

vi.mock(
  '#/components/cropper',
  /** 只替换裁剪画布，卡片自身的头像取值与上传回调保持真实实现。 */ () => {
    const CropperAvatarStub = defineComponent({
      name: 'CropperAvatarStub',
      props: {
        /** 当前头像地址。 */
        value: { default: '', type: String },
        /** 是否展示上传按钮。 */
        showBtn: { default: true, type: Boolean },
        /** 裁剪完成后的上传回调。 */
        uploadApi: { default: undefined, type: Function },
        /** 头像宽度。 */
        width: { default: 0, type: Number },
      },
      emits: ['change'],
      /**
       * 记录收到的属性并渲染可定位节点。
       * @param props 裁剪替身声明的属性。
       * @returns 渲染函数。
       */
      setup(props) {
        cropperProbe.props = props;
        return /** 渲染最小占位节点并透出头像地址。 */ () =>
          h('div', { class: 'cropper-stub', 'data-avatar': props.value });
      },
    });
    return { CropperAvatar: CropperAvatarStub };
  },
);

vi.mock(
  '#/components/upload/use-upload',
  /** 上传实现依赖运行时配置与网络，这里只保留真实调用契约。 */ () => ({
    /** 返回记录调用的上传能力替身。 */
    useUpload: () => ({ httpRequest: spies.httpRequest }),
  }),
);

vi.mock(
  '#/api/system/user/profile',
  /** 资料接口是外部边界，由用例决定返回值。 */ () => ({
    updateUserProfile: vi.fn(),
  }),
);

/** 构造字段完整的个人资料，作为渲染基线。 */
function profileRecord(overrides: Record<string, unknown> = {}) {
  return {
    avatar: 'https://files.test/avatar.png',
    createTime: '2026-01-02T03:04:05.000Z',
    dept: { name: 'DUMMY-研发部' },
    email: 'tester@example.test',
    id: 7,
    loginDate: '2026-02-03T04:05:06.000Z',
    loginIp: '127.0.0.1',
    mobile: '13800000000',
    nickname: '测试员',
    posts: [{ name: 'DUMMY-岗位一' }, { name: 'DUMMY-岗位二' }],
    roles: [{ name: '管理员' }, { name: '运营' }],
    username: 'tester',
    ...overrides,
  };
}

beforeEach(
  /** 清空替身调用并登记默认的成功返回，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    spies.httpRequest.mockResolvedValue('https://files.test/new-avatar.png');
    vi.mocked(updateUserProfile).mockResolvedValue(true as never);
  },
);

describe('个人资料卡片渲染', /** 资料字段决定用户能否核对自己的账号归属。 */ () => {
  it('资料缺失时整块不渲染', /** 资料未加载时渲染空卡片会让用户以为自己的资料被清空。 */ () => {
    const wrapper = mount(ProfileUser);

    expect(wrapper.find('.el-descriptions').exists()).toBe(false);
  });

  it('渲染账号、角色、手机与邮箱', /** 字段漏渲染会让用户无法核对账号归属。 */ () => {
    const wrapper = mount(ProfileUser, {
      props: { profile: profileRecord() as never },
    });
    const text = wrapper.text();

    expect(text).toContain('tester');
    expect(text).toContain('管理员,运营');
    expect(text).toContain('13800000000');
    expect(text).toContain('tester@example.test');
  });

  it('渲染部门、岗位与两个时间字段', /** 组织归属与时间字段缺失会让个人中心无法用于账号核对。 */ () => {
    const wrapper = mount(ProfileUser, {
      props: { profile: profileRecord() as never },
    });
    const text = wrapper.text();

    expect(text).toContain('DUMMY-研发部');
    expect(text).toContain('DUMMY-岗位一,DUMMY-岗位二');
    // 时间字段经真实格式化输出，只断言年份与日期片段存在。
    expect(text).toMatch(/2026/u);
  });

  it('岗位为空或缺失时回退为短横线', /** 未回退会让界面出现空白或 undefined。 */ () => {
    const emptyPosts = mount(ProfileUser, {
      props: { profile: profileRecord({ posts: [] }) as never },
    });
    const missingPosts = mount(ProfileUser, {
      props: { profile: profileRecord({ posts: undefined }) as never },
    });

    expect(emptyPosts.text()).toContain('-');
    expect(missingPosts.text()).toContain('-');
  });

  it('未设置头像时回退到偏好设置里的默认头像', /** 头像兜底丢失会让未设置头像的用户看到破图。 */ () => {
    const wrapper = mount(ProfileUser, {
      props: { profile: profileRecord({ avatar: '' }) as never },
    });

    expect(
      wrapper.findComponent({ name: 'CropperAvatarStub' }).props('value'),
    ).toBe(preferences.app.defaultAvatar);
  });

  it('裁剪组件按约定收到头像、宽度且隐藏上传按钮', /** 属性丢失会让头像裁剪入口与卡片布局不符合约定。 */ () => {
    mount(ProfileUser, { props: { profile: profileRecord() as never } });

    expect(cropperProbe.props).toMatchObject({
      showBtn: false,
      value: 'https://files.test/avatar.png',
      width: 120,
    });
  });
});

describe('头像上传链路', /** 上传链路决定用户换头像后能否看到新头像并同步到资料。 */ () => {
  it('裁剪结果按原文件名上传并把地址同步到资料', /** 未同步资料会让用户换了头像，刷新后又变回旧头像。 */ async () => {
    const wrapper = mount(ProfileUser, {
      props: { profile: profileRecord() as never },
    });
    const uploadApi = cropperProbe.props?.uploadApi as AvatarUploadApi;

    const result = await uploadApi({
      file: new Blob(['avatar-bytes'], { type: 'image/png' }),
      filename: 'DUMMY-avatar.png',
    });
    await flushPromises();

    const forwarded = spies.httpRequest.mock.calls[0]?.[0] as File;
    expect(forwarded).toBeInstanceOf(File);
    expect(forwarded.name).toBe('DUMMY-avatar.png');
    expect(forwarded.type).toBe('image/png');
    expect(updateUserProfile).toHaveBeenCalledWith({
      avatar: 'https://files.test/new-avatar.png',
    });
    expect(result).toBe('https://files.test/new-avatar.png');
    expect(wrapper.find('.cropper-stub').attributes('data-avatar')).toBe(
      'https://files.test/avatar.png',
    );
  });

  it('裁剪完成事件向外转发成功通知', /** 未转发会让个人中心其他区域的头像与昵称停留在旧值。 */ async () => {
    const wrapper = mount(ProfileUser, {
      props: { profile: profileRecord() as never },
    });

    wrapper.findComponent({ name: 'CropperAvatarStub' }).vm.$emit('change');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('success')).toHaveLength(1);
  });
});
