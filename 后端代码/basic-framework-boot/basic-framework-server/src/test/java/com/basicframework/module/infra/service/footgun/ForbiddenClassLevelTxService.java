package com.basicframework.module.infra.service.footgun;

import com.baomidou.dynamic.datasource.annotation.DSTransactional;
import org.springframework.transaction.annotation.Transactional;

/**
 * 架构门禁反向夹具：验证类级未声明 {@code rollbackFor} 的 {@code @Transactional} 与 {@code @DSTransactional} 均会被阻断。
 *
 * @author shady2713
 */
@Transactional
@DSTransactional
public class ForbiddenClassLevelTxService {

    /** 故意在方法上声明 @DSTransactional 的样本方法。 */
    @DSTransactional
    public void runInBrokenTx() {
    }

}
