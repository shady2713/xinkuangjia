package com.basicframework.module.system.dal.redis.oauth2;

import cn.hutool.core.date.LocalDateTimeUtil;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import jakarta.annotation.Resource;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static com.basicframework.module.system.dal.redis.RedisKeyConstants.OAUTH2_ACCESS_TOKEN;

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
    }

    /**
     * 格式化Key。
     */
    private static String formatKey(String accessToken) {
        return String.format(OAUTH2_ACCESS_TOKEN, accessToken);
    }

}
