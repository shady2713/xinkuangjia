/** 验证码组件的尺寸配置，取值为带单位的 CSS 长度字符串，例如 '310px' 或 '100%'。 */
export interface CaptchaSize {
  height: string;
  width: string;
}

/**
 * aj-captcha 后端的统一响应体。
 * @description repCode 为 '0000' 表示成功，其余为失败码；repMsg 只在失败时有值。
 */
export interface CaptchaResponse<TData = Record<string, unknown>> {
  data: TData & {
    repCode?: string;
    repMsg?: string;
  };
}

/**
 * 取验证码时后端下发的 repData 载荷。
 * @description 不同 captchaType 返回的字段不同：点选文字返回 originalImageBase64 与 wordList，
 * 滑块拼图在此基础上再返回 jigsawImageBase64，旋转验证码则返回另一组图片字段。
 * 因此除 token/secretKey 外都按可选承接，缺失时组件展示后端给出的失败文案。
 */
export interface CaptchaRepData {
  /** 滑块拼图的切块图片 Base64，不含 data:image/png 前缀 */
  jigsawImageBase64?: string;
  /** 点选文字或滑块拼图的背景图 Base64，不含 data:image/png 前缀 */
  originalImageBase64?: string;
  /** 后端下发的 AES 密钥；后端未开启加密时为空，此时坐标按明文提交 */
  secretKey?: string;
  /** 后端下发的令牌，提交校验时必须原样回传 */
  token?: string;
  /** 点选文字的字符顺序 */
  wordList?: string[];
  [key: string]: unknown;
}

/** 取验证码接口的响应：data 下挂 repData 载荷。 */
export type CaptchaFetchResponse = CaptchaResponse<{
  repData?: CaptchaRepData;
}>;

/** 校验验证码接口的响应：只需要 repCode 判定成败，repMsg 用于展示失败原因。 */
export type CaptchaCheckResponse = CaptchaResponse;

/**
 * 调用验证码后端接口时携带的请求体。
 * @description 各 captchaType 追加的字段不同（点选文字带 pointJson/token，滑块另带轨迹），
 * 因此按开放对象承接，由调用方与后端约定具体字段。
 */
export type CaptchaRequestBody = Record<string, unknown>;

/** 验证码校验成功后回传给业务方的凭据密文。 */
export interface CaptchaVerifyPassingPayload {
  /** 后端可校验的密文，格式为 `token---密文`；后端未开启加密时为明文拼接 */
  captchaVerification: string;
}

/** 画布上的一个点击坐标，坐标系为图片左上角。 */
export interface CaptchaPointCoordinate {
  x: number;
  y: number;
}

/** 验证码组件属性：验证码类型与弹层模式、底图与提示条尺寸，以及拉取和校验两个后端接口。 */
interface VerificationProps {
  arith?: number;
  barSize?: CaptchaSize;
  blockSize?: CaptchaSize;
  // 管理平台使用 adminBlockPuzzle 请求后端旧版默认底图，业务平台仍使用 blockPuzzle。
  captchaType?: 'adminBlockPuzzle' | 'blockPuzzle' | 'clickWord';
  explain?: string;
  figure?: number;
  imgSize?: CaptchaSize;
  mode?: 'fixed' | 'pop';
  space?: number;
  type?: '1' | '2';
  /**
   * 提交校验结果的后端接口。
   * @description 返回的 repCode 为 '0000' 才算通过；组件不吞掉异常，失败由调用方处理
   */
  checkCaptchaApi?: (
    data: CaptchaRequestBody,
  ) => Promise<CaptchaCheckResponse | undefined>;
  /**
   * 拉取验证码的后端接口。
   * @description 返回 repData 中的图片、token 与（可选的）加密密钥
   */
  getCaptchaApi?: (
    data: CaptchaRequestBody,
  ) => Promise<CaptchaFetchResponse | undefined>;
}

export type { VerificationProps };
