package com.basicframework.module.system.framework.operatelog.core;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.module.system.enums.DictTypeConstants;
import com.mzt.logapi.service.IParseFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 是否类型的 {@link IParseFunction} 实现类
 *
 * @author HUIHUI
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Component
@Slf4j
public class BooleanParseFunction implements IParseFunction {

    public static final String NAME = "getBoolean";

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
        return DictFrameworkUtils.parseDictDataLabel(DictTypeConstants.BOOLEAN_STRING, value.toString());
    }

}
