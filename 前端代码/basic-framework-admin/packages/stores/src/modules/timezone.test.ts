/**
 * 时区 store（stores 的 modules/timezone）真实行为回归。
 *
 * 该 store 把已注册的时区处理模块与 pinia 状态连起来：初始化时按处理模块返回的
 * 时区刷新全局 dayjs 默认时区，设置时区后要同时更新状态与全局默认，选项列表必须
 * 把内置选项转换成 {label,value} 形状。处理模块缺失、返回空值或抛错都不能让状态
 * 与全局默认时区脱节。用例使用真实 pinia 与共享工具，只把时区处理模块替换为
 * 用例指定的实现（这正是生产通过 setTimezoneHandler 注入的扩展点）。
 */
import type { TimezoneOption } from '@vben-core/typings';

import { DEFAULT_TIME_ZONE_OPTIONS } from '@vben-core/preferences';
import {
  getCurrentTimezone,
  setCurrentTimezone,
} from '@vben-core/shared/utils';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTimezoneHandler, useTimezoneStore } from './timezone';

/** 用例开始时进程的当前时区；每个用例结束后按它恢复共享状态。 */
const initialTimezone = getCurrentTimezone();

/** 内置时区选项转换后的期望形状，用于核对 label/value 字段映射。 */
function expectedDefaultOptions() {
  return DEFAULT_TIME_ZONE_OPTIONS.map(
    /** 把内置选项声明转换成下拉框需要的 label/value。 */ (item) => ({
      label: item.label,
      value: item.timezone,
    }),
  );
}

/**
 * 创建真实时区 store。
 * @returns 新建的 store 实例，其 setup 已触发一次初始化。
 */
function createTimezoneStore() {
  return useTimezoneStore();
}

beforeEach(
  /** 每例使用独立 pinia，并清空上一例注册的自定义时区处理模块。 */ () => {
    setActivePinia(createPinia());
    setTimezoneHandler({});
  },
);

afterEach(
  /** 恢复模块级全局时区，避免影响其它测试文件共享的 dayjs 默认值。 */ () => {
    setCurrentTimezone(initialTimezone);
    setTimezoneHandler({});
  },
);

describe('时区选项', /** 选项列表是时区下拉框的数据来源，缺项或字段名错误会让用户选不到时区。 */ () => {
  it('没有自定义处理模块时返回内置时区选项', /** 内置选项必须转换成 value=timezone 的形状，直接用原对象会让下拉框收到空值。 */ async () => {
    const store = createTimezoneStore();

    await expect(store.getTimezoneOptions()).resolves.toEqual(
      expectedDefaultOptions(),
    );
  });

  it('自定义处理模块的选项覆盖内置选项', /** 业务注入服务端时区列表时必须生效，否则用户只能看到内置的几个时区。 */ async () => {
    const customOption: TimezoneOption = {
      label: '东八区',
      offset: 8,
      timezone: 'Asia/Shanghai',
    };
    setTimezoneHandler({
      /** 返回业务自定义的单条时区选项。 */
      getTimezoneOptions: async () => [
        { label: customOption.label, value: customOption.timezone },
      ],
    });
    const store = createTimezoneStore();

    await expect(store.getTimezoneOptions()).resolves.toEqual([
      { label: '东八区', value: 'Asia/Shanghai' },
    ]);
  });

  it('处理模块返回空值时回退为空数组', /** 回退到 undefined 会让调用方遍历选项时报错。 */ async () => {
    const emptyOptionHandler: Parameters<typeof setTimezoneHandler>[0] = {
      /** 越界替身：模拟后端查询失败返回空值，用于验证缺省回退而不是正常契约。 */
      getTimezoneOptions: async () => undefined as never,
    };
    setTimezoneHandler(emptyOptionHandler);
    const store = createTimezoneStore();

    await expect(store.getTimezoneOptions()).resolves.toEqual([]);
  });
});

describe('时区初始化', /** 初始化把持久化的用户时区写回全局 dayjs 默认值，写错会影响所有时间展示。 */ () => {
  it('处理模块返回时区时更新状态与全局默认时区', /** 只改状态会让 dayjs 仍按系统时区格式化，页面时间与所选时区不一致。 */ async () => {
    setTimezoneHandler({
      /** 返回固定的用户时区，用于验证初始化写入。 */
      getTimezone: async () => 'Asia/Tokyo',
    });
    const store = createTimezoneStore();

    await vi.waitFor(
      /** 等待 store setup 期间发起的异步初始化完成。 */ () => {
        expect(store.timezone).toBe('Asia/Tokyo');
      },
    );
    expect(getCurrentTimezone()).toBe('Asia/Tokyo');
  });

  it('处理模块返回空值时保留当前时区', /** 后端未配置时区时不能把全局默认值清成空串或系统时区之外的值。 */ async () => {
    setCurrentTimezone('Europe/London');
    setTimezoneHandler({
      /** 返回空值，模拟后端尚未配置用户时区。 */
      getTimezone: async () => undefined,
    });
    const store = createTimezoneStore();

    await vi.waitFor(
      /** 等待异步初始化走完，再确认状态没有被改写。 */ () => {
        expect(store.timezone).toBe('Europe/London');
      },
    );
    expect(getCurrentTimezone()).toBe('Europe/London');
  });

  it('初始化失败时记录错误并保留当前时区', /** 静默失败会让排查失去线索，改写状态则会让页面时间跳到错误时区。 */ async () => {
    setCurrentTimezone('Europe/London');
    const failure = new Error('时区查询失败');
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默预期内的错误输出，避免污染测试结果。 */ () => {},
      );
    setTimezoneHandler({
      /** 模拟时区查询接口不可用。 */
      getTimezone: async () => {
        throw failure;
      },
    });
    const store = createTimezoneStore();

    await vi.waitFor(
      /** 等待 store setup 期间发起的初始化失败被捕获。 */ () => {
        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to initialize timezone during store setup:',
          failure,
        );
      },
    );
    expect(store.timezone).toBe('Europe/London');
    expect(getCurrentTimezone()).toBe('Europe/London');
    errorSpy.mockRestore();
  });
});

describe('设置时区', /** 设置时区由布局上的时区按钮触发，必须同时落到处理模块、状态与全局默认值。 */ () => {
  it('把时区交给处理模块并同步状态与全局默认值', /** 未调用处理模块会让后端保存的偏好与前端展示不一致。 */ async () => {
    const persistTimezone = vi.fn(
      /** 记录业务向服务端提交的时区值。 */ async () => {},
    );
    setTimezoneHandler({ setTimezone: persistTimezone });
    const store = createTimezoneStore();

    await store.setTimezone('Asia/Seoul');

    expect(persistTimezone).toHaveBeenCalledWith('Asia/Seoul');
    expect(store.timezone).toBe('Asia/Seoul');
    expect(getCurrentTimezone()).toBe('Asia/Seoul');
  });

  it('处理模块未提供保存能力时仍更新本地状态', /** 只读部署没有持久化接口，此时设置项仍必须立刻生效。 */ async () => {
    const store = createTimezoneStore();

    await store.setTimezone('Asia/Tokyo');

    expect(store.timezone).toBe('Asia/Tokyo');
    expect(getCurrentTimezone()).toBe('Asia/Tokyo');
  });
});

describe('重置时区', /** $reset 用于退出登录等场景，必须回到全局记录的时区而不是上一次的本地值。 */ () => {
  it('重置为全局默认时区', /** 保留上一次选择会让下一个账号沿用前一个用户的时区。 */ async () => {
    const store = createTimezoneStore();
    await store.setTimezone('Asia/Tokyo');
    setCurrentTimezone('America/New_York');

    store.$reset();

    expect(store.timezone).toBe('America/New_York');
  });
});
