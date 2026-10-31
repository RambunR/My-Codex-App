export const BRAND_NAME = 'LingYing';

export function brandName(locale: string) {
  return locale === 'zh-TW' ? '靈映' : locale === 'zh-CN' ? '灵映' : BRAND_NAME;
}
