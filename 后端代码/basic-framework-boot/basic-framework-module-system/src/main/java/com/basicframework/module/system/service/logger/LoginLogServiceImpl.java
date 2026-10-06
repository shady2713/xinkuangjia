package com.basicframework.module.system.service.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.basicframework.module.system.enums.logger.LoginResultEnum;

import jakarta.annotation.Resource;

/**
 * 登录日志服务实现类。
 * <p>
 * 负责登录日志的持久化和查询。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/service/logger/LoginLogServiceImpl.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 5 行；import 新增 4 行、移除 1 行；补充注释 20 行，上游注释 1 行未保留。
 * 来源验收：尚未验收
 */
@Service
@Validated
public class LoginLogServiceImpl implements LoginLogService {

    /**
     * 独立提交失败审计，成功事件仍由签发会话的事务负责提交。
     *
     * @param reqDTO 非成功的认证结果；误传成功结果时拒绝写入
     * @throws IllegalArgumentException 传入成功事件时抛出
     */
    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public void createLoginFailureLog(LoginLogCreateReqDTO reqDTO) {
        if (LoginResultEnum.SUCCESS.getResult().equals(reqDTO.getResult())) {
            throw new IllegalArgumentException("成功审计必须与会话事务共同提交");
        }
        createLoginLog(reqDTO);
    }

    @Resource
    private LoginLogMapper loginLogMapper;

    /**
     * 获取登录日志。
     *
     * @param id 登录日志编号
     * @return 登录日志信息
     */
    @Override
    public LoginLogDO getLoginLog(Long id) {
        return loginLogMapper.selectById(id);
    }

    /**
     * 分页查询登录日志。
     *
     * @param pageReqVO 分页条件
     * @return 登录日志分页结果
     */
    @Override
    public PageResult<LoginLogDO> getLoginLogPage(LoginLogPageReqVO pageReqVO) {
        return loginLogMapper.selectPage(pageReqVO);
    }

    /**
     * 创建登录日志。
     *
     * @param reqDTO 登录日志创建参数
     */
    @Override
    public void createLoginLog(LoginLogCreateReqDTO reqDTO) {
        LoginLogDO loginLog = BeanUtils.toBean(reqDTO, LoginLogDO.class);
        loginLogMapper.insert(loginLog);
    }

}
