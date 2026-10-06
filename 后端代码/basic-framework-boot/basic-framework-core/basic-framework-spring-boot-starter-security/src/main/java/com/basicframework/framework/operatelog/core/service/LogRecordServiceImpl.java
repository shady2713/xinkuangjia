package com.basicframework.framework.operatelog.core.service;

import com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.util.monitor.TracerUtils;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.mzt.logapi.beans.LogRecord;
import com.mzt.logapi.service.ILogRecordService;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;

import java.util.List;

/**
 * 操作日志 ILogRecordService 实现类
 *
 * 基于 {@link OperateLogCommonApi} 实现，记录操作日志
 *
 * @author HUIHUI
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Slf4j
public class LogRecordServiceImpl implements ILogRecordService {

    private static final long SYSTEM_USER_ID = 0L;

    @Resource
    private OperateLogCommonApi operateLogApi;

    /**
     * 记录操作日志
     *
     * <p>将 {@link LogRecord} 映射成日志创建 DTO，并补齐用户、模块与请求上下文后异步入库。</p>
     *
     * @param logRecord 业务日志对象
     */
    @Override
    public void record(LogRecord logRecord) {
        OperateLogCreateReqDTO reqDTO = new OperateLogCreateReqDTO();
        try {
            reqDTO.setTraceId(TracerUtils.getTraceId());
            // 补充用户信息
            fillUserFields(reqDTO);
            // 补全模块信息
            fillModuleFields(reqDTO, logRecord);
            // 补全请求信息
            fillRequestFields(reqDTO);

            // 2. 异步记录日志
            operateLogApi.createOperateLogAsync(reqDTO);
        } catch (Exception ex) {
            // 操作日志属于旁路能力，只隔离可处理的应用异常；JVM Error 必须继续传播。
            log.error("[record][traceId({}) url({}) type({}) subType({}) bizId({}) 发生异常]",
                    reqDTO.getTraceId(), reqDTO.getRequestUrl(), reqDTO.getType(), reqDTO.getSubType(), reqDTO.getBizId(), ex);
        }
    }

    /**
     * 补全操作用户字段；非登录线程统一记录为系统管理员用户。
     *
     * @param reqDTO 操作日志请求
     */
    private static void fillUserFields(OperateLogCreateReqDTO reqDTO) {
        // 使用 SecurityFrameworkUtils。因为要考虑，rpc、mq、job，它其实不是 web；
        LoginUser loginUser = SecurityFrameworkUtils.getLoginUser();
        if (loginUser == null) {
            reqDTO.setUserId(SYSTEM_USER_ID);
            reqDTO.setUserType(UserTypeEnum.ADMIN.getValue());
            return;
        }
        reqDTO.setUserId(loginUser.getId());
        reqDTO.setUserType(loginUser.getUserType());
    }

    /**
     * 补全日志模块维度字段
     *
     * @param reqDTO   操作日志请求
     * @param logRecord 日志记录
     */
    public static void fillModuleFields(OperateLogCreateReqDTO reqDTO, LogRecord logRecord) {
        reqDTO.setType(logRecord.getType()); // 大模块类型，例如：CRM 客户
        reqDTO.setSubType(logRecord.getSubType());// 操作名称，例如：转移客户
        reqDTO.setBizId(Long.parseLong(logRecord.getBizNo())); // 业务编号，例如：客户编号
        reqDTO.setAction(logRecord.getAction());// 操作内容，例如：修改编号为 1 的用户信息，将性别从男改成女，将姓名从张三改成李四。
        reqDTO.setExtra(logRecord.getExtra()); // 拓展字段，有些复杂的业务，需要记录一些字段 ( JSON 格式 )，例如说，记录订单编号，{ orderId: "1"}
    }

    /**
     * 补全请求上下文字段
     *
     * @param reqDTO 操作日志请求
     */
    private static void fillRequestFields(OperateLogCreateReqDTO reqDTO) {
        // 获得 Request 对象
        HttpServletRequest request = ServletUtils.getRequest();
        if (request == null) {
            return;
        }
        // 补全请求信息
        reqDTO.setRequestMethod(request.getMethod());
        reqDTO.setRequestUrl(request.getRequestURI());
        reqDTO.setUserIp(ServletUtils.getClientIP(request));
        reqDTO.setUserAgent(ServletUtils.getUserAgent(request));
    }

    /**
     * 当前版本仅提供写日志能力，不提供查询 API
     *
     * @param bizNo 业务编号
     * @param type 日志类型
     * @return 不返回结果，调用时直接抛出异常
     * @throws UnsupportedOperationException 当前实现不支持查询操作日志
     */
    @Override
    public List<LogRecord> queryLog(String bizNo, String type) {
        throw new UnsupportedOperationException("使用 OperateLogApi 进行操作日志的查询");
    }

    /**
     * 当前版本仅提供写日志能力，不提供查询 API
     *
     * @param bizNo   业务编号
     * @param type    日志类型
     * @param subType 子类型
     * @return 不返回结果，调用时直接抛出异常
     * @throws UnsupportedOperationException 当前实现不支持查询操作日志
     */
    @Override
    public List<LogRecord> queryLogByBizNo(String bizNo, String type, String subType) {
        throw new UnsupportedOperationException("使用 OperateLogApi 进行操作日志的查询");
    }

}
