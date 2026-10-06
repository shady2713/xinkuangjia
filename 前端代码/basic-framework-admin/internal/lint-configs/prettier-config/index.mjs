/**
 * 共享 Prettier 配置：统一大仓的引号、分号、行宽与换行风格。
 * 默认单引号、保留分号、尾逗号 all、行宽 80、md 正文不折行，
 * 并加载 prettier-plugin-tailwindcss 整理类名顺序；
 * json5 单独放宽为保留属性引号。忽略范围由各包自行声明。
 */
export default {
  endOfLine: 'auto',
  overrides: [
    {
      files: ['*.json5'],
      options: {
        quoteProps: 'preserve',
        singleQuote: false,
      },
    },
  ],
  plugins: ['prettier-plugin-tailwindcss'],
  printWidth: 80,
  proseWrap: 'never',
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
};
