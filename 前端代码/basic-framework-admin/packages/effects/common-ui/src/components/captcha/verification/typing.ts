interface VerificationProps {
  arith?: number;
  barSize?: {
    height: string;
    width: string;
  };
  blockSize?: {
    height: string;
    width: string;
  };
  // 管理平台使用 adminBlockPuzzle 请求后端旧版默认底图，业务平台仍使用 blockPuzzle。
  captchaType?: 'adminBlockPuzzle' | 'blockPuzzle' | 'clickWord';
  explain?: string;
  figure?: number;
  imgSize?: {
    height: string;
    width: string;
  };
  mode?: 'fixed' | 'pop';
  space?: number;
  type?: '1' | '2';
  checkCaptchaApi?: (data: any) => Promise<any>;
  getCaptchaApi?: (data: any) => Promise<any>;
}

export type { VerificationProps };
