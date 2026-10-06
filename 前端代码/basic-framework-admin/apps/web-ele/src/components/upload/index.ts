/**
 * 上传组件出口：统一暴露 FileUpload、ImageUpload 与 InputUpload，
 * 页面从这里引入；具体上传请求由各组件通过 api 属性接收。
 */
export { default as FileUpload } from './file-upload.vue';
export { default as ImageUpload } from './image-upload.vue';
export { default as InputUpload } from './input-upload.vue';
