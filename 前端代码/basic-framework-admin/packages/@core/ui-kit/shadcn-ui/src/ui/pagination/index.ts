/**
 * 分页出口：聚合首、上、下、末页按钮与省略号五件，并转出 reka-ui
 * 的根节点、列表与列表项，其中根节点以 Pagination 之名暴露。
 * 导航件依赖根节点上下文取页码，脱离分页根单独使用不生效。
 */
export { default as PaginationEllipsis } from './PaginationEllipsis.vue';
export { default as PaginationFirst } from './PaginationFirst.vue';
export { default as PaginationLast } from './PaginationLast.vue';
export { default as PaginationNext } from './PaginationNext.vue';
export { default as PaginationPrev } from './PaginationPrev.vue';
export {
  PaginationRoot as Pagination,
  PaginationList,
  PaginationListItem,
} from 'reka-ui';
