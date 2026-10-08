package com.basicframework.module.system.dal.mysql.oauth2;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
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
 * 验证 OAuth2 客户端查询的条件拼装。
 *
 * <p>客户端编号是对外签发凭据的标识，全局唯一，查询必须精确匹配；名称只是管理端的检索条件，用模糊
 * 匹配即可。</p>
 *
 * @author shady2713
 */
class OAuth2ClientMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<OAuth2ClientDO, ?, ?> queryWrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private OAuth2ClientMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), OAuth2ClientDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        mapper = mock(OAuth2ClientMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            IPage<OAuth2ClientDO> page = invocation.getArgument(0);
            page.setRecords(java.util.List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 客户端分页按名称模糊与状态精确过滤，并按编号倒序返回。 */
    @Test
    void selectPageAppliesFiltersAndOrdersById() {
        OAuth2ClientPageReqVO reqVO = new OAuth2ClientPageReqVO();
        reqVO.setName("机器");
        reqVO.setStatus(0);

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("name LIKE").contains("status =").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("%机器%", 0);
    }

    /** 未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new OAuth2ClientPageReqVO());

        assertThat(queryWrapper.getTargetSql()).doesNotContain("LIKE").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 客户端编号是登录凭据，查询必须精确匹配而不是模糊匹配。 */
    @Test
    void selectByClientIdUsesExactEquality() {
        mapper.selectByClientId("cli-001");

        assertThat(queryWrapper.getTargetSql()).contains("client_id =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("cli-001");
    }

}