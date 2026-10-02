package com.basicframework.module.system.framework.operatelog.core;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.module.system.enums.DictTypeConstants;
import com.mzt.logapi.service.IParseFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 行业的 {@link IParseFunction} 实现类
 *
 * @author 李杰
 */
@Component
@Slf4j
public class SexParseFunction implements IParseFunction {

    public static final String NAME = "getSex";

    /**
     * 执行Before。
     *
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean executeBefore() {
        return true; // 先转换值后对比
    }

    /**
     * 返回当前解析函数的注册名称。
     *
     * @return 方法处理结果
     */
    @Override
    public String functionName() {
        return NAME;
    }

    /**
     * 应用目标数据。
     *
     * @param value 待处理值
     * @return 方法处理结果
     */
    @Override
    public String apply(Object value) {
        if (StrUtil.isEmptyIfStr(value)) {
            return "";
        }
        return DictFrameworkUtils.parseDictDataLabel(DictTypeConstants.USER_SEX, value.toString());
    }

}
