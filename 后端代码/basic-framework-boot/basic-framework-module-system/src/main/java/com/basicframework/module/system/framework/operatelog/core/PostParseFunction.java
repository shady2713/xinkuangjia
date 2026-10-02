package com.basicframework.module.system.framework.operatelog.core;

import cn.hutool.core.convert.Convert;
import cn.hutool.core.util.StrUtil;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.service.dept.PostService;
import com.mzt.logapi.service.IParseFunction;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 岗位名字的 {@link IParseFunction} 实现类
 *
 * @author 李杰
 */
@Slf4j
@Component
public class PostParseFunction implements IParseFunction {

    public static final String NAME = "getPostById";

    @Resource
    private PostService postService;

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

        // 获取岗位信息
        PostDO post = postService.getPost(Convert.toLong(value));
        if (post == null) {
            log.warn("[apply][获取岗位{{}}为空", value);
            return "";
        }
        return post.getName();
    }

}
