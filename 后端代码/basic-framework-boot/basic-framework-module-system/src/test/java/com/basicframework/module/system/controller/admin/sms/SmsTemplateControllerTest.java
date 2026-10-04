package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplatePageReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.service.sms.SmsTemplateService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证短信模板导出的响应契约。
 *
 * <p>导出接口在结果未超限时必须真实写出 Excel 附件：只返回成功而不写响应体会让运维拿到空文件，
 * 缺少下载响应头则浏览器会直接打开而不是下载。超限分支由端点权限测试覆盖，
 * 本用例补齐成功写出这一条路径。</p>
 *
 * @author shady2713
 */
class SmsTemplateControllerTest {

    /** 被测控制器。 */
    private SmsTemplateController controller;
    /** 下游模板服务替身，返回受控的导出数据。 */
    private SmsTemplateService smsTemplateService;

    /** 为每个用例装配独立控制器与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        controller = new SmsTemplateController();
        smsTemplateService = mock(SmsTemplateService.class);
        ReflectionTestUtils.setField(controller, "smsTemplateService", smsTemplateService);
    }

    /** 结果未超限时必须写出 Excel 附件并设置下载响应头。 */
    @Test
    void exportWritesExcelAttachmentWhenResultFitsLimit() throws Exception {
        when(smsTemplateService.getSmsTemplatePage(any()))
                .thenReturn(new PageResult<>(List.of(template(1L, "sms_login")), 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.exportSmsTemplateExcel(new SmsTemplatePageReqVO(), response);

        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
        assertThat(response.getContentAsByteArray()).as("必须写出真实的 Excel 内容").isNotEmpty();
    }

    /** 导出结果为空时同样要写出带表头的文件，而不是返回空响应。 */
    @Test
    void exportWritesHeaderOnlyFileWhenNoTemplate() throws Exception {
        when(smsTemplateService.getSmsTemplatePage(any())).thenReturn(new PageResult<>(List.of(), 0L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.exportSmsTemplateExcel(new SmsTemplatePageReqVO(), response);

        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getContentAsByteArray()).isNotEmpty();
    }

    /**
     * 构造只含导出列所需字段的短信模板。
     *
     * @param id 模板编号
     * @param code 模板编码
     * @return 短信模板
     */
    private SmsTemplateDO template(Long id, String code) {
        SmsTemplateDO template = new SmsTemplateDO();
        template.setId(id);
        template.setCode(code);
        template.setName("登录验证码");
        template.setContent("您的验证码是 {code}");
        return template;
    }

}
