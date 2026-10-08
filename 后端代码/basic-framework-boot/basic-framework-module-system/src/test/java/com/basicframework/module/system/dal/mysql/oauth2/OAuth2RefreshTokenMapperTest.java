package com.basicframework.module.system.dal.mysql.oauth2;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证刷新令牌查询的行锁口径与撤销范围。
 *
 * <p>刷新令牌是轮换的：一次刷新会作废旧会话并签发新会话。两个并发刷新如果都读到同一条记录，就会各自
 * 签发一个有效的新会话，旧会话在过期前仍可继续刷新。带 {@code FOR UPDATE} 的查询把这条记录锁住，
 * 后到的请求只能看到轮换后的结果。缺少该尾巴的普通查询不能替代它。</p>
 *
 * @author shady2713
 */
class OAuth2RefreshTokenMapperTest {

    /** 记录查询或删除交给持久化层的条件对象。 */
    private AbstractWrapper<OAuth2RefreshTokenDO, ?, ?> wrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private OAuth2RefreshTokenMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), OAuth2RefreshTokenDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询与删除方法记录条件。 */
    @BeforeEach
    void setUp() {
        wrapper = null;
        mapper = mock(OAuth2RefreshTokenMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return 2;
        }).when(mapper).delete(any(Wrapper.class));
    }

    /** 轮换前的查询必须锁定该行，缺少 FOR UPDATE 时并发刷新会签发多个有效会话。 */
    @Test
    void selectByRefreshTokenForUpdateLocksTheRow() {
        mapper.selectByRefreshTokenForUpdate("refresh-1");

        assertThat(wrapper.getTargetSql()).contains("refresh_token =").endsWith("FOR UPDATE");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("refresh-1");
    }

    /** 普通查询不带行锁，用于只读场景，避免无谓的锁等待。 */
    @Test
    void selectByRefreshTokenReadsWithoutRowLock() {
        mapper.selectByRefreshToken("refresh-1");

        assertThat(wrapper.getTargetSql()).contains("refresh_token =").doesNotContain("FOR UPDATE");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("refresh-1");
    }

    /** 强制下线按用户与平台限定删除范围，并返回真实删除行数。 */
    @Test
    void deleteByUserIdAndUserTypeScopesToThatPlatform() {
        int deleted = mapper.deleteByUserIdAndUserType(7L, 2);

        assertThat(deleted).isEqualTo(2);
        assertThat(wrapper.getTargetSql()).contains("user_id =").contains("user_type =");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder(7L, 2);
    }

    /** 按会话撤销只影响该会话的刷新令牌。 */
    @Test
    void deleteByRefreshTokenScopesToSingleSession() {
        int deleted = mapper.deleteByRefreshToken("refresh-1");

        assertThat(deleted).isEqualTo(2);
        assertThat(wrapper.getTargetSql()).contains("refresh_token =").doesNotContain("user_id");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("refresh-1");
    }

}