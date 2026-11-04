/** 手机号正则表达式（中国） */
const MOBILE_REGEX = /(?:0|86|\+86)?1[3-9]\d{9}/;
/** 身份证号正则表达式 */
const ID_CARD_REGEX = /^\d{15}|\d{18}$/;
/** 邮箱正则表达式 */
const EMAIL_REGEX = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
export { EMAIL_REGEX, ID_CARD_REGEX, MOBILE_REGEX };
