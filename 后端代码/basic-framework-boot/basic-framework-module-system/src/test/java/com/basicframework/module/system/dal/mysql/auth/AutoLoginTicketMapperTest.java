package com.basicframework.module.system.dal.mysql.auth;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.dal.dataobject.auth.AutoLoginTicketDO;
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
 * 验证自动登录票据的查询口径。
 *
 * <p>票据是一次性登录凭据，按票据串查询必须使用精确匹配。改成模糊匹配会让短票据命中到另一个用户的
 * 票据串，凭据就不再与账号一一对应。</p>
 *
 * @author shady2713
 */
class AutoLoginTicketMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<AutoLoginTicketDO, ?, ?> queryWrapper;
    /** 单条查询要返回的记录。 */
    private AutoLoginTicketDO selectOneResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private AutoLoginTicketMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), AutoLoginTicketDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        selectOneResult = null;
        mapper = mock(AutoLoginTicketMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return selectOneResult;
        }).when(mapper).selectOne(any(Wrapper.class));
    }

    /** 按票据串查询必须精确匹配票据列，并把票据串原样作为查询条件。 */
    @Test
    void selectByTicketUsesExactEqualityOnTicketColumn() {
        mapper.selectByTicket("ticket-abc-123");

        assertThat(queryWrapper.getTargetSql()).contains("ticket =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("ticket-abc-123");
    }

    /** 查询结果必须原样返回给调用方，凭据状态与过期判定由调用方决定。 */
    @Test
    void selectByTicketReturnsPersistedTicket() {
        AutoLoginTicketDO expected = new AutoLoginTicketDO();
        selectOneResult = expected;

        assertThat(mapper.selectByTicket("ticket-abc-123")).isSameAs(expected);
        // MyBatis-Plus 在渲染 SQL 时才写入条件参数，必须先取 SQL 再核对参数。
        assertThat(queryWrapper.getTargetSql()).contains("ticket =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("ticket-abc-123");
    }

}