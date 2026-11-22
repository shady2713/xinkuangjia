/** 对象存储列表的有界分页模型，不携带访问地址或凭据。 */
package com.basicframework.module.infra.framework.file.core.client;

import java.util.List;

/**
 * 当前桶的一页对象元数据，供容量统计逐页消费。
 *
 * @param objects 当前页对象，最多 1000 条
 * @param nextToken 下一页不透明游标；为 null 表示已完成
 * @author 吴晓群
 */
public record FileObjectPage(List<Entry> objects, String nextToken) {

    /**
     * 对象的逻辑大小，不包含版本历史、分片或存储冗余。
     *
     * @param path 对象键，大小写敏感
     * @param size 当前对象的字节数，必须非负
     * @author 吴晓群
     */
    public record Entry(String path, long size) {
    }
}
