package com.basicframework.module.system.dal.mysql.dept;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.dal.dataobject.dept.UserPostDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Answers.CALLS_REAL_METHODS;

/**
 * 验证用户岗位关联 Mapper 的默认方法拼出的真实查询条件。
 *
 * <p>这些默认方法把方法名表达的语义翻译成条件对象：按用户查岗位、按岗位批量查用户、
 * 按用户与岗位集合删除、按用户整体删除。条件写错会造成越权删除或漏删（例如漏掉岗位集合
 * 条件会删掉该用户全部岗位），而编译与启动都不会报错。因此本用例观察真正交给持久化层的
 * 条件对象，而不是只看方法的调用次数；岗位集合为空时必须直接返回空列表而不是发起全表查询。</p>
 *
 * @author shady2713
 */
class UserPostMapperTest {

    /** 记录查询条件对象的引用。 */
    private final AtomicReference<AbstractWrapper<UserPostDO, ?, ?>> selectListWrapper = new AtomicReference<>();
    /** 记录删除条件对象的引用。 */
    private final AtomicReference<AbstractWrapper<UserPostDO, ?, ?>> deleteWrapper = new AtomicReference<>();

    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private UserPostMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), UserPostDO.class);
    }

    /** 为每个用例创建独立替身并记录默认方法交给持久化层的条件对象。 */
    @BeforeEach
    void setUp() {
        selectListWrapper.set(null);
        deleteWrapper.set(null);
        mapper = mock(UserPostMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            selectListWrapper.set(invocation.getArgument(0));
            return List.of();
        }).when(mapper).selectList(any());
        doAnswer(invocation -> {
            deleteWrapper.set(invocation.getArgument(0));
            return 0;
        }).when(mapper).delete(any());
    }

    /** 按用户查岗位必须只带用户编号条件。 */
    @Test
    void selectListByUserIdFiltersByUserIdOnly() {
        assertThat(mapper.selectListByUserId(1024L)).isEmpty();

        AbstractWrapper<UserPostDO, ?, ?> wrapper = selectListWrapper.get();
        assertThat(wrapper.getTargetSql()).contains("user_id").doesNotContain("post_id");
        assertThat(wrapper.getParamNameValuePairs()).containsValue(1024L);
    }

    /** 按岗位集合批量查关联时必须使用 IN 条件，避免退化成全表查询。 */
    @Test
    void selectListByPostIdsFiltersByPostIds() {
        assertThat(mapper.selectListByPostIds(List.of(1L, 2L, 3L))).isEmpty();

        AbstractWrapper<UserPostDO, ?, ?> wrapper = selectListWrapper.get();
        assertThat(wrapper.getTargetSql()).contains("post_id IN").doesNotContain("user_id");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(1L, 2L, 3L);
    }

    /** 岗位集合为空时必须直接返回空列表，不得发起无条件查询。 */
    @Test
    void selectListByPostIdsWithEmptyCollectionSkipsQuery() {
        assertThat(mapper.selectListByPostIds(List.of())).isEmpty();

        assertThat(selectListWrapper.get()).as("空集合不应构造查询条件").isNull();
    }

    /** 按用户与岗位集合删除必须同时带上两个条件，不能扩大删除范围。 */
    @Test
    void deleteByUserIdAndPostIdFiltersByBothColumns() {
        mapper.deleteByUserIdAndPostId(1024L, List.of(1L, 2L));

        AbstractWrapper<UserPostDO, ?, ?> wrapper = deleteWrapper.get();
        assertThat(wrapper.getTargetSql()).contains("user_id").contains("post_id IN");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(1024L, 1L, 2L);
    }

    /** 按用户整体删除必须只带用户编号条件。 */
    @Test
    void deleteByUserIdFiltersByUserIdOnly() {
        mapper.deleteByUserId(1024L);

        AbstractWrapper<UserPostDO, ?, ?> wrapper = deleteWrapper.get();
        assertThat(wrapper.getTargetSql()).contains("user_id").doesNotContain("post_id");
        assertThat(wrapper.getParamNameValuePairs()).containsValue(1024L);
    }
}
