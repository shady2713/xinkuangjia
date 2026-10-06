/**
 * OAuth2 授权开放接口：供 SSO 授权确认页读取客户端信息并提交勾选的范围。
 * 授权结果由浏览器按重定向地址跳回业务系统，本模块不保存令牌；
 * 客户端的后台维护接口在 oauth2/client。
 */
import { requestClient } from '#/api/request';

/** OAuth2.0 授权信息响应 */
export namespace SystemOAuth2ClientApi {
  /** 授权信息 */
  export interface AuthorizeInfoRespVO {
    client: {
      logo: string;
      name: string;
    };
    scopes: {
      key: string;
      value: boolean;
    }[];
  }
}

/**
 * 读取授权确认页所需的客户端展示信息与可授权范围。
 *
 * 授权确认页先调用本接口渲染“某应用申请访问你的数据”的界面，再由用户勾选范围提交。
 * 约定端点为 GET /system/oauth2/authorize；本仓库后端未注册该路径，调用失败时按业务码提示。
 * @param clientId 发起授权的客户端编号，取自 SSO 入口地址上的 client_id 查询参数。
 * @returns 客户端展示信息（logo、name）与可授权范围列表，每项的 value 标记该范围是否默认勾选。
 */
export function getAuthorize(clientId: string) {
  return requestClient.get<SystemOAuth2ClientApi.AuthorizeInfoRespVO>(
    `/system/oauth2/authorize?clientId=${clientId}`,
  );
}

/**
 * 提交用户的授权确认，勾选与未勾选的范围被合并成一张 scope 布尔表。
 *
 * 约定端点为 POST /system/oauth2/authorize，按表单编码发送参数；
 * 本仓库后端未注册该路径，调用失败时按业务码提示。
 * @param responseType 授权响应类型，决定后端回传授权码还是访问令牌。
 * @param clientId 发起授权的客户端编号，需与授权入口地址上的 client_id 一致。
 * @param redirectUri 授权完成后回跳的业务系统地址，必须是该客户端已登记的回调地址。
 * @param state 业务系统原样带回的状态值，用于回跳后校验请求来源，透传不做加工。
 * @param autoApprove true 表示无需用户确认直接按已授权范围放行，用于跳过确认页的自动授权尝试。
 * @param checkedScopes 用户同意的范围键集合。
 * @param uncheckedScopes 用户拒绝的范围键集合，与已同意范围合成后决定最终授权的 scope。
 * @returns 授权成功后的回跳地址字符串，调用方直接用它跳转浏览器；未获授权时返回空值。
 */
export function authorize(
  responseType: string,
  clientId: string,
  redirectUri: string,
  state: string,
  autoApprove: boolean,
  checkedScopes: string[],
  uncheckedScopes: string[],
) {
  // 构建 scopes
  const scopes: Record<string, boolean> = {};
  for (const scope of checkedScopes) {
    scopes[scope] = true;
  }
  for (const scope of uncheckedScopes) {
    scopes[scope] = false;
  }

  // 发起请求
  return requestClient.post<string>('/system/oauth2/authorize', null, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    params: {
      response_type: responseType,
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      auto_approve: autoApprove,
      scope: JSON.stringify(scopes),
    },
  });
}
