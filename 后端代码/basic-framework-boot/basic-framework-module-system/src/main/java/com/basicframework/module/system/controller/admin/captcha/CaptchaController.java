package com.basicframework.module.system.controller.admin.captcha;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.util.servlet.ServletUtils;

import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.properties.AjCaptchaProperties;
import com.anji.captcha.service.CaptchaService;
import com.basicframework.module.system.framework.captcha.core.AdminDefaultBlockPuzzleCaptchaServiceImpl;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Properties;

/**
 * 验证码 Controller，提供图形验证码的生成能力
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/captcha/CaptchaController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 38 行，上游代码 4 行在本地被移除或改写，例如 private CaptchaService adminBlockPuzzleCaptchaService;；private AjCaptchaProperties captchaProperties;；本地补充注释 31 行。
 */
@Tag(name = "管理后台 - 验证码")
@RestController("adminCaptchaController")
@RequestMapping("/system/captcha")
public class CaptchaController {

    @Resource
    private CaptchaService captchaService;
    private CaptchaService adminBlockPuzzleCaptchaService;
    @Resource
    private AjCaptchaProperties captchaProperties;

    /**
     * 完成 initAdminBlockPuzzleCaptchaService 对应的业务处理。
     */
    @PostConstruct
    public void initAdminBlockPuzzleCaptchaService() {
        AdminDefaultBlockPuzzleCaptchaServiceImpl service = new AdminDefaultBlockPuzzleCaptchaServiceImpl();
        // 不能把管理端服务注册为 CaptchaService Bean，否则会让 aj-captcha 默认 Bean 的条件装配失效。
        service.init(buildCaptchaProperties(captchaProperties, AdminDefaultBlockPuzzleCaptchaServiceImpl.CAPTCHA_TYPE));
        adminBlockPuzzleCaptchaService = service;
    }

    /**
     * 获取指定数据。
     *
     * @param data 数据参数
     * @param request HTTP 请求
     * @return 查询结果
     */
    @PostMapping({"/get"})
    @Operation(summary = "获得验证码")
    @PermitAll
    public ResponseModel get(@RequestBody CaptchaVO data, HttpServletRequest request) {
        assert request.getRemoteHost() != null;
        data.setBrowserInfo(getRemoteId(request));
        return selectCaptchaService(data).get(data);
    }

    /**
     * 校验指定数据。
     *
     * @param data 数据参数
     * @param request HTTP 请求
     * @return 方法处理结果
     */
    @PostMapping("/check")
    @Operation(summary = "校验验证码")
    @PermitAll
    public ResponseModel check(@RequestBody CaptchaVO data, HttpServletRequest request) {
        data.setBrowserInfo(getRemoteId(request));
        return selectCaptchaService(data).check(data);
    }

    /**
     * 查询CaptchaService。
     */
    private CaptchaService selectCaptchaService(CaptchaVO data) {
        // 管理平台显式传 adminBlockPuzzle 时使用旧版默认底图；其它类型保持原 blockPuzzle 服务给业务平台使用。
        if (data != null && StrUtil.equals(data.getCaptchaType(), AdminDefaultBlockPuzzleCaptchaServiceImpl.CAPTCHA_TYPE)) {
            return adminBlockPuzzleCaptchaService;
        }
        return captchaService;
    }

    /**
     * 获取Remote编号。
     *
     * @param request HTTP 请求
     * @return 查询结果
     */
    public static String getRemoteId(HttpServletRequest request) {
        String ip = ServletUtils.getClientIP(request);
        String ua = request.getHeader("user-agent");
        if (StrUtil.isNotBlank(ip)) {
            return ip + ua;
        }
        return request.getRemoteAddr() + ua;
    }

    /**
     * 构建CaptchaProperties。
     */
    private Properties buildCaptchaProperties(AjCaptchaProperties config, String captchaType) {
        Properties properties = new Properties();
        properties.put("captcha.cacheType", config.getCacheType().name());
        properties.put("captcha.water.mark", config.getWaterMark());
        properties.put("captcha.font.type", config.getFontType());
        properties.put("captcha.type", captchaType);
        properties.put("captcha.interference.options", config.getInterferenceOptions());
        properties.put("captcha.captchaOriginalPath.jigsaw", config.getJigsaw());
        properties.put("captcha.captchaOriginalPath.pic-click", config.getPicClick());
        properties.put("captcha.slip.offset", config.getSlipOffset());
        properties.put("captcha.aes.status", String.valueOf(config.getAesStatus()));
        properties.put("captcha.water.font", config.getWaterFont());
        properties.put("captcha.cache.number", config.getCacheNumber());
        properties.put("captcha.timing.clear", config.getTimingClear());
        properties.put("captcha.history.data.clear.enable", config.isHistoryDataClearEnable() ? "1" : "0");
        properties.put("captcha.req.frequency.limit.enable", config.getReqFrequencyLimitEnable() ? "1" : "0");
        properties.put("captcha.req.get.lock.limit", String.valueOf(config.getReqGetLockLimit()));
        properties.put("captcha.req.get.lock.seconds", String.valueOf(config.getReqGetLockSeconds()));
        properties.put("captcha.req.get.minute.limit", String.valueOf(config.getReqGetMinuteLimit()));
        properties.put("captcha.req.check.minute.limit", String.valueOf(config.getReqCheckMinuteLimit()));
        properties.put("captcha.req.verify.minute.limit", String.valueOf(config.getReqVerifyMinuteLimit()));
        properties.put("captcha.font.size", String.valueOf(config.getFontSize()));
        properties.put("captcha.font.style", String.valueOf(config.getFontStyle()));
        properties.put("captcha.word.count", String.valueOf(config.getClickWordCount()));
        return properties;
    }

}
