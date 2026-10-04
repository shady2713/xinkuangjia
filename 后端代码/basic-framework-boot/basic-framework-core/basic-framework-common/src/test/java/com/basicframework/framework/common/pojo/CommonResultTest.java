package com.basicframework.framework.common.pojo;

import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.util.json.JsonUtils;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证通用返回对象的构建、错误判定与异常集成的实际契约。
 *
 * <p>该对象是后端所有 HTTP 接口的统一响应载体，前端只认 {@code code}/{@code msg}/{@code data}
 * 三个字段，服务内部则依赖它把业务错误在调用链上传递。用例固定以下可观察行为：成功响应固定为
 * 成功码、空提示并原样携带数据；错误响应拒绝成功码以免"错误"被伪装成成功；把错误响应转成
 * {@link ServiceException} 时错误码与提示必须无损搬运；{@code isSuccess}/{@code getCheckedData}
 * 带 {@code @JsonIgnore}，不得出现在序列化结果里，否则前端会把方法当字段读取。</p>
 *
 * @author shady2713
 */
class CommonResultTest {

    /** 带占位符的业务错误码，用于验证提示信息的实际格式化结果。 */
    private static final ErrorCode PARAMETERIZED_ERROR = new ErrorCode(1_000_000_101, "编号({})不存在");

    /**
     * 错误响应必须原样搬运来源响应的错误码与提示，且不得携带数据。
     */
    @Test
    void errorFromResultCopiesCodeAndMessage() {
        CommonResult<Integer> source = CommonResult.error(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "请求参数不正确");

        CommonResult<String> converted = CommonResult.error(source);

        assertThat(converted.getCode()).isEqualTo(GlobalErrorCodeConstants.BAD_REQUEST.getCode());
        assertThat(converted.getMsg()).isEqualTo("请求参数不正确");
        assertThat(converted.getData()).isNull();
    }

    /**
     * 成功响应不得作为错误来源，否则会把成功码当成错误码继续向上传播。
     */
    @Test
    void errorFromResultRejectsSuccessCode() {
        CommonResult<String> success = CommonResult.success("data");

        assertThatThrownBy(() -> CommonResult.error(success))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("code 必须是错误的");
    }

    /**
     * 直接以错误码和提示构建错误响应，并把成功码视为非法入参。
     */
    @Test
    void errorFromCodeAndMessageStoresBoth() {
        CommonResult<Void> result = CommonResult.error(GlobalErrorCodeConstants.FORBIDDEN.getCode(), "没有该操作权限");

        assertThat(result.getCode()).isEqualTo(GlobalErrorCodeConstants.FORBIDDEN.getCode());
        assertThat(result.getMsg()).isEqualTo("没有该操作权限");
        assertThat(result.getData()).isNull();
        assertThatThrownBy(() -> CommonResult.error(GlobalErrorCodeConstants.SUCCESS.getCode(), "成功"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("code 必须是错误的");
    }

    /**
     * 使用错误码枚举构建时，提示必须按占位参数格式化，缺参数时保留占位符原样输出。
     */
    @Test
    void errorFromErrorCodeFormatsMessage() {
        CommonResult<Void> formatted = CommonResult.error(PARAMETERIZED_ERROR, 1024L);
        CommonResult<Void> withoutParams = CommonResult.error(PARAMETERIZED_ERROR);

        assertThat(formatted.getCode()).isEqualTo(PARAMETERIZED_ERROR.getCode());
        assertThat(formatted.getMsg()).isEqualTo("编号(1024)不存在");
        assertThat(withoutParams.getMsg()).as("缺少占位参数时保留原模板，不能抛错").isEqualTo("编号({})不存在");
        assertThat(CommonResult.error(GlobalErrorCodeConstants.NOT_FOUND).getMsg()).isEqualTo("请求未找到");
        assertThatThrownBy(() -> CommonResult.error(GlobalErrorCodeConstants.SUCCESS))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("code 必须是错误的");
    }

    /**
     * 成功响应固定使用成功码与空提示，数据原样携带，且允许数据为 null。
     */
    @Test
    void successCarriesDataWithSuccessCode() {
        CommonResult<Integer> result = CommonResult.success(7);
        CommonResult<Object> empty = CommonResult.success(null);

        assertThat(result.getCode()).isEqualTo(GlobalErrorCodeConstants.SUCCESS.getCode());
        assertThat(result.getMsg()).isEmpty();
        assertThat(result.getData()).isEqualTo(7);
        assertThat(empty.getCode()).isEqualTo(GlobalErrorCodeConstants.SUCCESS.getCode());
        assertThat(empty.getData()).isNull();
        assertThat(empty.isSuccess()).isTrue();
    }

    /**
     * 静态成功判定只接受成功码，null 与其他错误码一律判为失败。
     */
    @Test
    void staticSuccessCheckOnlyAcceptsSuccessCode() {
        assertThat(CommonResult.isSuccess(GlobalErrorCodeConstants.SUCCESS.getCode())).isTrue();
        assertThat(CommonResult.isSuccess(GlobalErrorCodeConstants.BAD_REQUEST.getCode())).isFalse();
        assertThat(CommonResult.isSuccess(null)).as("缺少错误码时不能判为成功").isFalse();
    }

    /**
     * 实例成功/失败判定必须跟随自身错误码，二者互为否定。
     */
    @Test
    void instanceSuccessAndErrorFollowOwnCode() {
        CommonResult<String> success = CommonResult.success("data");
        CommonResult<String> error = CommonResult.error(GlobalErrorCodeConstants.INTERNAL_SERVER_ERROR);

        assertThat(success.isSuccess()).isTrue();
        assertThat(success.isError()).isFalse();
        assertThat(error.isSuccess()).isFalse();
        assertThat(error.isError()).isTrue();
    }

    /**
     * 校验错误时成功响应直接返回，失败响应抛出携带相同错误码与提示的业务异常。
     */
    @Test
    void checkErrorThrowsServiceExceptionForErrorResult() {
        CommonResult<String> success = CommonResult.success("data");
        CommonResult<String> error = CommonResult.error(GlobalErrorCodeConstants.LOCKED.getCode(), "请求失败，请稍后重试");

        success.checkError();

        assertThatThrownBy(error::checkError)
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", GlobalErrorCodeConstants.LOCKED.getCode())
                .hasMessage("请求失败，请稍后重试");
    }

    /**
     * 取校验后数据时，成功响应返回数据本身，失败响应抛出业务异常而不返回 null。
     */
    @Test
    void getCheckedDataReturnsDataOrThrows() {
        CommonResult<String> success = CommonResult.success("payload");
        CommonResult<String> error = CommonResult.error(GlobalErrorCodeConstants.UNAUTHORIZED);

        assertThat(success.getCheckedData()).isEqualTo("payload");
        assertThatThrownBy(error::getCheckedData)
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", GlobalErrorCodeConstants.UNAUTHORIZED.getCode())
                .hasMessage("账号未登录");
    }

    /**
     * 根据业务异常构建错误响应时，错误码与提示必须与异常一致。
     */
    @Test
    void errorFromServiceExceptionKeepsExceptionFields() {
        ServiceException exception = new ServiceException(1_000_000_102, "字典类型不存在");

        CommonResult<Void> result = CommonResult.error(exception);

        assertThat(result.getCode()).isEqualTo(1_000_000_102);
        assertThat(result.getMsg()).isEqualTo("字典类型不存在");
        assertThat(result.getData()).isNull();
    }

    /**
     * 序列化结果只包含协议字段，被 {@code @JsonIgnore} 标记的判定与取值方法不得成为字段。
     */
    @Test
    void jsonOutputKeepsProtocolFieldsOnly() {
        CommonResult<Integer> result = CommonResult.success(7);

        String json = JsonUtils.toJsonString(result);
        CommonResult<?> parsed = JsonUtils.parseObject(json, CommonResult.class);

        assertThat(json).doesNotContain("success", "error", "checkedData");
        assertThat(parsed.getCode()).isEqualTo(GlobalErrorCodeConstants.SUCCESS.getCode());
        assertThat(parsed.getData()).isEqualTo(7);
        assertThat(parsed.getMsg()).isEmpty();
    }

}
