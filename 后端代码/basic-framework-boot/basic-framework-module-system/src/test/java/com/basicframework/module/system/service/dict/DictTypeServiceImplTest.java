package com.basicframework.module.system.service.dict;

import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import com.basicframework.module.system.dal.mysql.dict.DictTypeMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证字典类型服务的唯一性校验、软删除前置检查与批量删除契约。
 *
 * <p>字典类型是字典数据的父级：名称与编码重复会让前端无法区分字典；删除前必须确认没有字典数据，
 * 否则会留下无父级的字典项；批量删除必须一次校验、一次更新，并在编号缺失或数量不匹配时
 * 整体拒绝而不是部分删除。</p>
 *
 * <p>历史生产缺陷（已修）：{@code DictTypeMapper.updateToDelete} 与 {@code updateToDeleteByIds} 曾用实体式
 * update，而 {@code BaseDO.deleted} 带 {@code @TableLogic}，MyBatis-Plus 会静默丢弃逻辑删除列的赋值，
 * 造成"删除成功但记录仍在"。现改为经 {@code LambdaUpdateWrapper.set} 显式写入逻辑删除列，真实落库
 * 行为由 {@code DictMapperMySqlIT} 覆盖；本用例只断言服务层发出的删除调用与参数。</p>
 *
 * <p>持久层与字典数据服务按进程外边界替换为替身，服务内的校验与异常逻辑真实执行，
 * 异常断言逐条核对真实业务错误码。</p>
 *
 * @author shady2713
 */
class DictTypeServiceImplTest {

    /** 软删除唯一索引使用的非空占位时间，与实现保持同一口径。 */
    private static final LocalDateTime EMPTY_DELETED_TIME = LocalDateTime.of(1970, 1, 1, 0, 0);

    /** 被测服务。 */
    private DictTypeServiceImpl dictTypeService;
    /** 字典类型持久层替身。 */
    private DictTypeMapper dictTypeMapper;
    /** 字典数据服务替身，服务经延迟提供者获取以避免初始化循环依赖。 */
    private DictDataService dictDataService;

    /** 装配服务与替身。 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        dictTypeService = new DictTypeServiceImpl();
        dictTypeMapper = mock(DictTypeMapper.class);
        dictDataService = mock(DictDataService.class);
        ObjectProvider<DictDataService> dictDataServiceProvider = mock(ObjectProvider.class);
        when(dictDataServiceProvider.getObject()).thenReturn(dictDataService);
        ReflectionTestUtils.setField(dictTypeService, "dictTypeMapper", dictTypeMapper);
        ReflectionTestUtils.setField(dictTypeService, "dictDataServiceProvider", dictDataServiceProvider);
    }

    /**
     * 删除审计必须记录本次操作人，而不是沿用上一位操作人。
     *
     * <p>软删除走 {@code update(null, wrapper)}，空实体不触发 MyBatis-Plus 的 {@code updateFill}，
     * 所以服务层必须自己把当前登录用户传给持久层；这里用两位不同操作人连续删除，
     * 证明每次传入的都是当次登录者，而不是第一次的残留值。</p>
     */
    @Test
    void deleteRecordsCurrentOperatorInsteadOfPreviousOne() {
        when(dictTypeMapper.selectById(1L)).thenReturn(dictType(1L, "DUMMY-名称一", "DUMMY_TYPE_ONE"));
        when(dictTypeMapper.selectById(2L)).thenReturn(dictType(2L, "DUMMY-名称二", "DUMMY_TYPE_TWO"));
        when(dictDataService.getDictDataCountByDictType(any())).thenReturn(0L);

        // 第一位操作人删除，服务必须把 1001 作为操作人传给持久层
        loginAs(1001L);
        dictTypeService.deleteDictType(1L);
        verify(dictTypeMapper).updateToDelete(eq(1L), any(LocalDateTime.class), eq("1001"));

        // 第二位操作人删除同一个服务实例的另一条记录，操作人必须随之改变
        loginAs(2002L);
        dictTypeService.deleteDictType(2L);
        verify(dictTypeMapper).updateToDelete(eq(2L), any(LocalDateTime.class), eq("2002"));
        verify(dictTypeMapper, never()).updateToDelete(eq(2L), any(LocalDateTime.class), eq("1001"));
    }

    /**
     * 批量删除同样必须携带本次操作人。
     *
     * <p>批量路径与单条路径共用同一套软删除语义，若只在单条路径传操作人，
     * 批量删除仍会把审计记到上一位操作人名下。</p>
     */
    @Test
    void batchDeleteRecordsCurrentOperator() {
        when(dictTypeMapper.selectByIds(List.of(1L, 2L)))
                .thenReturn(List.of(dictType(1L, "DUMMY-名称一", "DUMMY_TYPE_ONE"),
                        dictType(2L, "DUMMY-名称二", "DUMMY_TYPE_TWO")));
        when(dictDataService.getDictDataCountByDictTypes(anyCollection())).thenReturn(0L);

        loginAs(3003L);
        dictTypeService.deleteDictTypeList(List.of(1L, 2L));

        verify(dictTypeMapper).updateToDeleteByIds(eq(List.of(1L, 2L)), any(LocalDateTime.class), eq("3003"));
    }

    /**
     * 让后续调用处于指定用户已登录的上下文，并返回清理动作。
     *
     * @param userId 登录用户编号
     */
    private void loginAs(Long userId) {
        SecurityFrameworkUtils.setLoginUser(
                new LoginUser().setId(userId).setUserType(1), new MockHttpServletRequest());
    }

    /**
     * 清理登录上下文。
     *
     * <p>{@code setLoginUser} 把用户写进线程本地的安全上下文，用例之间共享线程；
     * 不清理会让后续用例意外带上登录用户，把"无登录上下文时操作人为空"的断言弄红。</p>
     */
    @AfterEach
    void clearLoginContext() {
        SecurityContextHolder.clearContext();
    }

    /** 分页、按编号、按编码与全量查询必须原样转发到持久层。 */
    @Test
    void queryMethodsDelegateToMapper() {
        DictTypePageReqVO pageReqVO = new DictTypePageReqVO();
        when(dictTypeMapper.selectPage(pageReqVO))
                .thenReturn(new PageResult<>(List.of(dictType(1L, "DUMMY-名称", "DUMMY_TYPE")), 1L));
        assertThat(dictTypeService.getDictTypePage(pageReqVO).getTotal()).isEqualTo(1L);

        when(dictTypeMapper.selectById(1L)).thenReturn(dictType(1L, "DUMMY-名称", "DUMMY_TYPE"));
        assertThat(dictTypeService.getDictType(1L).getType()).isEqualTo("DUMMY_TYPE");

        when(dictTypeMapper.selectByType("DUMMY_TYPE")).thenReturn(dictType(1L, "DUMMY-名称", "DUMMY_TYPE"));
        assertThat(dictTypeService.getDictType("DUMMY_TYPE").getName()).isEqualTo("DUMMY-名称");

        when(dictTypeMapper.selectList()).thenReturn(List.of(dictType(1L, "DUMMY-名称", "DUMMY_TYPE")));
        assertThat(dictTypeService.getDictTypeList()).hasSize(1);
    }

    /** 创建字典类型必须校验名称与编码唯一，并写入软删除占位时间避免唯一索引冲突。 */
    @Test
    void createDictTypeValidatesUniquenessAndFillsPlaceholderTime() {
        DictTypeSaveReqVO reqVO = new DictTypeSaveReqVO();
        reqVO.setName("DUMMY-名称");
        reqVO.setType("DUMMY_TYPE");
        when(dictTypeMapper.selectByName("DUMMY-名称")).thenReturn(null);
        when(dictTypeMapper.selectByType("DUMMY_TYPE")).thenReturn(null);

        dictTypeService.createDictType(reqVO);

        ArgumentCaptor<DictTypeDO> captor = ArgumentCaptor.forClass(DictTypeDO.class);
        verify(dictTypeMapper).insert(captor.capture());
        assertThat(captor.getValue().getName()).isEqualTo("DUMMY-名称");
        assertThat(captor.getValue().getDeletedTime())
                .as("必须写入非空占位时间，否则软删除唯一索引在 null 值下失效")
                .isEqualTo(EMPTY_DELETED_TIME);
    }

    /** 创建字典类型遇到同名或同编码时必须拒绝，且不得落库。 */
    @Test
    void createDictTypeRejectsDuplicateNameAndType() {
        DictTypeSaveReqVO duplicateName = new DictTypeSaveReqVO();
        duplicateName.setName("DUMMY-名称");
        duplicateName.setType("DUMMY_TYPE");
        when(dictTypeMapper.selectByName("DUMMY-名称")).thenReturn(dictType(1L, "DUMMY-名称", "OTHER_TYPE"));
        assertBusinessError(() -> dictTypeService.createDictType(duplicateName),
                ErrorCodeConstants.DICT_TYPE_NAME_DUPLICATE);

        DictTypeSaveReqVO duplicateType = new DictTypeSaveReqVO();
        duplicateType.setName("DUMMY-其它名称");
        duplicateType.setType("DUMMY_TYPE");
        when(dictTypeMapper.selectByName("DUMMY-其它名称")).thenReturn(null);
        when(dictTypeMapper.selectByType("DUMMY_TYPE")).thenReturn(dictType(1L, "OTHER_NAME", "DUMMY_TYPE"));
        assertBusinessError(() -> dictTypeService.createDictType(duplicateType),
                ErrorCodeConstants.DICT_TYPE_TYPE_DUPLICATE);

        verify(dictTypeMapper, never()).insert(any(DictTypeDO.class));
    }

    /** 更新字典类型必须校验存在性与唯一性后写库；不存在时拒绝。 */
    @Test
    void updateDictTypeValidatesAndWrites() {
        DictTypeSaveReqVO reqVO = new DictTypeSaveReqVO();
        reqVO.setId(1L);
        reqVO.setName("DUMMY-名称");
        reqVO.setType("DUMMY_TYPE");
        when(dictTypeMapper.selectById(1L)).thenReturn(dictType(1L, "DUMMY-名称", "DUMMY_TYPE"));
        when(dictTypeMapper.selectByName("DUMMY-名称")).thenReturn(dictType(1L, "DUMMY-名称", "DUMMY_TYPE"));
        when(dictTypeMapper.selectByType("DUMMY_TYPE")).thenReturn(dictType(1L, "DUMMY-名称", "DUMMY_TYPE"));

        dictTypeService.updateDictType(reqVO);

        ArgumentCaptor<DictTypeDO> captor = ArgumentCaptor.forClass(DictTypeDO.class);
        verify(dictTypeMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);

        DictTypeSaveReqVO absent = new DictTypeSaveReqVO();
        absent.setId(9L);
        absent.setName("DUMMY-名称");
        absent.setType("DUMMY_TYPE");
        when(dictTypeMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> dictTypeService.updateDictType(absent), ErrorCodeConstants.DICT_TYPE_NOT_EXISTS);
    }

    /** 删除字典类型前必须确认没有字典数据，通过后按编号与当前时间软删除。 */
    @Test
    void deleteDictTypeChecksChildrenThenSoftDeletes() {
        when(dictTypeMapper.selectById(1L)).thenReturn(dictType(1L, "DUMMY-名称", "DUMMY_TYPE"));
        when(dictDataService.getDictDataCountByDictType("DUMMY_TYPE")).thenReturn(0L);

        dictTypeService.deleteDictType(1L);

        ArgumentCaptor<LocalDateTime> deletedTime = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(dictTypeMapper).updateToDelete(eq(1L), deletedTime.capture(), eq(null));
        assertThat(deletedTime.getValue()).isNotNull();

        when(dictDataService.getDictDataCountByDictType("DUMMY_TYPE")).thenReturn(2L);
        assertBusinessError(() -> dictTypeService.deleteDictType(1L), ErrorCodeConstants.DICT_TYPE_HAS_CHILDREN);
    }

    /** 批量删除必须跳过空集合，拒绝含空编号、数量不匹配与仍有字典数据的请求。 */
    @Test
    void deleteDictTypeListRejectsInvalidRequests() {
        dictTypeService.deleteDictTypeList(Collections.emptyList());
        verify(dictTypeMapper, never()).selectByIds(anyCollection());

        assertBusinessError(() -> dictTypeService.deleteDictTypeList(Arrays.asList(1L, null)),
                ErrorCodeConstants.DICT_TYPE_NOT_EXISTS);

        when(dictTypeMapper.selectByIds(List.of(1L, 2L)))
                .thenReturn(List.of(dictType(1L, "DUMMY-名称", "DUMMY_TYPE")));
        assertBusinessError(() -> dictTypeService.deleteDictTypeList(List.of(1L, 2L)),
                ErrorCodeConstants.DICT_TYPE_NOT_EXISTS);

        when(dictTypeMapper.selectByIds(List.of(1L)))
                .thenReturn(List.of(dictType(1L, "DUMMY-名称", "DUMMY_TYPE")));
        when(dictDataService.getDictDataCountByDictTypes(List.of("DUMMY_TYPE"))).thenReturn(1L);
        assertBusinessError(() -> dictTypeService.deleteDictTypeList(List.of(1L)),
                ErrorCodeConstants.DICT_TYPE_HAS_CHILDREN);
    }

    /** 批量删除必须先去重再一次性更新，避免重复编号造成重复计数与重复删除。 */
    @Test
    void deleteDictTypeListDeduplicatesAndDeletesOnce() {
        when(dictTypeMapper.selectByIds(List.of(1L, 2L))).thenReturn(List.of(
                dictType(1L, "DUMMY-名称1", "DUMMY_TYPE_1"), dictType(2L, "DUMMY-名称2", "DUMMY_TYPE_2")));
        when(dictDataService.getDictDataCountByDictTypes(List.of("DUMMY_TYPE_1", "DUMMY_TYPE_2"))).thenReturn(0L);

        dictTypeService.deleteDictTypeList(List.of(1L, 1L, 2L));

        ArgumentCaptor<LocalDateTime> deletedTime = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(dictTypeMapper).updateToDeleteByIds(eq(List.of(1L, 2L)), deletedTime.capture(), eq(null));
        assertThat(deletedTime.getValue()).isNotNull();
    }

    /** 名称唯一性校验必须区分未命中、新增冲突、改到他人名称与保持自身名称。 */
    @Test
    void validateDictTypeNameUniqueDistinguishesCases() {
        when(dictTypeMapper.selectByName("DUMMY-名称")).thenReturn(null);
        dictTypeService.validateDictTypeNameUnique(1L, "DUMMY-名称");

        when(dictTypeMapper.selectByName("DUMMY-名称")).thenReturn(dictType(2L, "DUMMY-名称", "DUMMY_TYPE"));
        assertBusinessError(() -> dictTypeService.validateDictTypeNameUnique(null, "DUMMY-名称"),
                ErrorCodeConstants.DICT_TYPE_NAME_DUPLICATE);
        assertBusinessError(() -> dictTypeService.validateDictTypeNameUnique(1L, "DUMMY-名称"),
                ErrorCodeConstants.DICT_TYPE_NAME_DUPLICATE);

        dictTypeService.validateDictTypeNameUnique(2L, "DUMMY-名称");
    }

    /** 编码唯一性校验必须跳过空编码，并区分未命中、新增冲突、改到他人编码与保持自身编码。 */
    @Test
    void validateDictTypeUniqueDistinguishesCases() {
        dictTypeService.validateDictTypeUnique(1L, "");
        verify(dictTypeMapper, never()).selectByType("");

        when(dictTypeMapper.selectByType("DUMMY_TYPE")).thenReturn(null);
        dictTypeService.validateDictTypeUnique(1L, "DUMMY_TYPE");

        when(dictTypeMapper.selectByType("DUMMY_TYPE")).thenReturn(dictType(2L, "DUMMY-名称", "DUMMY_TYPE"));
        assertBusinessError(() -> dictTypeService.validateDictTypeUnique(null, "DUMMY_TYPE"),
                ErrorCodeConstants.DICT_TYPE_TYPE_DUPLICATE);
        assertBusinessError(() -> dictTypeService.validateDictTypeUnique(1L, "DUMMY_TYPE"),
                ErrorCodeConstants.DICT_TYPE_TYPE_DUPLICATE);

        dictTypeService.validateDictTypeUnique(2L, "DUMMY_TYPE");
    }

    /** 存在性校验对空编号返回空，对不存在编号抛错，命中时返回真实记录。 */
    @Test
    void validateDictTypeExistsReturnsRecordOrRejects() {
        assertThat(dictTypeService.validateDictTypeExists(null)).isNull();
        verify(dictTypeMapper, never()).selectById(null);

        when(dictTypeMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> dictTypeService.validateDictTypeExists(9L), ErrorCodeConstants.DICT_TYPE_NOT_EXISTS);

        when(dictTypeMapper.selectById(1L)).thenReturn(dictType(1L, "DUMMY-名称", "DUMMY_TYPE"));
        assertThat(dictTypeService.validateDictTypeExists(1L).getType()).isEqualTo("DUMMY_TYPE");
    }

    /**
     * 断言业务异常的错误码。
     *
     * @param action 触发业务校验的动作
     * @param expected 期望的业务错误码
     */
    private static void assertBusinessError(ThrowingCallable action, ErrorCode expected) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expected.getCode()));
    }

    /** 构造字典类型持久对象。 */
    private static DictTypeDO dictType(Long id, String name, String type) {
        DictTypeDO dictType = new DictTypeDO();
        dictType.setId(id);
        dictType.setName(name);
        dictType.setType(type);
        return dictType;
    }

}
