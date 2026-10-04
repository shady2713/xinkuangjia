package com.basicframework.module.system.controller.admin.dept;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptRespVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSaveReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.service.dept.DeptService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证部门管理接口的参数传递、响应封装与模型转换契约。
 *
 * <p>控制器是权限校验之后的业务入口：写操作必须把请求原样交给服务并返回新编号或成功标记，
 * 查询必须把持久对象转换成响应模型（不得把持久字段直接暴露）并保留状态等业务字段。
 * 精简列表还有一个真实约定：只查询启用状态的部门，供前端下拉使用。用例用真实请求对象与
 * 替身服务断言这些可观察结果，不依赖实现内部的同名字段。</p>
 *
 * @author shady2713
 */
class DeptControllerTest {

    /** 被测控制器。 */
    private DeptController controller;
    /** 部门服务替身，用于隔离持久层并观察调用参数。 */
    private DeptService deptService;

    /** 为每个用例装配独立控制器与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        controller = new DeptController();
        deptService = mock(DeptService.class);
        ReflectionTestUtils.setField(controller, "deptService", deptService);
    }

    /** 创建部门必须返回服务生成的编号，并把请求原样下传。 */
    @Test
    void createDeptReturnsGeneratedId() {
        DeptSaveReqVO reqVO = new DeptSaveReqVO();
        reqVO.setName("DUMMY-研发部");
        reqVO.setParentId(0L);
        when(deptService.createDept(any())).thenReturn(1024L);

        CommonResult<Long> result = controller.createDept(reqVO);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).as("必须返回服务生成的部门编号").isEqualTo(1024L);
        assertThat(captureCreatedReqVO().getName()).isEqualTo("DUMMY-研发部");
    }

    /** 更新与删除必须返回成功标记，并把编号原样下传。 */
    @Test
    void updateAndDeleteDeptDelegateIdentifiers() {
        DeptSaveReqVO updateReqVO = new DeptSaveReqVO();
        updateReqVO.setId(7L);
        updateReqVO.setName("DUMMY-更新后");

        assertThat(controller.updateDept(updateReqVO).getData()).as("更新必须返回成功").isTrue();
        verify(deptService).updateDept(updateReqVO);
        assertThat(controller.deleteDept(8L).getData()).as("单个删除必须返回成功").isTrue();
        verify(deptService).deleteDept(8L);
        assertThat(controller.deleteDeptList(List.of(9L, 10L)).getData()).as("批量删除必须返回成功").isTrue();
        verify(deptService).deleteDeptList(List.of(9L, 10L));
    }

    /** 列表查询必须把持久对象转换为响应模型，并保留状态等业务字段。 */
    @Test
    void getDeptListConvertsToResponseModel() {
        DeptListReqVO reqVO = new DeptListReqVO();
        reqVO.setName("DUMMY");
        when(deptService.getDeptList(any(DeptListReqVO.class))).thenReturn(List.of(
                dept(1L, "研发部", CommonStatusEnum.ENABLE.getStatus()),
                dept(2L, "财务部", CommonStatusEnum.DISABLE.getStatus())));

        CommonResult<List<DeptRespVO>> result = controller.getDeptList(reqVO);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).extracting(DeptRespVO::getName).containsExactly("研发部", "财务部");
        assertThat(result.getData()).extracting(DeptRespVO::getStatus)
                .containsExactly(CommonStatusEnum.ENABLE.getStatus(), CommonStatusEnum.DISABLE.getStatus());
    }

    /** 精简列表必须只查询启用状态的部门，并转换为精简响应模型。 */
    @Test
    void getSimpleDeptListRequestsEnabledOnly() {
        when(deptService.getDeptList(any(DeptListReqVO.class)))
                .thenReturn(List.of(dept(3L, "客服部", CommonStatusEnum.ENABLE.getStatus())));

        CommonResult<List<DeptSimpleRespVO>> result = controller.getSimpleDeptList();

        ArgumentCaptor<DeptListReqVO> captor = ArgumentCaptor.forClass(DeptListReqVO.class);
        verify(deptService).getDeptList(captor.capture());
        assertThat(captor.getValue().getStatus()).as("下拉选项必须只取启用状态的部门")
                .isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(result.getData()).extracting(DeptSimpleRespVO::getName).containsExactly("客服部");
    }

    /** 单个部门查询必须按下传编号读取并转换为响应模型。 */
    @Test
    void getDeptConvertsSingleRecord() {
        when(deptService.getDept(11L)).thenReturn(dept(11L, "研发部", CommonStatusEnum.ENABLE.getStatus()));

        CommonResult<DeptRespVO> result = controller.getDept(11L);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData().getId()).isEqualTo(11L);
        assertThat(result.getData().getName()).isEqualTo("研发部");
    }

    /** 取出创建请求的捕获值，供断言真实下传内容。 */
    private DeptSaveReqVO captureCreatedReqVO() {
        ArgumentCaptor<DeptSaveReqVO> captor = ArgumentCaptor.forClass(DeptSaveReqVO.class);
        verify(deptService).createDept(captor.capture());
        return captor.getValue();
    }

    /**
     * 构造部门持久对象，仅填充断言涉及的字段。
     *
     * @param id 编号
     * @param name 名称
     * @param status 状态
     * @return 部门持久对象
     */
    private static DeptDO dept(Long id, String name, Integer status) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        dept.setStatus(status);
        return dept;
    }

}
