import type {Locale} from '../shared/config';

export const seriesAccessEnglish={
  "accessType": "Free or paid",
  "accessAllFree": "All free",
  "accessAllPaid": "All paid",
  "accessFreeThenPaid": "Free then paid"
} as const;
export type SeriesAccessKey=keyof typeof seriesAccessEnglish;
type SeriesAccessCopy=Record<SeriesAccessKey,string>;

export const seriesAccessMessages:Record<Locale,SeriesAccessCopy>={
  "en": {
    "accessType": "Free or paid",
    "accessAllFree": "All free",
    "accessAllPaid": "All paid",
    "accessFreeThenPaid": "Free then paid"
  },
  "zh-TW": {
    "accessType": "免費或付費",
    "accessAllFree": "全部免費",
    "accessAllPaid": "全部付費",
    "accessFreeThenPaid": "先免費後付費"
  },
  "zh-CN": {
    "accessType": "免费或付费",
    "accessAllFree": "全部免费",
    "accessAllPaid": "全部付费",
    "accessFreeThenPaid": "先免费后付费"
  },
  "ja": {
    "accessType": "無料・有料",
    "accessAllFree": "すべて無料",
    "accessAllPaid": "すべて有料",
    "accessFreeThenPaid": "最初は無料、その後有料"
  },
  "ko": {
    "accessType": "무료 또는 유료",
    "accessAllFree": "모두 무료",
    "accessAllPaid": "모두 유료",
    "accessFreeThenPaid": "무료 후 유료"
  },
  "hi": {
    "accessType": "मुफ़्त या सशुल्क",
    "accessAllFree": "सभी मुफ़्त",
    "accessAllPaid": "सभी सशुल्क",
    "accessFreeThenPaid": "पहले मुफ़्त, फिर सशुल्क"
  },
  "id": {
    "accessType": "Gratis atau berbayar",
    "accessAllFree": "Semua gratis",
    "accessAllPaid": "Semua berbayar",
    "accessFreeThenPaid": "Gratis lalu berbayar"
  },
  "pt-BR": {
    "accessType": "Grátis ou pago",
    "accessAllFree": "Tudo gratuito",
    "accessAllPaid": "Tudo pago",
    "accessFreeThenPaid": "Grátis, depois pago"
  },
  "es": {
    "accessType": "Gratis o de pago",
    "accessAllFree": "Todo gratis",
    "accessAllPaid": "Todo de pago",
    "accessFreeThenPaid": "Gratis y luego de pago"
  },
  "ar": {
    "accessType": "مجاني أو مدفوع",
    "accessAllFree": "مجانية بالكامل",
    "accessAllPaid": "مدفوعة بالكامل",
    "accessFreeThenPaid": "مجانية ثم مدفوعة"
  },
  "bn": {
    "accessType": "ফ্রি বা পেইড",
    "accessAllFree": "সব ফ্রি",
    "accessAllPaid": "সব পেইড",
    "accessFreeThenPaid": "প্রথমে ফ্রি, পরে পেইড"
  },
  "ur": {
    "accessType": "مفت یا بامعاوضہ",
    "accessAllFree": "سب مفت",
    "accessAllPaid": "سب بامعاوضہ",
    "accessFreeThenPaid": "پہلے مفت، پھر بامعاوضہ"
  },
  "vi": {
    "accessType": "Miễn phí hoặc trả phí",
    "accessAllFree": "Tất cả miễn phí",
    "accessAllPaid": "Tất cả trả phí",
    "accessFreeThenPaid": "Miễn phí rồi trả phí"
  },
  "th": {
    "accessType": "ฟรีหรือเสียเงิน",
    "accessAllFree": "ฟรีทั้งหมด",
    "accessAllPaid": "เสียเงินทั้งหมด",
    "accessFreeThenPaid": "ฟรีก่อนแล้วเสียเงิน"
  },
  "fil": {
    "accessType": "Libre o may bayad",
    "accessAllFree": "Lahat libre",
    "accessAllPaid": "Lahat may bayad",
    "accessFreeThenPaid": "Libre muna, saka may bayad"
  },
  "tr": {
    "accessType": "Ücretsiz veya ücretli",
    "accessAllFree": "Tamamı ücretsiz",
    "accessAllPaid": "Tamamı ücretli",
    "accessFreeThenPaid": "Önce ücretsiz, sonra ücretli"
  },
  "ru": {
    "accessType": "Бесплатно или платно",
    "accessAllFree": "Полностью бесплатно",
    "accessAllPaid": "Полностью платно",
    "accessFreeThenPaid": "Сначала бесплатно, затем платно"
  },
  "fr": {
    "accessType": "Gratuit ou payant",
    "accessAllFree": "Tout gratuit",
    "accessAllPaid": "Tout payant",
    "accessFreeThenPaid": "D’abord gratuit, puis payant"
  },
  "de": {
    "accessType": "Kostenlos oder kostenpflichtig",
    "accessAllFree": "Alles kostenlos",
    "accessAllPaid": "Alles kostenpflichtig",
    "accessFreeThenPaid": "Erst kostenlos, dann kostenpflichtig"
  },
  "ms": {
    "accessType": "Percuma atau berbayar",
    "accessAllFree": "Semua percuma",
    "accessAllPaid": "Semua berbayar",
    "accessFreeThenPaid": "Percuma kemudian berbayar"
  },
  "ta": {
    "accessType": "இலவசம் அல்லது கட்டணம்",
    "accessAllFree": "அனைத்தும் இலவசம்",
    "accessAllPaid": "அனைத்தும் கட்டணம்",
    "accessFreeThenPaid": "முதலில் இலவசம், பிறகு கட்டணம்"
  }
};
