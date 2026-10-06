/**
 * 多图上传组件工厂：把 components/upload 的 ImageUpload 包装成可注册的 ImagesUpload。
 * multiple 与 maxNumber 直接透传给底层组件，由 plugins/form-create 注册给 JSON 表单；
 * 不实现上传协议、体积校验与文件列表逻辑，这些能力仍由上传组件承担。
 */
import { defineComponent } from 'vue';

import ImageUpload from '#/components/upload/image-upload.vue';

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
    setup(props) {
      return () => (
        <ImageUpload maxNumber={props.maxNumber} multiple={props.multiple} />
      );
    },
  });
}
