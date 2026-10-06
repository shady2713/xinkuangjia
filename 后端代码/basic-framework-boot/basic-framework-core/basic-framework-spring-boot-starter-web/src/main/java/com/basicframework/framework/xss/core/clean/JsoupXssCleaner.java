package com.basicframework.framework.xss.core.clean;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;

/**
 * 基于 Jsoup 的 XSS 过滤器。
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-web/src/main/java/
 * 上游文件续：cn/iocoder/yudao/framework/xss/core/clean/JsoupXssCleaner.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 1 行，移除或改写上游 1 行；补充注释 10 行，上游注释 21 行未保留。
 */
public class JsoupXssCleaner implements XssCleaner {

    private final Safelist safelist;

    /**
     * 用于在 src 属性使用相对路径时，强制转换为绝对路径。为空时不处理，值应为绝对路径的前缀（包含协议部分）。
     */
    private final String baseUri;

    /**
     * 创建 JsoupXssCleaner，并初始化所需依赖与配置。
     */
    public JsoupXssCleaner() {
        this.safelist = buildSafelist();
        this.baseUri = "";
    }

    /**
     * 构建 XSS 清理白名单。
     *
     * 默认不放行 style 属性，避免 CSS URL、expression 等样式注入绕过。
     * 如果业务确实需要富文本样式，应为富文本模块单独定义更细粒度的白名单。
     */
    private Safelist buildSafelist() {
        Safelist relaxedSafelist = Safelist.relaxed();
        relaxedSafelist.addAttributes(":all", "class");
        relaxedSafelist.addAttributes("a", "target");
        relaxedSafelist.addProtocols("img", "src", "data");
        return relaxedSafelist;
    }

    /**
     * 清理目标数据。
     *
     * @param html html 参数
     * @return 方法处理结果
     */
    @Override
    public String clean(String html) {
        return Jsoup.clean(html, baseUri, safelist, new Document.OutputSettings().prettyPrint(false));
    }

}
