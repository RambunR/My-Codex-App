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
export {GENRES} from './taxonomy.js';
import type {StoryTheme,SeriesFormat} from './taxonomy.js';
export {UPLOAD_COVER_ASPECT_RATIOS,COVER_ASPECT_DIMENSIONS,coverAspectRatioCss} from './cover-layout.js';
export type {CoverAspectRatio,UploadCoverAspectRatio} from './cover-layout.js';
import type {CoverAspectRatio} from './cover-layout.js';
import type {SeriesAccessType} from './catalog-access.js';
export type {SeriesAccessType} from './catalog-access.js';
export const MAX_EPISODE_SECONDS = 240;
export const MAX_EPISODE_BYTES = 200 * 1024 * 1024;
export const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
export const USD_MICROS = 1_000_000;
export const ACTIVATION_HKD_CENTS = 8800;
export const MIN_PRICE_CENTS = 10;
export const MIN_WALLET_FUNDING_CENTS = 500;
// Documented eight-digit USD PaymentIntent amount supported by this integration.
export const MAX_WALLET_FUNDING_CENTS = 99_999_999;
export type Locale = typeof LANGUAGES[number]['code'];
export interface PublisherProfile {id:string;display_name:string;registered_at:string;managed:boolean;is_official:boolean}
export interface AdminPublisherProfile extends PublisherProfile {created_at:string;updated_at:string;series_count:number}
export interface PublisherPage {
  publisher:PublisherProfile;
  stats:{series_count:number;episode_count:number;views:number;tracked_views:number;likes:number;total_watch_seconds:number;avg_watch_seconds:number};
  series:Series[];
  pagination:{page:number;page_size:number;total:number;total_pages:number};
}
export interface StorageUsage {used_bytes:number;quota_bytes:number;storage_unlimited?:boolean}
export interface User extends StorageUsage {
  id: string; name: string; email: string; role: 'viewer' | 'publisher' | 'admin'; publisher_active: number;
  wallet_micros: number; earnings_micros: number; language: string;
  stripe_account_id?: string; connected?: boolean;
  test_withdrawal_unlimited?:boolean;
  creator_display_name?: string;
  email_verified?: boolean;
  payment_review?: boolean;
  dramio_pass?: {active:boolean;test:boolean;purchased_at:string|null};
}
export interface Series {
  id: string; title: string; description: string; language: string; genres: string[]; cover: string; creator_id?: string;
  creator_name: string; creation_type: 'human' | 'ai-assisted' | 'ai-generated'; price_cents: number; free_episodes: number;
  publisher_id?:string;publisher?:PublisherProfile;publisher_profile_id?:string|null;
  cover_aspect_ratio?:CoverAspectRatio;
  last_episode_free?:boolean;
  free_episode_count?:number;
  access_type?:SeriesAccessType|null;
  episode_count: number; views: number; saves: number; status: string; featured: number; created_at: string; published_at?: string;
  likes: number; liked: boolean;
  saved?: boolean; demo?: number; subtitle_languages?: string[]; first_episode_id?: string;
  themes?: StoryTheme[]; format?: SeriesFormat|null;
  taken_down?: boolean; moderation_reason?: string; moderated_at?: string;
}
export interface Episode { id: string; series_id: string; title: string; number: number; duration: number; bytes: number; free: boolean; unlocked: boolean; cover?: string; views?: number }
export const usd = (micros: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(micros / USD_MICROS);
export const bytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
