package com.basicframework.module.system.framework.operatelog.core;

import cn.hutool.core.convert.Convert;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.ip.core.utils.AreaUtils;
import com.mzt.logapi.service.IParseFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 地名的 {@link IParseFunction} 实现类
 *
 * @author 李杰
 */
@Slf4j
@Component
public class AreaParseFunction implements IParseFunction {

    public static final String NAME = "getArea";

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
        return AreaUtils.format(Convert.toInt(value));
    }

}
