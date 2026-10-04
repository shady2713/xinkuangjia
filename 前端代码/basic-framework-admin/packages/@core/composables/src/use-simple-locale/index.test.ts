/** 精简多语言 composable 测试：验证共享实例的语言切换与真实消息回退口径。 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useSimpleLocale } from './index';
import { getMessages } from './messages';

describe('useSimpleLocale', /** 语言切换是共享状态，多个调用方必须看到同一份当前语言。 */ () => {
  beforeEach(
    /** 共享实例跨用例保留状态，每例先恢复到默认语言。 */ () => {
      useSimpleLocale().setSimpleLocale('zh-CN');
    },
  );

  it('默认使用中文并返回中文消息', /** 未设置语言时必须给出中文文案而不是消息键。 */ () => {
    const { $t, currentLocale } = useSimpleLocale();

    expect(currentLocale.value).toBe('zh-CN');
    expect($t.value('confirm')).toBe(getMessages('zh-CN').confirm);
  });

  it('切换语言后立即更新消息解析结果', /** 语言切换要真实生效，不能只在 ref 上变化而消息仍取旧语言。 */ () => {
    const { $t, setSimpleLocale } = useSimpleLocale();

    setSimpleLocale('en-US');

    expect($t.value('confirm')).toBe(getMessages('en-US').confirm);
  });

  it('多次调用共享同一个语言状态', /** 该 composable 是共享实例，不同调用方不能各持一份语言。 */ () => {
    const first = useSimpleLocale();
    const second = useSimpleLocale();

    first.setSimpleLocale('en-US');

    expect(second.currentLocale.value).toBe('en-US');
    expect(second.$t.value('confirm')).toBe(getMessages('en-US').confirm);
  });

  it('未知消息键回退为键本身', /** 缺少翻译时返回键名，界面才能看出漏配而不是显示 undefined。 */ () => {
    const { $t } = useSimpleLocale();

    expect($t.value('missing-message-key')).toBe('missing-message-key');
  });
});
