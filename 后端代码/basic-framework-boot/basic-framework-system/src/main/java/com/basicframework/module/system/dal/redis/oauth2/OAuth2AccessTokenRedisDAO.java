package com.basicframework.module.system.dal.redis.oauth2;

import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import jakarta.annotation.Resource;
import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static com.basicframework.module.system.dal.redis.RedisKeyConstants.OAUTH2_ACCESS_TOKEN;
import static com.basicframework.module.system.dal.redis.RedisKeyConstants.OAUTH2_ACCESS_ACTIVE;

/**
 * {@link OAuth2AccessTokenDO} 会话空闲活动标记的 RedisDAO；鉴权以数据库令牌记录为准，不缓存令牌实体。
 *
 * @author shady
 */
@Repository
public class OAuth2AccessTokenRedisDAO {

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    /**
     * 删除历史版本遗留的访问令牌实体缓存键；当前版本不再读写该缓存，仅在吊销时清理以兼容滚动升级。
     *
     * @param accessToken 访问令牌参数
     */
    public void delete(String accessToken) {
        String redisKey = formatKey(accessToken);
        stringRedisTemplate.delete(redisKey);
    }

    /**
     * 批量删除活动标记及历史版本遗留的访问令牌实体缓存键。
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
