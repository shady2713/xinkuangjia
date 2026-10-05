package com.basicframework.module.[module].service.[entity];

import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]PageReqVO;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]SaveReqVO;
import com.basicframework.module.[module].dal.dataobject.[entity].[Entity]DO;
import com.basicframework.module.[module].dal.mysql.[entity].[Entity]Mapper;
import com.basicframework.module.[module].enums.ErrorCodeConstants;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.core.toolkit.support.SFunction;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证[entity-name]服务的唯一性校验、存在性保护与查询条件契约。
 *
 * <p>三条规则写错都不会编译失败，只会静默产生脏数据或错误结果：名称唯一失效会让列表出现无法
 * 区分的两条记录；修改不校验存在性会把过期列表行改成新记录；删除不校验存在性会让调用方把
 * “什么都没删”当成删除成功。分页条件写错则会返回不该出现的记录或漏掉筛选。因此用例逐条断言
 * 真实抛出的业务错误码与真实下传的 Wrapper SQL。</p>
 *
 * <p>持久化层作为进程外边界替换为替身，服务内校验与查询组装真实执行。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]。</p>
 *
 * @author [author]
 */
class [Entity]ServiceImplTest {

    /** 被测服务。 */
    private [Entity]ServiceImpl [entity]Service;

    /** 持久化替身。 */
    private [Entity]Mapper [entity]Mapper;

    /**
     * 注册实体的 TableInfo，使 Wrapper 能把 Lambda 解析成真实列名。
     *
     * <p>生产运行时由 MyBatis-Plus 扫描 Mapper 时建立该缓存；本用例不启动容器，如果不注册，
     * 读取 Wrapper SQL 会直接抛“can not find lambda cache for this entity”，
     * 让“筛选条件是否真的进入 SQL”这条断言无法执行。</p>
     */
    @BeforeAll
    static void initLambdaCache() {
        TableInfoHelper.initTableInfo(
                new MapperBuilderAssistant(new MybatisConfiguration(), ""), [Entity]DO.class);
    }

    /** 装配服务与替身。 */
    @BeforeEach
    void setUp() {
        [entity]Service = new [Entity]ServiceImpl();
        [entity]Mapper = mock([Entity]Mapper.class);
        ReflectionTestUtils.setField([entity]Service, "[entity]Mapper", [entity]Mapper);
    }

    /** 名称未被占用时必须落库并返回数据库回填的编号。 */
    @Test
    void create[Entity]InsertsWhenNameFree() {
        when([entity]Mapper.selectOne(any(SFunction.class), any())).thenReturn(null);
        when([entity]Mapper.insert(any([Entity]DO.class))).thenAnswer(invocation -> {
            [Entity]DO saved = invocation.getArgument(0);
            saved.setId(1024L);
            return 1;
        });
        [Entity]SaveReqVO reqVO = buildSaveReqVO(null, "示例名称", 0);

        assertThat([entity]Service.create[Entity](reqVO)).isEqualTo(1024L);

        ArgumentCaptor<[Entity]DO> captor = ArgumentCaptor.forClass([Entity]DO.class);
        verify([entity]Mapper).insert(captor.capture());
        assertThat(captor.getValue().getName()).isEqualTo("示例名称");
        assertThat(captor.getValue().getStatus()).isZero();
    }

    /** 名称已被占用时必须拒绝创建，且不得产生任何写入。 */
    @Test
    void create[Entity]RejectsDuplicateName() {
        when([entity]Mapper.selectOne(any(SFunction.class), any())).thenReturn(build[Entity](1L, "示例名称", 0));

        assertBusinessError(() -> [entity]Service.create[Entity](buildSaveReqVO(null, "示例名称", 0)),
                ErrorCodeConstants.[ENTITY]_NAME_DUPLICATE);
        verify([entity]Mapper, never()).insert(any([Entity]DO.class));
    }

    /** 名称仍属于自身时修改必须放行，并按编号更新。 */
    @Test
    void update[Entity]UpdatesWhenNameKeptBySelf() {
        when([entity]Mapper.selectById(1024L)).thenReturn(build[Entity](1024L, "示例名称", 0));
        when([entity]Mapper.selectOne(any(SFunction.class), any())).thenReturn(build[Entity](1024L, "示例名称", 0));

        [entity]Service.update[Entity](buildSaveReqVO(1024L, "示例名称", 1));

        ArgumentCaptor<[Entity]DO> captor = ArgumentCaptor.forClass([Entity]DO.class);
        verify([entity]Mapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1024L);
        assertThat(captor.getValue().getStatus()).isEqualTo(1);
    }

    /** 名称属于其它记录时必须拒绝修改，避免两条记录重名。 */
    @Test
    void update[Entity]RejectsNameOwnedByAnotherRecord() {
        when([entity]Mapper.selectById(1024L)).thenReturn(build[Entity](1024L, "示例名称", 0));
        when([entity]Mapper.selectOne(any(SFunction.class), any())).thenReturn(build[Entity](2048L, "示例名称", 0));

        assertBusinessError(() -> [entity]Service.update[Entity](buildSaveReqVO(1024L, "示例名称", 1)),
                ErrorCodeConstants.[ENTITY]_NAME_DUPLICATE);
        verify([entity]Mapper, never()).updateById(any([Entity]DO.class));
    }

    /** 目标记录不存在时必须拒绝修改，不能改出新记录。 */
    @Test
    void update[Entity]RejectsMissingRecord() {
        when([entity]Mapper.selectById(1024L)).thenReturn(null);

        assertBusinessError(() -> [entity]Service.update[Entity](buildSaveReqVO(1024L, "示例名称", 0)),
                ErrorCodeConstants.[ENTITY]_NOT_EXISTS);
        verify([entity]Mapper, never()).updateById(any([Entity]DO.class));
    }

    /** 编号为空同样属于不存在的目标，必须返回业务错误而不是透传持久层异常。 */
    @Test
    void update[Entity]RejectsNullId() {
        assertBusinessError(() -> [entity]Service.update[Entity](buildSaveReqVO(null, "示例名称", 0)),
                ErrorCodeConstants.[ENTITY]_NOT_EXISTS);
        verify([entity]Mapper, never()).selectById(any());
        verify([entity]Mapper, never()).updateById(any([Entity]DO.class));
    }

    /** 记录存在时删除必须真正下发删除，并把编号原样传给持久层。 */
    @Test
    void delete[Entity]DeletesExistingRecord() {
        when([entity]Mapper.selectById(1024L)).thenReturn(build[Entity](1024L, "示例名称", 0));

        [entity]Service.delete[Entity](1024L);

        verify([entity]Mapper).deleteById(1024L);
    }

    /** 记录不存在时删除必须失败，不能静默返回成功。 */
    @Test
    void delete[Entity]RejectsMissingRecord() {
        when([entity]Mapper.selectById(1024L)).thenReturn(null);

        assertBusinessError(() -> [entity]Service.delete[Entity](1024L),
                ErrorCodeConstants.[ENTITY]_NOT_EXISTS);
        verify([entity]Mapper, never()).deleteById(any(Long.class));
    }

    /** 详情查询必须原样返回持久层结果，包括不存在时的空值。 */
    @Test
    void get[Entity]ReturnsRecordOrNull() {
        [Entity]DO stored = build[Entity](1024L, "示例名称", 0);
        when([entity]Mapper.selectById(1024L)).thenReturn(stored);
        when([entity]Mapper.selectById(2048L)).thenReturn(null);

        assertThat([entity]Service.get[Entity](1024L)).isSameAs(stored);
        assertThat([entity]Service.get[Entity](2048L)).isNull();
    }

    /** 分页筛选必须真实进入 SQL：名称模糊、状态精确、按编号倒序。 */
    @Test
    void get[Entity]PageBuildsSqlFromFilters() {
        PageResult<[Entity]DO> expected = new PageResult<>(List.of(build[Entity](1024L, "示例名称", 0)), 1L);
        when([entity]Mapper.selectPage(any([Entity]PageReqVO.class), any())).thenReturn(expected);
        [Entity]PageReqVO reqVO = new [Entity]PageReqVO();
        reqVO.setName("示例");
        reqVO.setStatus(0);

        assertThat([entity]Service.get[Entity]Page(reqVO)).isSameAs(expected);

        String sql = capturePageSql(reqVO);
        assertThat(sql).contains("name LIKE").contains("status =").containsIgnoringCase("order by");
    }

    /** 空筛选不得进入 SQL，避免把“未筛选”拼成恒真条件或空结果。 */
    @Test
    void get[Entity]PageOmitsEmptyFilters() {
        when([entity]Mapper.selectPage(any([Entity]PageReqVO.class), any()))
                .thenReturn(new PageResult<>(List.of(), 0L));

        assertThat([entity]Service.get[Entity]Page(new [Entity]PageReqVO()).getTotal()).isZero();

        String sql = capturePageSql(new [Entity]PageReqVO());
        assertThat(sql).doesNotContain("name LIKE").doesNotContain("status =");
    }

    /** 捕获分页接口真实下传的 Wrapper SQL，用于断言条件是否按筛选生成。 */
    private String capturePageSql([Entity]PageReqVO reqVO) {
        ArgumentCaptor<LambdaQueryWrapperX<[Entity]DO>> captor =
                ArgumentCaptor.forClass(LambdaQueryWrapperX.class);
        verify([entity]Mapper).selectPage(any([Entity]PageReqVO.class), captor.capture());
        return captor.getValue().getTargetSql();
    }

    /** 断言调用抛出指定业务错误码，而不是其它异常或静默成功。 */
    private void assertBusinessError(ThrowingCallable callable, ErrorCode expected) {
        Throwable thrown = catchThrowable(callable);
        assertThat(thrown).as("必须以业务异常终止").isInstanceOf(ServiceException.class);
        assertThat(((ServiceException) thrown).getCode()).isEqualTo(expected.getCode());
    }

    /** 构造新增/修改请求。 */
    private [Entity]SaveReqVO buildSaveReqVO(Long id, String name, Integer status) {
        [Entity]SaveReqVO reqVO = new [Entity]SaveReqVO();
        reqVO.setId(id);
        reqVO.setName(name);
        reqVO.setStatus(status);
        reqVO.setRemark("备注");
        return reqVO;
    }

    /** 构造持久化记录。 */
    private [Entity]DO build[Entity](Long id, String name, Integer status) {
        [Entity]DO [entity] = new [Entity]DO();
        [entity].setId(id);
        [entity].setName(name);
        [entity].setStatus(status);
        return [entity];
    }

}
