/**
 * 多图上传组件工厂：把 components/upload 的 ImageUpload 包装成可注册的 ImagesUpload。
 * multiple 与 maxNumber 直接透传给底层组件，由 plugins/form-create 注册给 JSON 表单；
 * 不实现上传协议、体积校验与文件列表逻辑，这些能力仍由上传组件承担。
 */
import { defineComponent } from 'vue';

import ImageUpload from '#/components/upload/image-upload.vue';

/**
 * 创建多图上传组件：把底层 ImageUpload 固定为多选并给出数量上限，供 form-create 按组件名注册。
 * 每次调用都返回新的组件定义，多处注册不会共享 props 默认值。
 * @returns Vue 组件定义，multiple 与 maxNumber 两个 props 会原样透传给 ImageUpload。
 */
export function useImagesUpload() {
  return defineComponent({
    name: 'ImagesUpload',
    props: {
      multiple: {
        type: Boolean,
        default: true,
      },
      maxNumber: {
        type: Number,
        default: 5,
      },
    },
    /**
     * 渲染多图上传：只做属性透传，不参与上传编排与文件列表维护。
     * @param props 组件入参，multiple 决定是否多选，maxNumber 决定最多可上传几张。
     * @returns 输出 ImageUpload 的渲染函数。
     */
    setup(props) {
      return () => (
        <ImageUpload maxNumber={props.maxNumber} multiple={props.multiple} />
      );
    },
  });
}
