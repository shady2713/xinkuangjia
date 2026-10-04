package com.basicframework.module.system.framework.operatelog.core;

import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.service.dept.DeptService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证操作日志的“部门”解析函数：注册名、空值短路与部门名称解析。
 *
 * <p>操作日志注解里写的是 {@code getDeptById}，函数名写错会让日志字段直接显示原始编号；
 * 编号为空时不能去查库，否则空值会变成一次无意义查询；查不到部门时必须返回空串而不是
 * {@code null}，否则日志正文会出现 "null" 字样或让格式化失败。</p>
 *
 * <p>入参来自日志注解的表达式求值，可能是数字也可能是字符串，函数统一按 Long 转换后查询，
 * 因此同时锁定“按转换后的编号查询”这一真实调用参数。</p>
 *
 * @author shady2713
 */
class DeptParseFunctionTest {

    /** 被测解析函数。 */
    private final DeptParseFunction function = new DeptParseFunction();

    /** 部门服务替身，用于控制查询结果并核对查询入参。 */
    private final DeptService deptService = mock(DeptService.class);

    /** 注入部门服务替身。 */
    @Test
    void registrationNameMatchesAnnotationReference() {
        ReflectionTestUtils.setField(function, "deptService", deptService);

        assertThat(DeptParseFunction.NAME).isEqualTo("getDeptById");
        assertThat(function.functionName()).isEqualTo("getDeptById");
    }

    /** 空编号直接解析为空串且不访问部门服务。 */
    @Test
    void emptyValueShortCircuitsWithoutQuery() {
        ReflectionTestUtils.setField(function, "deptService", deptService);

        assertThat(function.apply(null)).isEmpty();
        assertThat(function.apply("")).isEmpty();
        verifyNoInteractions(deptService);
    }

    /** 命中的部门按转换后的编号查询并返回部门名称。 */
    @Test
    void existingDeptParsesIntoName() {
        ReflectionTestUtils.setField(function, "deptService", deptService);
        DeptDO dept = new DeptDO();
        dept.setId(7L);
        dept.setName("研发部");
        when(deptService.getDept(7L)).thenReturn(dept);

        assertThat(function.apply("7")).as("字符串编号必须按 Long 转换后查询").isEqualTo("研发部");
        assertThat(function.apply(7L)).isEqualTo("研发部");
        verify(deptService, times(2)).getDept(7L);
    }

    /** 部门不存在时返回空串，不把 null 写进日志。 */
    @Test
    void missingDeptParsesToEmptyString() {
        ReflectionTestUtils.setField(function, "deptService", deptService);
        when(deptService.getDept(99L)).thenReturn(null);

        assertThat(function.apply(99L)).isEmpty();
    }

}
