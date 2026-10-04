package com.basicframework.module.system.controller.admin.logger;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogRespVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.service.logger.LoginLogService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证登录日志查询与导出的真实契约。
 *
 * <p>导出入口有两条必须锁定的行为：导出前把分页强制收敛到第一页与上限条数，避免运营传入的
 * 分页参数导致只导出当前页；总数超过上限时必须直接拒绝且**不写任何响应内容**，
 * 否则浏览器会下载到一个被截断却看似成功的文件。</p>
 *
 * <p>查询入口把持久化对象映射为响应模型，字段缺失（如未登录用户编号）必须保持为空而不是补默认值。</p>
 *
 * @author shady2713
 */
class LoginLogControllerTest {

    /** 导出上限，与生产常量一致。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    /** 被测控制器。 */
    private final LoginLogController controller = new LoginLogController();

    /**
     * 绑定字典数据，使导出时字典转换器能真实解析日志类型与登录结果。
     *
     * <p>导出表头带 {@code DictConvert}，未绑定字典接口时转换阶段会失败；
     * 这里按生产自动配置的行为提供字典数据，保证导出路径与生产一致。</p>
     */
    @BeforeEach
    void bindDictData() {
        DictFrameworkUtils.init(dictType -> switch (dictType) {
            case "system_login_type" -> List.of(dictData("登录", "100"), dictData("退出", "200"));
            case "system_login_result" -> List.of(dictData("成功", "0"), dictData("失败", "1"));
            default -> List.of();
        });
        DictFrameworkUtils.clearCache();
    }

    /** 清理字典缓存，避免静态缓存把本用例数据带出。 */
    @AfterEach
    void clearDictCache() {
        DictFrameworkUtils.clearCache();
    }

    /** 登录日志服务替身。 */
    private final LoginLogService loginLogService = mock(LoginLogService.class);

    /** 单条查询把日志字段完整映射为响应模型。 */
    @Test
    void getLoginLogMapsFields() {
        injectDependencies();
        when(loginLogService.getLoginLog(1L)).thenReturn(log(1L, "zhangsan", 0));

        CommonResult<LoginLogRespVO> result = controller.getLoginLog(1L);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData().getId()).isEqualTo(1L);
        assertThat(result.getData().getUsername()).isEqualTo("zhangsan");
        assertThat(result.getData().getResult()).isZero();
    }

    /** 分页查询保留总数与列表顺序，并把请求原样交给服务。 */
    @Test
    void getLoginLogPageKeepsTotalAndOrder() {
        injectDependencies();
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();
        reqVO.setUsername("zhangsan");
        when(loginLogService.getLoginLogPage(reqVO)).thenReturn(new PageResult<>(
                List.of(log(2L, "lisi", 1), log(1L, "zhangsan", 0)), 2L));

        CommonResult<PageResult<LoginLogRespVO>> result = controller.getLoginLogPage(reqVO);

        assertThat(result.getData().getTotal()).isEqualTo(2L);
        assertThat(result.getData().getList()).extracting(LoginLogRespVO::getUsername)
                .containsExactly("lisi", "zhangsan");
        verify(loginLogService).getLoginLogPage(reqVO);
    }

    /** 导出把分页收敛到第一页与上限条数，并写出可下载的 Excel 响应。 */
    @Test
    void exportLoginLogForcesFirstPageAndWritesWorkbook() throws Exception {
        injectDependencies();
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();
        reqVO.setPageNo(5);
        reqVO.setPageSize(10);
        when(loginLogService.getLoginLogPage(reqVO))
                .thenReturn(new PageResult<>(List.of(log(1L, "zhangsan", 0)), 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.exportLoginLog(response, reqVO);

        assertThat(reqVO.getPageNo()).as("导出必须从第一页开始").isEqualTo(1);
        assertThat(reqVO.getPageSize()).as("导出必须按上限条数取数").isEqualTo(MAX_EXPORT_SIZE);
        assertThat(response.getHeader("Content-Disposition")).isNotNull().contains("attachment;filename=");
        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(new String(response.getContentAsByteArray(), StandardCharsets.ISO_8859_1))
                .as("必须写出真实工作簿内容").isNotEmpty();
    }

    /** 超过导出上限时必须拒绝，且不写响应头与响应体，避免下载被截断的文件。 */
    @Test
    void exportLoginLogRejectsOversizedResult() {
        injectDependencies();
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();
        when(loginLogService.getLoginLogPage(reqVO))
                .thenReturn(new PageResult<>(List.of(), (long) MAX_EXPORT_SIZE + 1));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.exportLoginLog(response, reqVO))
                .isInstanceOf(ServiceException.class)
                .hasMessage("单次最多导出 10000 条日志，请缩小时间或筛选范围")
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(1_002_009_000);
        assertThat(response.getHeader("Content-Disposition")).as("拒绝时不得写入下载头").isNull();
        assertThat(response.getContentAsByteArray()).isEmpty();
    }

    /** 注入服务替身，保证控制器只访问受控边界。 */
    private void injectDependencies() {
        ReflectionTestUtils.setField(controller, "loginLogService", loginLogService);
    }

    /**
     * 构造字典数据。
     *
     * @param label 字典标签
     * @param value 字典值
     * @return 字典数据
     */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO dictData = new DictDataRespDTO();
        dictData.setLabel(label);
        dictData.setValue(value);
        return dictData;
    }

    /**
     * 构造登录日志记录。
     *
     * @param id 日志编号
     * @param username 登录账号
     * @param result 登录结果
     * @return 登录日志记录
     */
    private static LoginLogDO log(Long id, String username, Integer result) {
        LoginLogDO log = new LoginLogDO();
        log.setId(id);
        log.setLogType(100);
        log.setUsername(username);
        log.setResult(result);
        log.setUserIp("127.0.0.1");
        return log;
    }

}
