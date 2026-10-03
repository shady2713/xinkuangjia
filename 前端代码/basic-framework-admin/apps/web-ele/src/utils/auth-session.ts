/** 登录身份的单调代次；独立于 Pinia，清空或重新创建 Store 不会复用旧身份。 */
let sessionEpoch = 0;

/** 被已结束会话持有的异步工作以取消结束，避免触发普通错误提示或认证重试。 */
export class SessionChangedError extends Error {
  readonly __CANCEL__ = true;

  /** 创建会话失效错误，供请求和状态写入边界使用。 */
  constructor() {
    super('登录会话已变更，已取消旧会话操作');
    this.name = 'SessionChangedError';
  }
}

/** 返回当前会话代次，调用者应在异步操作开始前捕获。
 * @returns 当前身份代次；令牌刷新不会改变代次。
 */
export function getSessionEpoch(): number {
  return sessionEpoch;
}

/** 结束上一轮身份并创建新代次，在登录尝试、退出及强制失效时同步调用。
 * @returns 新身份代次，用于随后异步操作的所有权判断。
 */
export function advanceSession(): number {
  sessionEpoch += 1;
  return sessionEpoch;
}

/** 判断异步操作是否仍属于当前身份。
 * @param epoch 操作开始时捕获的代次。
 * @returns 代次未被登录、退出或会话失效替换时为真。
 */
export function isCurrentSession(epoch: number): boolean {
  return epoch === sessionEpoch;
}

/** 在写入凭据、状态或安装路由前拒绝过期身份。
 * @param epoch 操作开始时捕获的代次。
 * @throws {SessionChangedError} 会话已被其他登录或退出替换。
 */
export function assertCurrentSession(epoch: number): void {
  if (!isCurrentSession(epoch)) throw new SessionChangedError();
}
