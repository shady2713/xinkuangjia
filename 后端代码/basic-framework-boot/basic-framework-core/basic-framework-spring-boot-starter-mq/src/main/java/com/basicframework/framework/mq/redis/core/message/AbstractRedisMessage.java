package com.basicframework.framework.mq.redis.core.message;

import lombok.Data;

import java.util.HashMap;
import java.util.Map;

/**
 * Redis 消息抽象基类
 *
 * @author 李杰
 */
@Data
public abstract class AbstractRedisMessage {

    /**
     * 头
     */
    private Map<String, String> headers = new HashMap<>();

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
