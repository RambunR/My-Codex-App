export const LANGUAGES = [
  { code: 'en', name: 'English', region: 'Global', flag: '🌐' },
  { code: 'zh-TW', name: '繁體中文', region: 'Hong Kong · Taiwan', flag: '🇭🇰' },
  { code: 'zh-CN', name: '简体中文', region: 'Mainland China', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', region: 'Japan', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', region: 'South Korea', flag: '🇰🇷' },
  { code: 'hi', name: 'हिन्दी', region: 'India', flag: '🇮🇳' },
  { code: 'id', name: 'Bahasa Indonesia', region: 'Indonesia', flag: '🇮🇩' },
  { code: 'pt-BR', name: 'Português', region: 'Brazil', flag: '🇧🇷' },
  { code: 'es', name: 'Español', region: 'Latin America', flag: '🇲🇽' },
  { code: 'ar', name: 'العربية', region: 'Middle East', flag: '🇸🇦' },
  { code: 'bn', name: 'বাংলা', region: 'Bangladesh · India', flag: '🇧🇩' },
  { code: 'ur', name: 'اردو', region: 'Pakistan', flag: '🇵🇰' },
  { code: 'vi', name: 'Tiếng Việt', region: 'Vietnam', flag: '🇻🇳' },
  { code: 'th', name: 'ไทย', region: 'Thailand', flag: '🇹🇭' },
  { code: 'fil', name: 'Filipino', region: 'Philippines', flag: '🇵🇭' },
  { code: 'tr', name: 'Türkçe', region: 'Türkiye', flag: '🇹🇷' },
  { code: 'ru', name: 'Русский', region: 'Russia', flag: '🇷🇺' },
  { code: 'fr', name: 'Français', region: 'France · Africa', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', region: 'Germany', flag: '🇩🇪' },
  { code: 'ms', name: 'Bahasa Melayu', region: 'Malaysia', flag: '🇲🇾' },
  { code: 'ta', name: 'தமிழ்', region: 'India · Sri Lanka', flag: '🇮🇳' },
] as const;
export const GENRES = ['romance', 'fantasy', 'thriller', 'drama', 'comedy', 'action', 'sci-fi', 'historical', 'horror', 'animation'] as const;
export const MAX_EPISODE_SECONDS = 180;
export const MAX_EPISODE_BYTES = 75 * 1024 * 1024;
export const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
export const USD_MICROS = 1_000_000;
export const ACTIVATION_HKD_CENTS = 8800;
export const MIN_PRICE_CENTS = 10;
export const MIN_WALLET_FUNDING_CENTS = 500;
// Documented eight-digit USD PaymentIntent amount supported by this integration.
export const MAX_WALLET_FUNDING_CENTS = 99_999_999;
export type Locale = typeof LANGUAGES[number]['code'];
export interface User {
  id: string; name: string; email: string; role: 'viewer' | 'publisher' | 'admin'; publisher_active: number;
  wallet_micros: number; earnings_micros: number; quota_bytes: number; used_bytes: number; language: string;
  stripe_account_id?: string; connected?: boolean;
}
export interface Series {
  id: string; title: string; description: string; language: string; genres: string[]; cover: string; creator_id: string;
  creator_name: string; creation_type: 'human' | 'ai-assisted' | 'ai-generated'; price_cents: number; free_episodes: number;
  episode_count: number; views: number; saves: number; status: string; featured: number; created_at: string;
  saved?: boolean; demo?: number; subtitle_languages?: string[]; first_episode_id?: string;
}
export interface Episode { id: string; series_id: string; title: string; number: number; duration: number; bytes: number; free: boolean; unlocked: boolean; cover?: string }
export const usd = (micros: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(micros / USD_MICROS);
export const bytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
