/**
 * 上传前校验（utils/useUpload）的真实行为回归。
 *
 * 图片、视频、语音上传都靠它拦截格式与大小：放行错误格式会让后端存储无法预览的文件，
 * 放行超大文件会占满对象存储并拖慢上传。用例只替换错误提示的展示边界，
 * 格式白名单、大小阈值与提示文案保持真实实现。
 */
import type { UploadRawFile } from 'element-plus';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { showErrorMessage } from '#/utils/feedback';

import { UploadType, useBeforeUpload } from './useUpload';

vi.mock(
  '#/utils/feedback',
  /** 只替换错误提示的展示边界，校验逻辑与提示文案保持真实实现。 */ () => ({
    showErrorMessage: vi.fn(),
  }),
);

/** 一兆字节的字节数，用于按真实文件大小构造边界夹具。 */
const MB = 1024 * 1024;

/**
 * 构造指定类型与大小的上传原始文件，用于驱动格式与大小两条校验分支。
 * @param type 浏览器识别出的 MIME 类型。
 * @param sizeBytes 文件字节数，用于触发大小阈值分支。
 * @param name 文件名，仅用于区分夹具。
 * @returns 带唯一 uid 的上传原始文件，形状与 Element Plus 交给校验函数的一致。
 */
function rawFile(
  type: string,
  sizeBytes: number,
  name = 'fixture',
): UploadRawFile {
  return Object.assign(new File([new ArrayBuffer(sizeBytes)], name, { type }), {
    uid: 1,
  });
}

beforeEach(
  /** 清空上一例的提示记录，避免文案断言读到旧调用。 */ () => {
    vi.mocked(showErrorMessage).mockClear();
  },
);

describe('图片上传校验', /** 图片只允许浏览器可预览的位图格式，且不得超过两兆。 */ () => {
  it('放行全部允许的图片格式', /** 白名单漏项会让正常图片无法上传。 */ () => {
    const check = useBeforeUpload(UploadType.Image, 2);

    for (const type of [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/bmp',
      'image/jpg',
    ]) {
      expect(check(rawFile(type, MB))).toBe(true);
    }
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('拒绝非白名单图片格式并提示图片格式不对', /** 放行脚本或矢量格式会带来存储型脚本风险。 */ () => {
    const check = useBeforeUpload(UploadType.Image, 2);

    expect(check(rawFile('image/svg+xml', MB))).toBe(false);
    expect(showErrorMessage).toHaveBeenCalledWith('上传图片格式不对!');
  });

  it('恰好两兆放行、超过一字节拒绝', /** 阈值判断必须用严格大于，否则合法边界文件会被误拒。 */ () => {
    const check = useBeforeUpload(UploadType.Image, 2);

    expect(check(rawFile('image/png', 2 * MB))).toBe(true);
    expect(check(rawFile('image/png', 2 * MB + 1))).toBe(false);
    expect(showErrorMessage).toHaveBeenCalledWith('上传图片大小不能超过2M!');
  });

  it('图片大小上限固定为两兆而不取传入值', /** 提示与实际阈值必须一致，否则用户按提示裁剪后仍会被拒。 */ () => {
    const check = useBeforeUpload(UploadType.Image, 99);

    expect(check(rawFile('image/png', 3 * MB))).toBe(false);
    expect(showErrorMessage).toHaveBeenCalledWith('上传图片大小不能超过2M!');
  });
});

describe('视频上传校验', /** 视频只允许 mp4，且不得超过十兆。 */ () => {
  it('放行 mp4 并拒绝其它视频格式', /** 放行浏览器无法播放的容器会导致上传后无法预览。 */ () => {
    const check = useBeforeUpload(UploadType.Video, 10);

    expect(check(rawFile('video/mp4', MB))).toBe(true);
    expect(check(rawFile('video/avi', MB))).toBe(false);
    expect(showErrorMessage).toHaveBeenCalledWith('上传视频格式不对!');
  });

  it('恰好十兆放行、超过一字节拒绝', /** 视频阈值与图片不同，混用会让大视频被误拒。 */ () => {
    const check = useBeforeUpload(UploadType.Video, 10);

    expect(check(rawFile('video/mp4', 10 * MB))).toBe(true);
    expect(check(rawFile('video/mp4', 10 * MB + 1))).toBe(false);
    expect(showErrorMessage).toHaveBeenCalledWith('上传视频大小不能超过10M!');
  });

  it('三兆视频在视频类型下放行', /** 视频上限必须高于图片上限，否则业务无法上传正常视频。 */ () => {
    const check = useBeforeUpload(UploadType.Video, 10);

    expect(check(rawFile('video/mp4', 3 * MB))).toBe(true);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });
});

describe('语音上传校验', /** 语音只允许常见音频格式，且不得超过两兆。 */ () => {
  it('放行全部允许的音频格式', /** 白名单漏项会让正常录音无法上传。 */ () => {
    const check = useBeforeUpload(UploadType.Voice, 2);

    for (const type of [
      'audio/mp3',
      'audio/mpeg',
      'audio/wma',
      'audio/wav',
      'audio/amr',
    ]) {
      expect(check(rawFile(type, MB))).toBe(true);
    }
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('拒绝非白名单音频格式并提示语音格式不对', /** 放行任意音频格式会让后端拿到无法播放的文件。 */ () => {
    const check = useBeforeUpload(UploadType.Voice, 2);

    expect(check(rawFile('audio/flac', MB))).toBe(false);
    expect(showErrorMessage).toHaveBeenCalledWith('上传语音格式不对!');
  });

  it('超过两兆的语音被拒绝', /** 语音阈值按两兆控制，避免长录音占满存储。 */ () => {
    const check = useBeforeUpload(UploadType.Voice, 2);

    expect(check(rawFile('audio/mp3', 2 * MB + 1))).toBe(false);
    expect(showErrorMessage).toHaveBeenCalledWith('上传语音大小不能超过2M!');
  });
});
