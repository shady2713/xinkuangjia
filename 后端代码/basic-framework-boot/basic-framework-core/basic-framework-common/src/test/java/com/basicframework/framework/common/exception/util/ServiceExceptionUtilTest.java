package com.basicframework.framework.common.exception.util;

import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 校验业务异常工具的错误码透传与 {@code {}} 占位符格式化契约。
 *
 * <p>该工具是所有业务异常的出口：错误码决定前端处理分支，提示文案直接展示给用户。
 * 模板依赖 {@code {}} 而不是 {@code String.format}，因此必须验证占位符与参数数量不匹配时
 * 的行为——参数过少时未替换的占位符原样保留，参数过多时忽略多余参数并保留模板中的字面
 * 内容，两种情况都不得抛出格式化异常，否则异常构造本身会变成新的故障点。</p>
 *
 * @author shady2713
 */
class ServiceExceptionUtilTest {

    /** 测试用错误码：编码与模板分离，便于断言错误码被原样透传。 */
    private static final ErrorCode TEST_ERROR_CODE = new ErrorCode(102400001, "测试错误 {}");

    /** 仅传错误码时，异常的错误码与提示必须与错误码对象完全一致。 */
    @Test
    void exceptionWithoutParamsKeepsErrorCodeMessage() {
        ServiceException exception = ServiceExceptionUtil.exception(GlobalErrorCodeConstants.BAD_REQUEST);

        assertThat(exception.getCode()).isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode());
        assertThat(exception.getMessage()).isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getMsg());
    }

    /** 传入参数时按出现顺序替换模板中的占位符，错误码保持不变。 */
    @Test
    void exceptionWithParamsFormatsPlaceholdersInOrder() {
        ServiceException exception = ServiceExceptionUtil.exception(TEST_ERROR_CODE, "用户", 7);

        assertThat(exception.getCode()).isEqualTo(TEST_ERROR_CODE.getCode());
        assertThat(exception.getMessage()).isEqualTo("测试错误 用户");
        // 第二个参数没有对应占位符，反证“参数过多”被容忍而不是抛异常。
        assertThat(exception.getMessage()).doesNotContain("7");
    }

    /** 显式错误码入口的格式化结果必须与错误码对象入口一致。 */
    @Test
    void exception0UsesGivenCodeAndTemplate() {
        ServiceException exception = ServiceExceptionUtil.exception0(400, "参数 {} 不合法", "name");

        assertThat(exception.getCode()).isEqualTo(400);
        assertThat(exception.getMessage()).isEqualTo("参数 name 不合法");
    }

    /** 请求参数错误入口固定使用 400 错误码，便于前端统一按参数错误提示。 */
    @Test
    void invalidParamExceptionUsesBadRequestCode() {
        ServiceException exception = ServiceExceptionUtil.invalidParamException("部门 {} 不存在", 9);

        assertThat(exception.getCode()).isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode());
        assertThat(exception.getCode()).isEqualTo(400);
        assertThat(exception.getMessage()).isEqualTo("部门 9 不存在");
    }

    /** 参数过少时未替换的占位符原样保留，不抛出格式化异常。 */
    @Test
    void doFormatKeepsTemplateWhenParamsAreMissing() {
        assertThat(ServiceExceptionUtil.doFormat(400, "用户 {} 状态 {} 非法", "张三"))
                .isEqualTo("用户 张三 状态 {} 非法");
        assertThat(ServiceExceptionUtil.doFormat(400, "没有占位符", new Object[0]))
                .isEqualTo("没有占位符");
    }

    /** 参数过多时忽略多余参数；模板中没有占位符时直接返回原模板。 */
    @Test
    void doFormatIgnoresRedundantParams() {
        assertThat(ServiceExceptionUtil.doFormat(400, "用户 {} 不存在", "张三", 7))
                .as("多余的参数被忽略，已替换部分保留").isEqualTo("用户 张三 不存在");
        assertThat(ServiceExceptionUtil.doFormat(400, "用户不存在", "张三"))
                .as("模板无占位符时原样返回，不拼接多余参数").isEqualTo("用户不存在");
    }

    /** 同一模板的重复占位符按顺序逐个替换。 */
    @Test
    void doFormatReplacesEveryPlaceholderInOrder() {
        assertThat(ServiceExceptionUtil.doFormat(400, "{}->{}->{}", 1, 2, 3)).isEqualTo("1->2->3");
    }

    /**
     * 工具类实例化不得影响静态格式化契约。
     *
     * <p>该工具类保留隐式公共构造方法，属框架对外可见的 API 表面；断言实例化前后静态入口
     * 的结论完全一致，避免未来把可变状态放进实例后出现“静态方法依赖实例状态”的隐性耦合。</p>
     */
    @Test
    void instantiationKeepsStaticFormattingContract() {
        String before = ServiceExceptionUtil.doFormat(400, "用户 {} 不存在", "张三");

        new ServiceExceptionUtil();

        assertThat(ServiceExceptionUtil.doFormat(400, "用户 {} 不存在", "张三"))
                .as("实例化不得改变静态格式化结果").isEqualTo(before);
        assertThat(ServiceExceptionUtil.invalidParamException("参数 {} 不合法", "name").getCode())
                .as("实例化后静态入口仍返回 400 参数错误").isEqualTo(400);
    }
}
