/** 对象存储单文件元数据摘要。 */
package com.basicframework.module.infra.framework.file.core.client;

/**
 * 对象存储中单个已存在对象的轻量元数据快照（通过 HEAD 请求获取，不读取对象体）。
 *
 * @param size        对象实际字节大小
 * @param contentType 对象在存储端记录的 Content-Type，可能为 {@code null}
 * @author shady2713
 */
public record FileObjectStat(long size, String contentType) {
}
