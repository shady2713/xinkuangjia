package com.basicframework.framework.excel.core.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Inherited;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 字典格式化注解，用于标识 Excel 字段所属的字典类型。
 * <p>
 * 导出时将字典值格式化为字典标签，导入时将字典标签解析为字典值。
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
@Target({ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
@Inherited
public @interface DictFormat {

    /**
     * 例如说，SysDictTypeConstants、InfDictTypeConstants
     *
     * @return 字典类型
     */
    String value();

}
