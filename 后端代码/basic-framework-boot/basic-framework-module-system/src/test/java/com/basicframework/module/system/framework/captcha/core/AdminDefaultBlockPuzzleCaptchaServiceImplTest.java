package com.basicframework.module.system.framework.captcha.core;

import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.util.ImageUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Font;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证管理平台滑块验证码的底图加载、水印绘制与生成结果契约。
 *
 * <p>该实现与业务平台分开加载 aj-captcha 依赖自带的默认图库，避免两个平台争用同一份全局图片
 * 缓存。生成结果必须是可解码的底图与拼图块，否则前端滑块无法渲染；水印未配置时不得改动底图
 * 像素，配置后必须真实绘制到图上。用例直接消费依赖包内的真实默认图库，不做图片替身。</p>
 *
 * @author shady2713
 */
class AdminDefaultBlockPuzzleCaptchaServiceImplTest {

    /** 被测验证码实现。 */
    private AdminDefaultBlockPuzzleCaptchaServiceImpl captchaService;
    /** 用例开始前的静态水印文本，结束后原样恢复。 */
    private String previousWaterMark;

    /** 为每个用例创建独立实例并记录静态水印文本。 */
    @BeforeEach
    void setUp() {
        captchaService = new AdminDefaultBlockPuzzleCaptchaServiceImpl();
        previousWaterMark = (String) ReflectionTestUtils.getField(captchaService, "waterMark");
    }

    /** 还原静态水印文本，避免影响同 JVM 内的其他验证码用例。 */
    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(captchaService, "waterMark", previousWaterMark);
    }

    /**
     * 生成验证码必须返回可解码的底图与拼图块，且两者不是同一张图片。
     */
    @Test
    void getReturnsDecodableOriginalAndSlidingBlock() throws Exception {
        ResponseModel response = captchaService.get(new CaptchaVO());

        assertThat(response.isSuccess()).as("默认图库可用时必须生成成功").isTrue();
        CaptchaVO result = (CaptchaVO) response.getRepData();
        assertThat(result.getOriginalImageBase64()).isNotBlank();
        assertThat(result.getJigsawImageBase64()).isNotBlank();
        BufferedImage original = decode(result.getOriginalImageBase64());
        BufferedImage slidingBlock = decode(result.getJigsawImageBase64());
        assertThat(original).as("底图必须可解码").isNotNull();
        assertThat(slidingBlock).as("拼图块必须可解码").isNotNull();
        assertThat(result.getOriginalImageBase64()).as("拼图块不得复用底图内容")
                .isNotEqualTo(result.getJigsawImageBase64());
        assertThat(original.getWidth()).isGreaterThan(slidingBlock.getWidth());
    }

    /**
     * 未配置水印时不得在底图上绘制任何像素。
     */
    @Test
    void drawWaterMarkLeavesImageUntouchedWithoutWaterMark() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "  ");
        BufferedImage image = blackImage();

        ReflectionTestUtils.invokeMethod(captchaService, "drawWaterMark", image);

        assertThat(containsNonBlackPixel(image)).as("无水印时底图必须保持原样").isFalse();
    }

    /**
     * 配置水印后必须把文本真实绘制到底图上，且不抛异常。
     */
    @Test
    void drawWaterMarkPaintsTextWhenConfigured() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "管理平台");
        ReflectionTestUtils.setField(captchaService, "waterMarkFont", new Font(Font.SANS_SERIF, Font.PLAIN, 20));
        BufferedImage image = blackImage();

        ReflectionTestUtils.invokeMethod(captchaService, "drawWaterMark", image);

        assertThat(containsNonBlackPixel(image)).as("配置水印后底图必须出现绘制像素").isTrue();
    }

    /**
     * 生成验证码时同样走水印绘制分支，配置水印后仍能正常出图。
     */
    @Test
    void getSucceedsWithConfiguredWaterMark() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "管理平台");
        ReflectionTestUtils.setField(captchaService, "waterMarkFont", new Font(Font.SANS_SERIF, Font.PLAIN, 20));

        ResponseModel response = captchaService.get(new CaptchaVO());

        assertThat(response.isSuccess()).isTrue();
        assertThat(((CaptchaVO) response.getRepData()).getOriginalImageBase64()).isNotBlank();
    }

    /**
     * 构造纯黑底图，便于检测是否被绘制过。
     *
     * @return 纯黑图片
     */
    private static BufferedImage blackImage() {
        BufferedImage image = new BufferedImage(200, 100, BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics graphics = image.getGraphics();
        graphics.setColor(Color.BLACK);
        graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
        graphics.dispose();
        return image;
    }

    /**
     * 判断图片中是否存在非黑像素。
     *
     * @param image 待检测图片
     * @return 存在非黑像素时返回 true
     */
    private static boolean containsNonBlackPixel(BufferedImage image) {
        for (int x = 0; x < image.getWidth(); x++) {
            for (int y = 0; y < image.getHeight(); y++) {
                if ((image.getRGB(x, y) & 0xFFFFFF) != 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 解码 Base64 图片，内容非法时返回 null。
     *
     * @param base64 Base64 图片内容
     * @return 图片对象或 null
     * @throws Exception 解码失败时抛出
     */
    private static BufferedImage decode(String base64) throws Exception {
        assertThat(ImageUtils.getBase64StrToImage(base64)).as("工具解码结果必须与断言一致").isNotNull();
        return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(base64)));
    }

}
