/**
 * 验证码尺寸换算工具（common-ui 的 captcha/verification/utils/util）真实行为回归。
 *
 * 该模块把配置里的百分比尺寸按父级容器换算成像素：换算基数取错会让验证码在弹窗里
 * 溢出或缩成一条；父级容器尚未布局完成（尺寸为 0）时若不回退到视口，会得到 0px 甚至
 * NaN 导致整块验证码不可见；非百分比配置必须原样透传，避免把 '310px' 二次换算。
 * 字符与配色常量决定验证码的取值空间与可读性，数量或取值写错会让验证码更容易猜中
 * 或与背景同色。用例使用真实 DOM 元素与真实视口尺寸，不替换被测实现。
 */
import { describe, expect, it } from 'vitest';

import { _code_chars, _code_color1, _code_color2, resetSize } from './util';

/** 只使用像素配置的尺寸夹具，用于验证原样透传。 */
const PIXEL_CONFIG = {
  barSize: { height: '40px', width: '310px' },
  imgSize: { height: '155px', width: '310px' },
};

/**
 * 建立一个可写入布局尺寸的真实元素。
 * @param width 元素的 offsetWidth。
 * @param height 元素的 offsetHeight。
 * @returns 带指定布局尺寸的真实 div。
 */
function createSizedElement(width: number, height: number) {
  const element = document.createElement('div');
  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    value: width,
  });
  return element;
}

/**
 * 建立"根元素挂在父级容器内"的宿主契约。
 * @param parentWidth 父级容器的 offsetWidth。
 * @param parentHeight 父级容器的 offsetHeight。
 * @returns 宿主实例与它的父级容器。
 */
function createHost(parentWidth: number, parentHeight: number) {
  const parent = createSizedElement(parentWidth, parentHeight);
  const root = document.createElement('div');
  parent.append(root);
  document.body.append(parent);
  return { host: { $el: root }, parent };
}

describe('尺寸换算', /** 百分比与像素两类配置的换算口径直接决定验证码布局。 */ () => {
  it('百分比尺寸按父级容器宽度与高度换算', /** 换算基数取错会让验证码溢出父级容器。 */ () => {
    const { host, parent } = createHost(400, 200);

    const result = resetSize(host, {
      barSize: { height: '50%', width: '100%' },
      imgSize: { height: '25%', width: '75%' },
    });

    expect(result).toEqual({
      barHeight: '100px',
      barWidth: '400px',
      imgHeight: '50px',
      imgWidth: '300px',
    });

    parent.remove();
  });

  it('像素尺寸原样透传', /** 把 '310px' 再按百分比换算会得到 NaN 长度。 */ () => {
    const { host, parent } = createHost(400, 200);

    const result = resetSize(host, PIXEL_CONFIG);

    expect(result).toEqual({
      barHeight: '40px',
      barWidth: '310px',
      imgHeight: '155px',
      imgWidth: '310px',
    });

    parent.remove();
  });

  it('尺寸配置只读取一次父级容器，不混用宽高基数', /** 宽度用高度基数换算会让容器内元素比例失真。 */ () => {
    const { host, parent } = createHost(800, 600);

    const result = resetSize(host, {
      barSize: { height: '10%', width: '10%' },
      imgSize: { height: '10%', width: '10%' },
    });

    expect(result.barWidth).toBe('80px');
    expect(result.barHeight).toBe('60px');

    parent.remove();
  });
});

describe('父级容器兜底', /** 弹窗挂载时机不同，容器尺寸可能尚未就绪。 */ () => {
  it('宿主为空时回退到视口尺寸', /** 取不到容器就返回 NaN 会让验证码整块不可见。 */ () => {
    const result = resetSize(undefined, {
      barSize: { height: '50%', width: '100%' },
      imgSize: { height: '50%', width: '100%' },
    });

    expect(result.barWidth).toBe(`${(window.innerWidth * 100) / 100}px`);
    expect(result.barHeight).toBe(`${(window.innerHeight * 50) / 100}px`);
  });

  it('根元素没有父级容器时回退到视口尺寸', /** 未挂载的组件没有 offsetWidth，必须走视口兜底。 */ () => {
    const root = document.createElement('div');

    const result = resetSize(
      { $el: root },
      {
        barSize: { height: '50%', width: '100%' },
        imgSize: { height: '50%', width: '100%' },
      },
    );

    expect(result.barWidth).toBe(`${(window.innerWidth * 100) / 100}px`);
    expect(result.imgHeight).toBe(`${(window.innerHeight * 50) / 100}px`);
  });

  it('父级容器尺寸为 0 时回退到视口尺寸', /** 未布局的父级会给出 0，直接用 0 会算出 0px 长度。 */ () => {
    const { host, parent } = createHost(0, 0);

    const result = resetSize(host, {
      barSize: { height: '50%', width: '100%' },
      imgSize: { height: '50%', width: '100%' },
    });

    expect(result.barWidth).toBe(`${(window.innerWidth * 100) / 100}px`);
    expect(result.barHeight).toBe(`${(window.innerHeight * 50) / 100}px`);

    parent.remove();
  });
});

describe('验证码字符与配色常量', /** 取值空间与配色决定验证码的可读性与猜测难度。 */ () => {
  it('字符集覆盖 1-9 与大小写字母，不含易混的数字 0', /** 字符集缺项会让生成的验证码分布不均，混入 0 会与字母 O 混淆。 */ () => {
    expect(_code_chars).toHaveLength(61);
    expect(_code_chars.slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(_code_chars).not.toContain(0);
    expect(_code_chars).toContain('a');
    expect(_code_chars).toContain('z');
    expect(_code_chars).toContain('A');
    expect(_code_chars).toContain('Z');
    expect(
      _code_chars.every(
        /** 取值只能是单个数字或单个小写/大写字母。 */ (item) =>
          (typeof item === 'number' && item >= 0 && item <= 9) ||
          (typeof item === 'string' && /^[A-Za-z]$/u.test(item)),
      ),
    ).toBe(true);
  });

  it('背景色与前景色均为合法十六进制且互不相同', /** 前景与背景同色会让用户读不出验证码。 */ () => {
    expect(_code_color1).toHaveLength(4);
    expect(_code_color2).toHaveLength(6);
    expect(
      [..._code_color1, ..._code_color2].every(
        /** 只接受 4 位或 7 位的十六进制颜色字面量。 */ (color) =>
          /^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(color),
      ),
    ).toBe(true);
    expect(
      _code_color2.some(
        /** 至少有一个前景色不出现在浅色背景集合中。 */ (color) =>
          !_code_color1.includes(color),
      ),
    ).toBe(true);
  });
});
