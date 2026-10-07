package com.basicframework.framework.xss.core.clean;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 运行期验证 XSS 清理器「不放行 {@code style} 属性」这一本地契约的真实性与区分力。
 *
 * <p>本类与源码层判别性测试的分工：源码层测试只证明 Java 源码里的白名单构造调用形状；本类
 * 驱动**生产 {@link JsoupXssCleaner} 实例**执行真实的 {@link Jsoup#clean}，观察实际输出 HTML，
 * 因此锁的是运行期行为：任何 {@code style} 属性——无论是否恶意、无论落在哪个标签上——都不得
 * 出现在输出中，而白名单确实放行的属性（{@code class}、{@code a} 的 {@code target}、{@code img}
 * 的 {@code data} 协议）必须保留。保留与拒绝同时被断言，避免“全部剥掉”式的假通过。</p>
 *
 * <p>判别性来自同文件内的**契约违反变体** {@link StyleAllowingCleaner}：它用与上游一致的
 * 白名单形状（relaxed + {@code :all} 放行 {@code style}）调用同一个 {@link Jsoup#clean}。
 * 同一个探针对两者给出不同读数，且对变体执行与生产相同的断言会失败——由此证明断言确实依赖
 * 本地契约，而不是“Jsoup 一定会清掉样式”这种与实现无关的巧合。</p>
 *
 * @author 契约与出口方向执行代理
 */
class JsoupXssCleanerStyleContractRuntimeTest {

    /** 生产清理器实例，本类的被测对象。 */
    private final JsoupXssCleaner production = new JsoupXssCleaner();

    /** 契约违反变体：白名单形状与上游一致，会放行 {@code style}。 */
    private final XssCleaner styleAllowing = new StyleAllowingCleaner();

    /**
     * 生产实现在真实清理调用后确实不接受 {@code style}，而不是只丢掉其中一种取值。
     *
     * <p>三种输入覆盖三种真实形态：纯 CSS 声明（合法样式）、{@code url(javascript:)} 注入、
     * 以及落在 {@code span} 上的属性。只断言恶意输入会被“只做危险值过滤”的实现蒙混过关。</p>
     */
    @Test
    void productionCleanerDropsStyleForBenignAndMaliciousAndEveryTag() {
        assertStyleRemoved("<p style=\"color:red\">benign</p>");
        assertStyleRemoved("<p style=\"background-image:url(javascript:alert(1))\">malicious</p>");
        assertStyleRemoved("<span class=\"keep\" style=\"color:red\">other-tag</span>");
        assertStyleRemoved("<div><p style=\"font-size:12px\">nested</p></div>");
    }

    /** 同一探针对契约违反变体必须报出 {@code style} 仍在，证明断言有区分力而不是恒真。 */
    @Test
    void styleAllowingVariantKeepsStyleSoTheAssertionDiscriminates() {
        String cleaned = styleAllowing.clean("<p style=\"color:red\">benign</p>");

        assertThat(cleaned).as("变体放行 style，探针必须能读到它").contains("style=");
        assertThatThrownBy(() -> assertStyleRemoved(styleAllowing))
                .as("同一断言作用在契约违反变体上必须失败")
                .isInstanceOf(AssertionError.class);
    }

    /** 白名单仍然放行的属性必须保留，证明清理没有退化成“全部属性剥掉”。 */
    @Test
    void allowedAttributesAndProtocolsSurviveTheSameProbe() {
        String cleaned = production.clean(
                "<p class=\"keep\" style=\"color:red\">text</p>"
                        + "<a href=\"https://example.com\" target=\"_blank\" style=\"color:red\">link</a>"
                        + "<img src=\"data:image/png;base64,iVBORw0KGgo=\" alt=\"pic\" style=\"border:0\">");

        assertThat(cleaned).as("class 属于本地白名单，必须保留").contains("class=\"keep\"");
        assertThat(cleaned).as("a 的 target 属于本地白名单，必须保留").contains("target=\"_blank\"");
        assertThat(cleaned).as("img 的 data 协议属于本地白名单，必须保留")
                .contains("data:image/png;base64,iVBORw0KGgo=");
        assertThat(cleaned).as("a 的 href 属于 relaxed 白名单，必须保留")
                .contains("https://example.com");
        assertThat(cleaned).as("即便属性被放行，style 仍必须被移除").doesNotContain("style=");
    }

    /** 文本内容本身不受影响：清理器不是删除器，判别力来自属性层而不是粗暴清空。 */
    @Test
    void textContentIsPreservedWhileStyleAttributeIsRemoved() {
        String cleaned = production.clean("<p style=\"color:red\">保留这段中文</p>");

        assertThat(cleaned).contains("保留这段中文");
    }

    /**
     * 生产契约的断言入口：输出中一旦出现 {@code style=} 即判失败。
     *
     * @param html 待清理的输入片段
     */
    private void assertStyleRemoved(String html) {
        assertThat(production.clean(html))
                .as("本地契约：输出 HTML 不得保留 style 属性")
                .doesNotContain("style=");
    }

    /**
     * 对任意清理器套用同一契约断言，生产实现与契约违反变体共用。
     *
     * @param cleaner 被断言的清理器
     */
    private void assertStyleRemoved(XssCleaner cleaner) {
        assertThat(cleaner.clean("<p style=\"color:red\">benign</p>"))
                .as("本地契约：输出 HTML 不得保留 style 属性")
                .doesNotContain("style=");
    }

    /**
     * 契约违反变体：白名单形状与上游一致（relaxed 之上额外放行 {@code :all} 的 {@code style}）。
     *
     * <p>它只用于负对照，不参与任何生产路径：若生产实现被改回上游形状，本类中针对生产实例的
     * {@code assertStyleRemoved} 会立刻失败，从而把来源回退暴露为测试失败而不是静默通过。</p>
     *
     * @author 契约与出口方向执行代理
     */
    private static final class StyleAllowingCleaner implements XssCleaner {

        /** 与上游一致的完整调用形状：同样的 relaxed 基线、同样的额外放行、同样的输出设置。 */
        @Override
        public String clean(String html) {
            Safelist safelist = Safelist.relaxed();
            safelist.addAttributes(":all", "class");
            safelist.addAttributes(":all", "style");
            safelist.addAttributes("a", "target");
            safelist.addProtocols("img", "src", "data");
            return Jsoup.clean(html, "", safelist, new Document.OutputSettings().prettyPrint(false));
        }

    }

}