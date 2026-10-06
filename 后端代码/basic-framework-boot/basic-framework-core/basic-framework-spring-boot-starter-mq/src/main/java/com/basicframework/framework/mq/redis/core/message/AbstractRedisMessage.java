package com.basicframework.framework.mq.redis.core.message;

import lombok.Data;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Redis 消息抽象基类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Data
public abstract class AbstractRedisMessage {

    /**
     * 头
     */
    private Map<String, String> headers = new ConcurrentHashMap<>();

    /**
     * 读取指定名称的消息头。
     *
     * @param key 键名
     * @return 查询结果
     */
    public String getHeader(String key) {
        return headers.get(key);
    }

    /**
     * 写入指定名称的消息头。
     *
     * @param key 键名
     * @param value 输入值
     */
    public void addHeader(String key, String value) {
        headers.put(key, value);
    }

}
