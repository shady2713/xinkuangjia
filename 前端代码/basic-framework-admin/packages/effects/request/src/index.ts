/**
 * 请求能力出口：转出 request-client 的客户端、拦截器与响应工具，
 * 并原样透出 axios 与 @microsoft/fetch-event-source，
 * 业务做 SSE 或直接使用 axios 时无需再单独引入依赖。
 */
export * from './request-client';
export * from '@microsoft/fetch-event-source';
export * from 'axios';
