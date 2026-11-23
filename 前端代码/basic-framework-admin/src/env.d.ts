/// <reference types="vite/client" />

interface RuntimeAppConfig {
  VITE_APP_TITLE?: string;
  VITE_GLOB_API_URL?: string;
  VITE_APP_CAPTCHA_ENABLE?: string;
}

interface Window {
  _BASIC_FRAMEWORK_APP_CONF_?: RuntimeAppConfig;
}

declare module 'sm-crypto' {
  export const sm2: {
    doEncrypt(msg: string, publicKey: string, cipherMode?: 0 | 1): string;
    doDecrypt(encryptData: string, privateKey: string, cipherMode?: 0 | 1): string;
    generateKeyPairHex(): { publicKey: string; privateKey: string };
  };
}
