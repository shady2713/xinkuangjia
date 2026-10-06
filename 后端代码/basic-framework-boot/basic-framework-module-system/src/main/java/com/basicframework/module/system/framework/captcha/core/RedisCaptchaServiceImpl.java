package com.basicframework.module.system.framework.captcha.core;

import com.anji.captcha.service.CaptchaCacheService;
import lombok.Setter;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.concurrent.TimeUnit;

/**
 * 基于 Redis 实现验证码的存储
 *
 * @author 星语
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Setter
public class RedisCaptchaServiceImpl implements CaptchaCacheService {

    private StringRedisTemplate stringRedisTemplate;

    /**
     * 解析并返回当前业务类型。
     *
     * @return 方法处理结果
     */
    @Override
    public String type() {
        return "redis";
    }

    /**
     * 设置目标数据。
     *
     * @param key key 参数
     * @param value 待处理值
     * @param expiresInSeconds expiresInSeconds 参数
     */
    @Override
    public void set(String key, String value, long expiresInSeconds) {
        stringRedisTemplate.opsForValue().set(key, value, expiresInSeconds, TimeUnit.SECONDS);
    }

    /**
     * 判断目标数据是否存在。
     *
     * @param key key 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean exists(String key) {
        return stringRedisTemplate.hasKey(key);
    }

    /**
     * 删除目标数据。
     *
     * @param key key 参数
     */
    @Override
    public void delete(String key) {
        stringRedisTemplate.delete(key);
    }

    /**
     * 获取目标数据。
     *
     * @param key key 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String get(String key) {
        return stringRedisTemplate.opsForValue().get(key);
    }

    /**
     * 对目标数值执行原子递增。
     *
     * @param key key 参数
     * @param val val 参数
     * @return 当前查询包装器
     */
    @Override
    public Long increment(String key, long val) {
        return stringRedisTemplate.opsForValue().increment(key,val);
    }

}
