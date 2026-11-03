import type {Locale} from '../shared/config';

export const seriesAccessEnglish={
  "accessType": "Free or paid",
  "accessAllFree": "All free",
  "accessAllPaid": "All paid",
  "accessFreeThenPaid": "Free + paid",
  "accessCompletelyFree": "Completely free"
} as const;
export type SeriesAccessKey=keyof typeof seriesAccessEnglish;
type SeriesAccessCopy=Record<SeriesAccessKey,string>;

export const seriesAccessMessages:Record<Locale,SeriesAccessCopy>={
  "en": {
    "accessType": "Free or paid",
    "accessAllFree": "All free",
    "accessAllPaid": "All paid",
    "accessFreeThenPaid": "Free + paid",
    "accessCompletelyFree": "Completely free"
  },
  "zh-TW": {
    "accessType": "免費或付費",
    "accessAllFree": "全部免費",
    "accessAllPaid": "全部付費",
    "accessFreeThenPaid": "免費 + 付費",
    "accessCompletelyFree": "完全免費"
  },
  "zh-CN": {
    "accessType": "免费或付费",
    "accessAllFree": "全部免费",
    "accessAllPaid": "全部付费",
    "accessFreeThenPaid": "免费 + 付费",
    "accessCompletelyFree": "完全免费"
  },
  "ja": {
    "accessType": "無料・有料",
    "accessAllFree": "すべて無料",
    "accessAllPaid": "すべて有料",
    "accessFreeThenPaid": "無料・有料の両方",
    "accessCompletelyFree": "完全無料"
  },
  "ko": {
    "accessType": "무료 또는 유료",
    "accessAllFree": "모두 무료",
    "accessAllPaid": "모두 유료",
    "accessFreeThenPaid": "무료 + 유료",
    "accessCompletelyFree": "완전 무료"
  },
  "hi": {
    "accessType": "मुफ़्त या सशुल्क",
    "accessAllFree": "सभी मुफ़्त",
    "accessAllPaid": "सभी सशुल्क",
    "accessFreeThenPaid": "मुफ़्त + सशुल्क",
    "accessCompletelyFree": "पूरी तरह मुफ़्त"
  },
  "id": {
    "accessType": "Gratis atau berbayar",
    "accessAllFree": "Semua gratis",
    "accessAllPaid": "Semua berbayar",
    "accessFreeThenPaid": "Gratis + berbayar",
    "accessCompletelyFree": "Sepenuhnya gratis"
  },
  "pt-BR": {
    "accessType": "Grátis ou pago",
    "accessAllFree": "Tudo gratuito",
    "accessAllPaid": "Tudo pago",
    "accessFreeThenPaid": "Grátis + pago",
    "accessCompletelyFree": "Totalmente gratuito"
  },
  "es": {
    "accessType": "Gratis o de pago",
    "accessAllFree": "Todo gratis",
    "accessAllPaid": "Todo de pago",
    "accessFreeThenPaid": "Gratis + de pago",
    "accessCompletelyFree": "Completamente gratis"
  },
  "ar": {
    "accessType": "مجاني أو مدفوع",
    "accessAllFree": "مجانية بالكامل",
    "accessAllPaid": "مدفوعة بالكامل",
    "accessFreeThenPaid": "مجاني + مدفوع",
    "accessCompletelyFree": "مجانية بالكامل"
  },
  "bn": {
    "accessType": "ফ্রি বা পেইড",
    "accessAllFree": "সব ফ্রি",
    "accessAllPaid": "সব পেইড",
    "accessFreeThenPaid": "ফ্রি + পেইড",
    "accessCompletelyFree": "সম্পূর্ণ ফ্রি"
  },
  "ur": {
    "accessType": "مفت یا بامعاوضہ",
    "accessAllFree": "سب مفت",
    "accessAllPaid": "سب بامعاوضہ",
    "accessFreeThenPaid": "مفت + بامعاوضہ",
    "accessCompletelyFree": "مکمل طور پر مفت"
  },
  "vi": {
    "accessType": "Miễn phí hoặc trả phí",
    "accessAllFree": "Tất cả miễn phí",
    "accessAllPaid": "Tất cả trả phí",
    "accessFreeThenPaid": "Miễn phí + trả phí",
    "accessCompletelyFree": "Hoàn toàn miễn phí"
  },
  "th": {
    "accessType": "ฟรีหรือเสียเงิน",
    "accessAllFree": "ฟรีทั้งหมด",
    "accessAllPaid": "เสียเงินทั้งหมด",
    "accessFreeThenPaid": "ฟรี + เสียเงิน",
    "accessCompletelyFree": "ฟรีทั้งหมด"
  },
  "fil": {
    "accessType": "Libre o may bayad",
    "accessAllFree": "Lahat libre",
    "accessAllPaid": "Lahat may bayad",
    "accessFreeThenPaid": "Libre + may bayad",
    "accessCompletelyFree": "Ganap na libre"
  },
  "tr": {
    "accessType": "Ücretsiz veya ücretli",
    "accessAllFree": "Tamamı ücretsiz",
    "accessAllPaid": "Tamamı ücretli",
    "accessFreeThenPaid": "Ücretsiz + ücretli",
    "accessCompletelyFree": "Tamamen ücretsiz"
  },
  "ru": {
    "accessType": "Бесплатно или платно",
    "accessAllFree": "Полностью бесплатно",
    "accessAllPaid": "Полностью платно",
    "accessFreeThenPaid": "Бесплатно + платно",
    "accessCompletelyFree": "Полностью бесплатно"
  },
  "fr": {
    "accessType": "Gratuit ou payant",
    "accessAllFree": "Tout gratuit",
    "accessAllPaid": "Tout payant",
    "accessFreeThenPaid": "Gratuit + payant",
    "accessCompletelyFree": "Entièrement gratuit"
  },
  "de": {
    "accessType": "Kostenlos oder kostenpflichtig",
    "accessAllFree": "Alles kostenlos",
    "accessAllPaid": "Alles kostenpflichtig",
    "accessFreeThenPaid": "Kostenlos + kostenpflichtig",
    "accessCompletelyFree": "Vollständig kostenlos"
  },
  "ms": {
    "accessType": "Percuma atau berbayar",
    "accessAllFree": "Semua percuma",
    "accessAllPaid": "Semua berbayar",
    "accessFreeThenPaid": "Percuma + berbayar",
    "accessCompletelyFree": "Percuma sepenuhnya"
  },
  "ta": {
    "accessType": "இலவசம் அல்லது கட்டணம்",
    "accessAllFree": "அனைத்தும் இலவசம்",
    "accessAllPaid": "அனைத்தும் கட்டணம்",
    "accessFreeThenPaid": "இலவசம் + கட்டணம்",
    "accessCompletelyFree": "முற்றிலும் இலவசம்"
  }
};
