/**
 * Promise 结果封装：把 await 的成功值与异常统一收敛成二元组。
 * 调用方用解构代替 try/catch，errorExt 合并进错误对象。
 * 不重试、不吞异常，也不改变 promise 的执行时序。
 */
/**
 * @param { Readonly<Promise> } promise 待收敛的 promise；其成功值与异常都不会向外抛出
 * @param {object=} errorExt 附加信息，存在时合并进捕获到的错误对象
 * @return { Promise } 二元组：成功为 [null, 值]，失败为 [错误, undefined]
 */
export async function to<T, U = Error>(
  promise: Readonly<Promise<T>>,
  errorExt?: object,
): Promise<[null, T] | [U, undefined]> {
  try {
    const data = await promise;
    const result: [null, T] = [null, data];
    return result;
  } catch (error) {
    if (errorExt) {
      const parsedError = Object.assign({}, error, errorExt);
      return [parsedError as U, undefined];
    }
    return [error as U, undefined];
  }
}
