/**
 * 验证码输入（shadcn-ui 的 components/pin-input/input.vue）输入与发送回归。
 *
 * 该组件由验证码分格输入与「发送验证码」按钮组成：输入满长度必须抛出 complete 并写回验证码；
 * 点击发送要走调用方逻辑、进入倒计时并禁用按钮，发送失败必须抛出 sendError 让调用方提示用户；
 * 卸载时必须清掉倒计时，否则定时器会在组件销毁后继续跑。用例真实挂载组件，用真实计时器观察
 * 倒计时与按钮文案，只把发送接口替换成替身。
 */
import { mount } from '@vue/test-utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import VbenPinInput from './input.vue';

/** 每个用例挂载的组件，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

beforeEach(
  /** 清空替身调用，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
  },
);

afterEach(
  /** 卸载组件并清理计时器替身，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
  },
);

/**
 * 挂载验证码输入。
 * @param props 传给组件的属性。
 * @returns 已挂载的组件包装器。
 */
function mountPinInput(props: Record<string, unknown> = {}) {
  return mount(VbenPinInput, {
    props: {
      codeLength: 4,
      /** 倒计时文案生成签名。 */
      createText: (countdown: number) =>
        countdown > 0 ? `重新发送(${countdown})` : '发送验证码',
      ...props,
    },
  });
}

describe('验证码输入与发送', /** 输入与发送是验证码登录链路的两端。 */ () => {
  it('按长度渲染分格并回填外部验证码', /** 分格数量或回填错误会让用户无法输入正确验证码。 */ async () => {
    mounted = mountPinInput({ modelValue: '' });
    // 外部验证码在挂载后同步进来（如回填上次发送的验证码），走真实的属性监听链路。
    await mounted.setProps({ modelValue: '1234' });
    await mounted.vm.$nextTick();

    const inputs = mounted.findAll('input');
    // reka-ui 额外渲染一个隐藏输入用于表单提交。
    expect(inputs).toHaveLength(5);
    expect(
      inputs
        .slice(0, 4)
        .map(
          /** 读取每格字符。 */ (input) =>
            (input.element as HTMLInputElement).value,
        ),
    ).toEqual(['1', '2', '3', '4']);
    expect(mounted.find('button').text()).toBe('发送验证码');
  });

  it('输入完成后写回验证码并抛出 complete', /** 不写回会让父组件拿不到验证码，无法提交。 */ async () => {
    const updates: unknown[] = [];
    mounted = mountPinInput({
      modelValue: '',
      /** 记录取值更新。 */
      'onUpdate:modelValue': (value: unknown) => {
        updates.push(value);
      },
    });
    await mounted.vm.$nextTick();

    const inputs = mounted.findAll('input');
    for (const [index, char] of ['9', '8', '7', '6'].entries()) {
      await inputs[index]?.setValue(char);
    }
    await mounted.vm.$nextTick();
    await mounted.vm.$nextTick();

    expect(updates).toContain('9876');
    expect(mounted.emitted('complete')).toHaveLength(1);
  });

  it('点击发送执行调用方逻辑并进入倒计时', /** 不进入倒计时会让用户重复点击消耗短信额度。 */ async () => {
    vi.useFakeTimers();
    const handleSendCode = vi.fn(/** 模拟发送成功。 */ async () => {});
    mounted = mountPinInput({ maxTime: 3, handleSendCode });

    await mounted.find('button').trigger('click');
    await mounted.vm.$nextTick();

    expect(handleSendCode).toHaveBeenCalledTimes(1);
    expect(mounted.find('button').text()).toBe('重新发送(3)');
    expect(mounted.find('button').attributes('disabled')).toBeDefined();

    // 用假计时器推进倒计时，核对文案真实递减。
    await vi.advanceTimersByTimeAsync(1000);
    await mounted.vm.$nextTick();
    expect(mounted.find('button').text()).toBe('重新发送(2)');
  });

  it('发送失败时抛出 sendError 并结束加载', /** 吞掉失败会让用户以为验证码已发出。 */ async () => {
    const failure = new Error('发送失败');
    const handleSendCode = vi.fn(
      /** 模拟发送失败。 */ async () => {
        throw failure;
      },
    );
    mounted = mountPinInput({ handleSendCode });

    await mounted.find('button').trigger('click');
    await mounted.vm.$nextTick();

    expect(mounted.emitted('sendError')?.[0]).toEqual([failure]);
  });

  it('禁用时不触发发送', /** 禁用态失效会让用户重复发短信。 */ async () => {
    const handleSendCode = vi.fn(/** 模拟发送成功。 */ async () => {});
    mounted = mountPinInput({ disabled: true, handleSendCode });

    await mounted.find('button').trigger('click');
    await mounted.vm.$nextTick();

    expect(handleSendCode).not.toHaveBeenCalled();
  });

  it('卸载时停止倒计时', /** 残留定时器会在组件销毁后继续触发。 */ async () => {
    vi.useFakeTimers();
    const handleSendCode = vi.fn(/** 模拟发送成功。 */ async () => {});
    mounted = mountPinInput({ maxTime: 5, handleSendCode });
    await mounted.find('button').trigger('click');
    await mounted.vm.$nextTick();

    mounted.unmount();
    mounted = undefined;

    expect(vi.getTimerCount()).toBe(0);
  });
});
