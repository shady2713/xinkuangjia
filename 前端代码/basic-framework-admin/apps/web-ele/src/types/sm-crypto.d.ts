/**
 * sm-crypto 未随包提供 TypeScript 声明，这里只声明密码传输实际使用的 SM2 方法。
 * 仅测试代码需要 generateKeyPairHex，生产代码不使用密钥生成能力。
 */
declare module 'sm-crypto' {
  export namespace sm2 {
    export function doEncrypt(
      msg: string,
      publicKey: string,
      cipherMode?: 0 | 1,
    ): string;
    export function generateKeyPairHex(): {
      privateKey: string;
      publicKey: string;
    };
    export function doDecrypt(
      encryptData: string,
      privateKey: string,
      cipherMode?: 0 | 1,
    ): string;
  }
}
