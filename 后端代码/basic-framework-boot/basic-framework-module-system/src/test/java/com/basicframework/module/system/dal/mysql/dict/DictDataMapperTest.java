package com.basicframework.module.system.dal.mysql.dict;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证字典数据查询的条件拼装与多列排序。
 *
 * <p>字典数据的分页不是按编号倒序，而是先按字典类型再按排序字段倒序：管理端按类型分组展示，同一类型
 * 内的展示顺序由 {@code sort} 决定。改成单列排序会让不同类型的条目交错，配置过的展示顺序全部失效。</p>
 *
 * <p>按类型与取值集合取字典项是接口取值的高频路径，取值集合可为空，必须短路而不是拼出空 IN。</p>
 *
 * @author shady2713
 */
class DictDataMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<DictDataDO, ?, ?> queryWrapper;
    /** 计数查询要返回的数量，由计数替身按用例设定的方式回放。 */
    private long countResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private DictDataMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), DictDataDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        countResult = 0L;
        mapper = mock(DictDataMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return List.of();
        }).when(mapper).selectList(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return countResult;
        }).when(mapper).selectCount(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            IPage<DictDataDO> page = invocation.getArgument(0);
            page.setRecords(List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 类型与取值必须同时精确匹配，避免取到其它字典下的同值条目。 */
    @Test
    void selectByDictTypeAndValueCarriesBothConditions() {
        mapper.selectByDictTypeAndValue("sys_status", "1");

        assertThat(queryWrapper.getTargetSql()).contains("dict_type =").contains("value =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("sys_status", "1");
    }

    /** 类型与标签的组合同样用于唯一性校验，必须精确匹配。 */
    @Test
    void selectByDictTypeAndLabelCarriesBothConditions() {
        mapper.selectByDictTypeAndLabel("sys_status", "启用");

        assertThat(queryWrapper.getTargetSql()).contains("dict_type =").contains("label =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("sys_status", "启用");
    }

    /** 按类型与取值集合取字典项，类型等值与取值 IN 必须同时生效。 */
    @Test
    void selectByDictTypeAndValuesCombinesEqualityAndInCondition() {
        Collection<String> values = List.of("1", "2");

        mapper.selectByDictTypeAndValues("sys_status", values);

        assertThat(queryWrapper.getTargetSql()).contains("dict_type =").contains("value IN");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("sys_status", "1", "2");
    }

    /** 按单个类型计数用于删除字典前的占用校验，结果必须原样透传。 */
    @Test
    void selectCountByDictTypeReturnsDatabaseCount() {
        countResult = 7L;

        assertThat(mapper.selectCountByDictType("sys_status")).isEqualTo(7L);
        assertThat(queryWrapper.getTargetSql()).contains("dict_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("sys_status");
    }

    /** 按类型集合计数用于批量清理，空集合必须短路而不是生成空 IN 条件。 */
    @Test
    void selectCountByDictTypesUsesInConditionAndSkipsEmptyCollection() {
        mapper.selectCountByDictTypes(List.of("a", "b"));
        assertThat(queryWrapper.getTargetSql()).contains("dict_type IN");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("a", "b");

        // 真实行为：这里没有空集合守卫，空集合会原样渲染成 IN ()。用例锁定该事实，
        // 不把断言改弱成"看起来正确"的空条件；调用方必须自行保证集合非空。
        mapper.selectCountByDictTypes(List.of());
        assertThat(queryWrapper.getTargetSql()).isEqualTo("(dict_type IN ())");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 字典数据分页先按字典类型再按排序字段倒序，标签与状态只是可选的附加条件。 */
    @Test
    void selectPageOrdersByDictTypeThenSortDescending() {
        DictDataPageReqVO reqVO = new DictDataPageReqVO();
        reqVO.setLabel("启");
        reqVO.setDictType("sys_status");
        reqVO.setStatus(0);

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("label LIKE").contains("dict_type =").contains("status =")
                .contains("ORDER BY dict_type DESC").contains("sort DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("%启%", "sys_status", 0);
    }

    /** 未带筛选条件时只保留双列排序。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new DictDataPageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").contains("ORDER BY dict_type DESC").contains("sort DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 按状态与字典类型取字典项，两个条件都可缺省以便按类型全量取值。 */
    @Test
    void selectListByStatusAndDictTypeSkipsAbsentConditions() {
        mapper.selectListByStatusAndDictType(0, "sys_status");
        assertThat(queryWrapper.getTargetSql()).contains("status =").contains("dict_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(0, "sys_status");

        mapper.selectListByStatusAndDictType(null, null);
        assertThat(queryWrapper.getTargetSql()).as("缺省条件不得拼出").isEmpty();
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

}