package com.basicframework.module.system.dal.mysql.oauth2;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证访问令牌的条件拼装与撤销范围。
 *
 * <p>令牌分页必须始终排除已过期令牌：管理端展示过期令牌会让运维误判凭据仍然可用。过期条件不是可选
 * 筛选项，即使请求没有带任何筛选也必须生效。</p>
 *
 * <p>撤销入口按"刷新会话"或"用户 + 平台"限定删除范围：按刷新会话撤销只影响这一个会话，按用户与平台
 * 撤销用于强制下线，必须同时限定两者，否则会连带删除另一个平台的会话。</p>
 *
 * @author shady2713
 */
class OAuth2AccessTokenMapperTest {

    /** 记录查询或删除交给持久化层的条件对象。 */
    private AbstractWrapper<OAuth2AccessTokenDO, ?, ?> wrapper;
    /** 单条查询要返回的记录。 */
    private OAuth2AccessTokenDO selectOneResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private OAuth2AccessTokenMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), OAuth2AccessTokenDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询与删除方法记录条件。 */
    @BeforeEach
    void setUp() {
        wrapper = null;
        selectOneResult = null;
        mapper = mock(OAuth2AccessTokenMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return selectOneResult;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return java.util.List.of();
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(1);
            IPage<OAuth2AccessTokenDO> page = invocation.getArgument(0);
            page.setRecords(java.util.List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return 3;
        }).when(mapper).delete(any(Wrapper.class));
    }

    /** 强制下线按用户编号与平台类型限定删除范围，并返回真实删除行数。 */
    @Test
    void deleteByUserIdAndUserTypeScopesToThatPlatform() {
        int deleted = mapper.deleteByUserIdAndUserType(7L, 2);

        assertThat(deleted).isEqualTo(3);
        assertThat(wrapper.getTargetSql()).contains("user_id =").contains("user_type =");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder(7L, 2);
    }

    /** 按刷新会话撤销只影响该会话，不得顺带删除同一用户的其它会话。 */
    @Test
    void deleteByRefreshTokenScopesToSingleSession() {
        int deleted = mapper.deleteByRefreshToken("refresh-1");

        assertThat(deleted).isEqualTo(3);
        assertThat(wrapper.getTargetSql()).contains("refresh_token =").doesNotContain("user_id");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("refresh-1");
    }

    /** 令牌本身是登录凭据，按令牌串查询必须精确匹配。 */
    @Test
    void selectByAccessTokenUsesExactEquality() {
        mapper.selectByAccessToken("access-1");

        assertThat(wrapper.getTargetSql()).contains("access_token =").doesNotContain("LIKE");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("access-1");
    }

    /** 按刷新会话取令牌集合用于刷新校验，会话串必须精确匹配。 */
    @Test
    void selectListByRefreshTokenUsesExactEquality() {
        mapper.selectListByRefreshToken("refresh-1");

        assertThat(wrapper.getTargetSql()).contains("refresh_token =");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("refresh-1");
    }

    /** 令牌分页的可选条件按精确或模糊口径翻译，并始终附带过期过滤。 */
    @Test
    void selectPageAppliesOptionalFiltersTogetherWithExpiryGuard() {
        OAuth2AccessTokenPageReqVO reqVO = new OAuth2AccessTokenPageReqVO();
        reqVO.setUserId(7L);
        reqVO.setUserType(2);
        reqVO.setClientId("cli");

        mapper.selectPage(reqVO);

        assertThat(wrapper.getTargetSql())
                .contains("user_id =").contains("user_type =").contains("client_id LIKE")
                .contains("expires_time >").contains("ORDER BY id DESC");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(7L, 2, "%cli%");
        assertThat(wrapper.getParamNameValuePairs().values().stream()
                .filter(LocalDateTime.class::isInstance)).as("过期过滤必须绑定当前时间之后的时间点").isNotEmpty();
    }

    /** 未带任何筛选时仍必须排除已过期令牌，否则管理端会把过期凭据当成有效凭据展示。 */
    @Test
    void selectPageWithoutFiltersStillExcludesExpiredTokens() {
        mapper.selectPage(new OAuth2AccessTokenPageReqVO());

        assertThat(wrapper.getTargetSql()).contains("expires_time >").contains("ORDER BY id DESC");
        assertThat(wrapper.getParamNameValuePairs().values().stream()
                .filter(LocalDateTime.class::isInstance)).isNotEmpty();
    }

    /** 按用户编号与平台类型取会话集合，两个条件必须同时生效。 */
    @Test
    void selectListByUserIdAndUserTypeCarriesBothConditions() {
        mapper.selectListByUserIdAndUserType(7L, 2);

        assertThat(wrapper.getTargetSql()).contains("user_id =").contains("user_type =");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder(7L, 2);
    }

    /** 查询结果必须原样透传给刷新逻辑，刷新失败时由调用方决定是否清理会话。 */
    @Test
    void selectByAccessTokenReturnsPersistedToken() {
        OAuth2AccessTokenDO expected = new OAuth2AccessTokenDO();
        selectOneResult = expected;

        assertThat(mapper.selectByAccessToken("access-1")).isSameAs(expected);
        // MyBatis-Plus 在渲染 SQL 时才写入条件参数，必须先取 SQL 再核对参数。
        assertThat(wrapper.getTargetSql()).contains("access_token =");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("access-1");
    }

}