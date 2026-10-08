package com.basicframework.module.system.dal.mysql.dept;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证岗位查询的条件拼装与空集合短路。
 *
 * <p>岗位同时被"按岗位集合过滤"和"按状态集合过滤"两个入口使用，两个集合都可能为空。空的集合条件
 * 必须直接跳过而不是拼出 {@code IN ()}：MySQL 会把它当成语法错误，而某些方言会退化成无条件匹配，
 * 结果是停用岗位重新出现在可选项里。</p>
 *
 * @author shady2713
 */
class PostMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<PostDO, ?, ?> queryWrapper;
    /** 记录最近一次分页查询交给分页插件的分页对象。 */
    private IPage<PostDO> page;
    /** 单条查询要返回的记录。 */
    private PostDO selectOneResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private PostMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), PostDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        page = null;
        selectOneResult = null;
        mapper = mock(PostMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return selectOneResult;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return List.of();
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            page = invocation.getArgument(0);
            queryWrapper = invocation.getArgument(1);
            page.setRecords(List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 编号与状态两个集合都有效时，两条 IN 条件必须同时生效。 */
    @Test
    void selectListCombinesBothCollectionConditions() {
        mapper.selectList(List.of(1L, 2L), List.of(0, 1));

        assertThat(queryWrapper.getTargetSql()).contains("id IN").contains("status IN");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(1L, 2L, 0, 1);
    }

    /** 集合为空时不得拼出空的 IN 条件，否则查询会失败或退化成全量岗位。 */
    @Test
    void selectListSkipsEmptyCollections() {
        mapper.selectList(List.of(), null);

        assertThat(queryWrapper.getTargetSql()).as("空集合不得产生任何 IN 条件").isEmpty();
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 岗位分页按编码与名称模糊匹配、状态精确匹配，并按编号倒序返回。 */
    @Test
    void selectPageAppliesFiltersAndOrdersById() {
        PostPageReqVO reqVO = new PostPageReqVO();
        reqVO.setCode("DEV");
        reqVO.setName("开发");
        reqVO.setStatus(0);

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("code LIKE").contains("name LIKE").contains("status =").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("%DEV%", "%开发%", 0);
    }

    /** 岗位编码与名称都要唯一，按名称或编码查询必须使用精确匹配而不是模糊匹配。 */
    @Test
    void selectByNameAndCodeUseExactEquality() {
        mapper.selectByName("开发工程师");
        assertThat(queryWrapper.getTargetSql()).contains("name =").doesNotContain("LIKE");

        mapper.selectByCode("DEV_001");
        assertThat(queryWrapper.getTargetSql()).contains("code =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("DEV_001");
    }

    /** 查询结果必须原样返回给调用方，唯一性校验据此判定冲突。 */
    @Test
    void selectByCodeReturnsPersistedRecord() {
        PostDO expected = new PostDO();
        selectOneResult = expected;

        assertThat(mapper.selectByCode("DEV_001")).isSameAs(expected);
        // MyBatis-Plus 在渲染 SQL 时才写入条件参数，必须先取 SQL 再核对参数。
        assertThat(queryWrapper.getTargetSql()).contains("code =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("DEV_001");
    }

}