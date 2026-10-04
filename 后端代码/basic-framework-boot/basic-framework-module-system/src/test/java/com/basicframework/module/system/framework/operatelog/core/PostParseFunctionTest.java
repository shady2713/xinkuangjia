package com.basicframework.module.system.framework.operatelog.core;

import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.service.dept.PostService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证操作日志的“岗位”解析函数：注册名、空值短路与岗位名称解析。
 *
 * <p>操作日志注解里写的是 {@code getPostById}，函数名写错会让日志字段直接显示原始编号；
 * 编号为空时不能去查库；查不到岗位时必须返回空串而不是 {@code null}，否则日志正文会出现
 * "null" 字样。入参来自表达式求值，数字与字符串都要按 Long 转换后查询。</p>
 *
 * @author shady2713
 */
class PostParseFunctionTest {

    /** 被测解析函数。 */
    private final PostParseFunction function = new PostParseFunction();

    /** 岗位服务替身，用于控制查询结果并核对查询入参。 */
    private final PostService postService = mock(PostService.class);

    /** 注册名必须与操作日志注解中的引用一致。 */
    @Test
    void registrationNameMatchesAnnotationReference() {
        ReflectionTestUtils.setField(function, "postService", postService);

        assertThat(PostParseFunction.NAME).isEqualTo("getPostById");
        assertThat(function.functionName()).isEqualTo("getPostById");
    }

    /** 空编号直接解析为空串且不访问岗位服务。 */
    @Test
    void emptyValueShortCircuitsWithoutQuery() {
        ReflectionTestUtils.setField(function, "postService", postService);

        assertThat(function.apply(null)).isEmpty();
        assertThat(function.apply("")).isEmpty();
        verifyNoInteractions(postService);
    }

    /** 命中的岗位按转换后的编号查询并返回岗位名称。 */
    @Test
    void existingPostParsesIntoName() {
        ReflectionTestUtils.setField(function, "postService", postService);
        PostDO post = new PostDO();
        post.setId(3L);
        post.setName("研发岗");
        when(postService.getPost(3L)).thenReturn(post);

        assertThat(function.apply("3")).as("字符串编号必须按 Long 转换后查询").isEqualTo("研发岗");
        assertThat(function.apply(3L)).isEqualTo("研发岗");
        verify(postService, times(2)).getPost(3L);
    }

    /** 岗位不存在时返回空串，不把 null 写进日志。 */
    @Test
    void missingPostParsesToEmptyString() {
        ReflectionTestUtils.setField(function, "postService", postService);
        when(postService.getPost(99L)).thenReturn(null);

        assertThat(function.apply(99L)).isEmpty();
    }

}
