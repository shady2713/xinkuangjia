package com.basicframework.module.system.dal.redis.oauth2;

import cn.hutool.core.date.LocalDateTimeUtil;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import jakarta.annotation.Resource;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static com.basicframework.module.system.dal.redis.RedisKeyConstants.OAUTH2_ACCESS_TOKEN;
import static com.basicframework.module.system.dal.redis.RedisKeyConstants.OAUTH2_ACCESS_ACTIVE;

/**
 * {@link OAuth2AccessTokenDO} 的 RedisDAO
 *
 * @author 李杰
 */
@Repository
public class OAuth2AccessTokenRedisDAO {

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    /**
     * 获取指定数据。
     *
     * @param accessToken 访问令牌参数
     * @return 查询结果
     */
    public OAuth2AccessTokenDO get(String accessToken) {
        String redisKey = formatKey(accessToken);
        return JsonUtils.parseObject(stringRedisTemplate.opsForValue().get(redisKey), OAuth2AccessTokenDO.class);
    }

    /**
     * 设置指定数据。
     *
     * @param accessTokenDO 访问令牌DO参数
     */
    public void set(OAuth2AccessTokenDO accessTokenDO) {
        String redisKey = formatKey(accessTokenDO.getAccessToken());
        // 清理多余字段，避免缓存
        accessTokenDO.setUpdater(null);
        accessTokenDO.setUpdateTime(null);
        accessTokenDO.setCreateTime(null);
        accessTokenDO.setCreator(null);
        accessTokenDO.setDeleted(null);
        long time = LocalDateTimeUtil.between(LocalDateTime.now(), accessTokenDO.getExpiresTime(), ChronoUnit.SECONDS);
        if (time > 0) {
            stringRedisTemplate.opsForValue().set(redisKey, JsonUtils.toJsonString(accessTokenDO), time, TimeUnit.SECONDS);
        }
    }

    /**
     * 删除指定数据。
     *
     * @param accessToken 访问令牌参数
     */
    public void delete(String accessToken) {
        String redisKey = formatKey(accessToken);
        stringRedisTemplate.delete(redisKey);
    }

    /**
     * 删除列表。
     *
     * @param accessTokens 访问Tokens参数
     */
    public void deleteList(Collection<String> accessTokens) {
        List<String> redisKeys = CollectionUtils.convertList(accessTokens, OAuth2AccessTokenRedisDAO::formatKey);
        stringRedisTemplate.delete(redisKeys);
        List<String> activeKeys = CollectionUtils.convertList(accessTokens,
                OAuth2AccessTokenRedisDAO::formatActiveKey);
        stringRedisTemplate.delete(activeKeys);
    }

    /**
     * 记录访问令牌刚完成一次活动，并重置空闲超时计时。
     *
     * @param accessToken 访问令牌
     * @param idleTimeout 会话空闲超时
     */
    public void setActive(String accessToken, Duration idleTimeout) {
        stringRedisTemplate.opsForValue().set(formatActiveKey(accessToken), "1",
                idleTimeout.toMillis(), TimeUnit.MILLISECONDS);
    }

    /**
     * 续期访问令牌的活动标记，用于判断会话是否仍在空闲窗口内。
     *
     * @param accessToken 访问令牌
     * @param idleTimeout 会话空闲超时
     * @return 标记存在并续期成功返回 true；不存在说明会话已空闲超时
     */
    public boolean refreshActive(String accessToken, Duration idleTimeout) {
        return Boolean.TRUE.equals(stringRedisTemplate.expire(formatActiveKey(accessToken),
                idleTimeout.toMillis(), TimeUnit.MILLISECONDS));
    }

    /**
     * 判断访问令牌是否存在活动标记。
     *
     * @param accessToken 访问令牌
     * @return 存在返回 true
     */
    public boolean isActive(String accessToken) {
        return Boolean.TRUE.equals(stringRedisTemplate.hasKey(formatActiveKey(accessToken)));
    }

    /**
     * 删除访问令牌的活动标记。
     *
     * @param accessToken 访问令牌
     */
    public void deleteActive(String accessToken) {
        stringRedisTemplate.delete(formatActiveKey(accessToken));
    }

    /**
     * 格式化Key。
     */
    private static String formatKey(String accessToken) {
        return String.format(OAUTH2_ACCESS_TOKEN, accessToken);
    }

    /**
     * 格式化活动标记Key。
     *
     * @param accessToken 访问令牌
     * @return Redis 键
     */
    private static String formatActiveKey(String accessToken) {
        return String.format(OAUTH2_ACCESS_ACTIVE, accessToken);
    }

}
