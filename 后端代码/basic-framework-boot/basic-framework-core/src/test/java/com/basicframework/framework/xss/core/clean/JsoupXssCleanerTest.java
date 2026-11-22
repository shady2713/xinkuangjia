package com.basicframework.framework.xss.core.clean;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 HTML 清理移除可执行样式并保留允许的属性。
 *
 * @author 李杰
 */
class JsoupXssCleanerTest {

    private final JsoupXssCleaner cleaner = new JsoupXssCleaner();

    /** 验证样式中的脚本不能保留在清理结果中。 */
    @Test
    void clean_shouldRemoveStyleAttribute() {
        String html = "<p class=\"text\" style=\"background-image:url(javascript:alert(1))\">hello</p>";

        String cleaned = cleaner.clean(html);

        assertThat(cleaned).contains("class=\"text\"");
        assertThat(cleaned).doesNotContain("style=");
        assertThat(cleaned).doesNotContain("javascript:");
    }

}