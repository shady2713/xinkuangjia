package com.basicframework.module.infra.service.footgun;

import com.basicframework.module.system.dal.mysql.footgun.ForbiddenFootgunMapper;
import org.springframework.transaction.annotation.Transactional;

/**
 * 架构门禁反向夹具：跨业务模块直接依赖其他模块内部 Mapper 且使用无 {@code rollbackFor} 的 {@code @Transactional}。
 *
 * @author shady2713
 */
public class ForbiddenCrossModuleAndUnqualifiedTxService {

    /** 故意直接引用兄弟模块内部 Mapper。 */
    private ForbiddenFootgunMapper siblingMapper;

    /** 故意省略 rollbackFor = Exception.class。 */
    @Transactional
    public ForbiddenFootgunMapper brokenTx() {
        return siblingMapper;
    }

}
