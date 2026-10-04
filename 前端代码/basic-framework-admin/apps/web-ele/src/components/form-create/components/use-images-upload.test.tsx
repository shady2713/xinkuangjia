/**
 * 图片上传组件工厂（use-images-upload.tsx）的属性透传回归。
 *
 * 表单设计器通过该工厂生成图片上传字段：`maxNumber` 与 `multiple` 是业务侧可配置的
 * 上传约束，透传丢失或默认值变化会让字段允许上传的数量超出预期。用例替换真实上传组件
 * 为记录属性的替身，挂载工厂返回的组件并断言真实渲染出的属性取值。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import { useImagesUpload } from './use-images-upload';

vi.mock(
  '#/components/upload/image-upload.vue',
  /** 上传组件的网络与渲染细节与本次契约无关，替换为记录属性的最小替身。 */ () => ({
    default: {
      name: 'ImageUploadStub',
      props: {
        maxNumber: { default: undefined, type: Number },
        multiple: { default: undefined, type: Boolean },
      },
      template: '<div data-test="image-upload" />',
    },
  }),
);

describe('useImagesUpload 组件工厂', /** 工厂输出直接作为表单字段渲染，属性口径必须稳定。 */ () => {
  it('返回注册名为 ImagesUpload 的组件定义', /** 注册名用于调试与缓存定位，改名会让定位失效。 */ () => {
    expect(useImagesUpload().name).toBe('ImagesUpload');
  });

  it('每次调用返回独立的组件定义', /** 多个表单项共用同一组件定义会共享组件级状态。 */ () => {
    expect(useImagesUpload()).not.toBe(useImagesUpload());
  });

  it('未传属性时使用多选与最多五张的默认约束', /** 默认值决定业务侧不配置时的上传上限。 */ () => {
    const wrapper = mount(useImagesUpload());
    const upload = wrapper.findComponent({ name: 'ImageUploadStub' });

    expect(upload.exists()).toBe(true);
    expect(upload.props('multiple')).toBe(true);
    expect(upload.props('maxNumber')).toBe(5);
  });

  it('传入属性时原样透传给上传组件', /** 表单配置必须真实生效，不能被默认值覆盖。 */ () => {
    const wrapper = mount(useImagesUpload(), {
      props: { maxNumber: 2, multiple: false },
    });
    const upload = wrapper.findComponent({ name: 'ImageUploadStub' });

    expect(upload.props('multiple')).toBe(false);
    expect(upload.props('maxNumber')).toBe(2);
  });

  it('属性更新后上传组件收到最新约束', /** 动态表单会改写字段配置，属性必须保持响应式。 */ async () => {
    const wrapper = mount(useImagesUpload(), {
      props: { maxNumber: 3, multiple: true },
    });

    await wrapper.setProps({ maxNumber: 9 });
    const upload = wrapper.findComponent({ name: 'ImageUploadStub' });

    expect(upload.props('maxNumber')).toBe(9);
    expect(upload.props('multiple')).toBe(true);
  });
});
