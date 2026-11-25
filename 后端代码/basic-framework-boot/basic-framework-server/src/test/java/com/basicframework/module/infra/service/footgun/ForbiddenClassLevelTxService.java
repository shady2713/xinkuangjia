package com.basicframework.module.infra.service.footgun;

import org.springframework.transaction.annotation.Transactional;

/**
 * 架构门禁反向夹具：验证类级未声明 {@code rollbackFor} 的 {@code @Transactional} 会被阻断。
 *
 * @author shady
 */
@Transactional
public class ForbiddenClassLevelTxService {

    /** 样本方法，用于触发类级 @Transactional 规则检查。 */
    public void runInBrokenTx() {
    }

}
