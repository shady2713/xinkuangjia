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
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
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

    /**
     * 可读但不可解码为图片的素材必须被拒绝，而不是当成有效底图参与生成。
     *
     * <p>加载器把「读到字节」和「拿到图片」分开判断：只保留能解码的素材，否则后续裁剪会拿到空图，
     * 让登录关键路径出现难以定位的失败。这里用一条独立的非图片探针资源校验该边界，并保留一条
     * 真实依赖素材的正对照，证明 null 来自图片解码判定而不是资源找不到。</p>
     *
     * <p><b>白盒直调：</b>{@code loadDefaultImage} 是私有静态方法，生产调用点只传依赖包内置的
     * {@code defaultImages/jigsaw/original|slidingBlock/1..6.png}；探针资源使用独立路径，
     * 不遮蔽依赖包素材，也不改变本模块其它用例的类路径解析结果。</p>
     */
    @Test
    void loadDefaultImageRejectsReadableNonImageResource() throws Exception {
        assertThat(loadDefaultImage("captcha-probe-not-an-image.png"))
                .as("读到字节但解不出图片时必须返回 null 并从候选列表剔除").isNull();
        assertThat((String) loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                .as("正对照：依赖包内真实图片必须返回非空 Base64").isNotBlank();
    }

    /**
     * 反射调用私有默认素材加载器，观察它对指定路径的真实返回。
     *
     * @param path 类路径上的资源路径
     * @return 加载成功时的 Base64 文本，不可用时为 null
     * @throws Exception 反射调用失败（含被测方法抛出的异常）时抛出
     */
    private static Object loadDefaultImage(String path) throws Exception {
        Method method = AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getDeclaredMethod("loadDefaultImage", String.class);
        method.setAccessible(true);
        try {
            return method.invoke(null, path);
        } catch (InvocationTargetException exception) {
            throw (Exception) exception.getCause();
        }
    }

}
