package com.basicframework.module.system.controller.admin.logger;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.translate.core.TranslateUtils;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogRespVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.service.logger.OperateLogService;
import com.fhs.trans.service.impl.TransService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证操作日志查询与导出的真实契约。
 *
 * <p>操作日志的“操作人”“部门”等字段以编号落库，导出前必须经过翻译，否则导出的表格里
 * 只有编号无法阅读；导出同样把分页收敛到第一页与上限条数，超限时直接拒绝且不写响应内容。
 * 查询入口只做模型映射，不做翻译（翻译由响应注解在返回后完成），避免重复翻译与额外查询。</p>
 *
 * @author shady2713
 */
class OperateLogControllerTest {

    /** 导出上限，与生产常量一致。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    /** 被测控制器。 */
    private final OperateLogController controller = new OperateLogController();

    /** 操作日志服务替身。 */
    private final OperateLogService operateLogService = mock(OperateLogService.class);
    /** 翻译服务替身，用于确认导出前完成翻译。 */
    private final TransService transService = mock(TransService.class);

    /** 恢复翻译入口为独立的替身，避免把本用例状态带给其它用例。 */
    @AfterEach
    void resetTranslateUtils() {
        TranslateUtils.init(mock(TransService.class));
    }

    /** 单条查询把日志字段映射为响应模型。 */
    @Test
    void getOperateLogMapsFields() {
        injectDependencies();
        when(operateLogService.getOperateLog(1L)).thenReturn(log(1L, "USER", "新增用户"));

        CommonResult<OperateLogRespVO> result = controller.getOperateLog(1L);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData().getId()).isEqualTo(1L);
        assertThat(result.getData().getType()).isEqualTo("USER");
        assertThat(result.getData().getAction()).isEqualTo("新增用户");
    }

    /** 分页查询保留总数与列表，并把请求原样交给服务。 */
    @Test
    void pageOperateLogKeepsTotalAndOrder() {
        injectDependencies();
        OperateLogPageReqVO reqVO = new OperateLogPageReqVO();
        reqVO.setUserId(7L);
        when(operateLogService.getOperateLogPage(reqVO)).thenReturn(new PageResult<>(
                List.of(log(2L, "ROLE", "新增角色"), log(1L, "USER", "新增用户")), 2L));

        CommonResult<PageResult<OperateLogRespVO>> result = controller.pageOperateLog(reqVO);

        assertThat(result.getData().getTotal()).isEqualTo(2L);
        assertThat(result.getData().getList()).extracting(OperateLogRespVO::getAction)
                .containsExactly("新增角色", "新增用户");
        verify(operateLogService).getOperateLogPage(reqVO);
    }

    /** 导出必须收敛分页、先翻译再写出工作簿。 */
    @Test
    void exportOperateLogTranslatesBeforeWritingWorkbook() throws Exception {
        injectDependencies();
        TranslateUtils.init(transService);
        OperateLogPageReqVO reqVO = new OperateLogPageReqVO();
        reqVO.setPageNo(3);
        reqVO.setPageSize(20);
        when(operateLogService.getOperateLogPage(reqVO))
                .thenReturn(new PageResult<>(List.of(log(1L, "USER", "新增用户")), 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.exportOperateLog(response, reqVO);

        assertThat(reqVO.getPageNo()).as("导出必须从第一页开始").isEqualTo(1);
        assertThat(reqVO.getPageSize()).as("导出必须按上限条数取数").isEqualTo(MAX_EXPORT_SIZE);
        ArgumentCaptor<List<OperateLogRespVO>> captor = ArgumentCaptor.forClass(List.class);
        verify(transService).transBatch(captor.capture());
        assertThat(captor.getValue()).extracting(OperateLogRespVO::getAction).containsExactly("新增用户");
        assertThat(response.getHeader("Content-Disposition")).isNotNull().contains("attachment;filename=");
        assertThat(response.getContentAsByteArray()).isNotEmpty();
    }

    /** 超过导出上限时必须拒绝，且不翻译、不写响应。 */
    @Test
    void exportOperateLogRejectsOversizedResult() {
        injectDependencies();
        TranslateUtils.init(transService);
        OperateLogPageReqVO reqVO = new OperateLogPageReqVO();
        when(operateLogService.getOperateLogPage(reqVO))
                .thenReturn(new PageResult<>(List.of(), (long) MAX_EXPORT_SIZE + 1));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.exportOperateLog(response, reqVO))
                .isInstanceOf(ServiceException.class)
                .hasMessage("单次最多导出 10000 条日志，请缩小时间或筛选范围")
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(1_002_009_000);
        verify(transService, never()).transBatch(anyList());
        assertThat(response.getHeader("Content-Disposition")).as("拒绝时不得写入下载头").isNull();
        assertThat(response.getContentAsByteArray()).isEmpty();
    }

    /** 注入服务替身，保证控制器只访问受控边界。 */
    private void injectDependencies() {
        ReflectionTestUtils.setField(controller, "operateLogService", operateLogService);
    }

    /**
     * 构造操作日志记录。
     *
     * @param id 日志编号
     * @param type 操作模块
     * @param action 操作动作
     * @return 操作日志记录
     */
    private static OperateLogDO log(Long id, String type, String action) {
        OperateLogDO log = new OperateLogDO();
        log.setId(id);
        log.setType(type);
        log.setSubType("CREATE");
        log.setBizId(100L);
        log.setUserId(7L);
        log.setAction(action);
        return log;
    }

}
