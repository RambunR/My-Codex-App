import {LANGUAGES,type Locale} from '../shared/config';
import {SPOKEN_LANGUAGES,isLegacyChineseLanguage} from '../shared/spoken-languages';

export {defaultSpokenLanguage} from '../shared/spoken-languages';

type SpokenLanguageCopy={mandarin:string;cantonese:string;chineseUnspecified:string};
const rows:Record<Locale,readonly [string,string,string]>={
  en:['Mandarin','Cantonese','Chinese (spoken variety not specified)'],
  'zh-TW':['普通話','粵語','中文（未註明口語種類）'],
  'zh-CN':['普通话','粤语','中文（未注明口语种类）'],
  ja:['標準中国語','広東語','中国語（話し言葉の種類未指定）'],
  ko:['표준 중국어','광둥어','중국어(세부 언어 미지정)'],
  hi:['मंदारिन चीनी','कैंटोनीज़','चीनी (बोली निर्दिष्ट नहीं)'],
  id:['Bahasa Mandarin','Bahasa Kanton','Bahasa Tionghoa (ragam lisan belum ditentukan)'],
  'pt-BR':['Chinês mandarim','Cantonês','Chinês (variedade falada não informada)'],
  es:['Chino mandarín','Cantonés','Chino (variedad hablada sin especificar)'],
  ar:['الماندرين','الكانتونية','الصينية (اللهجة غير محددة)'],
  bn:['ম্যান্ডারিন চীনা','ক্যান্টোনিজ','চীনা (কথ্য রূপ উল্লেখ করা হয়নি)'],
  ur:['مینڈرن چینی','کینٹونیز','چینی (بولی متعین نہیں)'],
  vi:['Tiếng Trung phổ thông','Tiếng Quảng Đông','Tiếng Trung (chưa xác định biến thể nói)'],
  th:['ภาษาจีนกลาง','ภาษาจีนกวางตุ้ง','ภาษาจีน (ไม่ระบุภาษาพูด)'],
  fil:['Mandarin','Kantones','Tsino (hindi tinukoy ang wikang sinasalita)'],
  tr:['Mandarin Çincesi','Kantonca','Çince (lehçe belirtilmemiş)'],
  ru:['Мандаринский китайский','Кантонский','Китайский (разновидность языка не указана)'],
  fr:['Chinois mandarin','Cantonais','Chinois (variété parlée non précisée)'],
  de:['Mandarin-Chinesisch','Kantonesisch','Chinesisch (gesprochene Variante nicht angegeben)'],
  ms:['Bahasa Mandarin','Bahasa Kantonis','Bahasa Cina (varian pertuturan tidak dinyatakan)'],
  ta:['மாண்டரின் சீனம்','கான்டோனீஸ்','சீனம் (பேச்சு மொழி வகை குறிப்பிடப்படவில்லை)'],
};

export const spokenLanguageMessages=Object.fromEntries(
  (Object.keys(rows) as Locale[]).map(locale=>{
    const [mandarin,cantonese,chineseUnspecified]=rows[locale];
    return [locale,{mandarin,cantonese,chineseUnspecified}];
  }),
) as Record<Locale,SpokenLanguageCopy>;

/** Spoken metadata must not reinterpret a former writing-system choice. */
export function spokenLanguageName(code:string,locale:Locale='en'):string{
  const copy=spokenLanguageMessages[locale]||spokenLanguageMessages.en;
  if(code==='cmn')return copy.mandarin;
  if(code==='yue')return copy.cantonese;
  if(isLegacyChineseLanguage(code))return copy.chineseUnspecified;
  return LANGUAGES.find(language=>language.code===code)?.name||code;
}

/** Keep a legacy value selectable only when it is the current saved/URL value. */
export function spokenLanguageOptions(locale:Locale,currentLanguage?:string):Array<{code:string;label:string}>{
  const options=SPOKEN_LANGUAGES.map(language=>({code:language.code as string,label:spokenLanguageName(language.code,locale)}));
  if(currentLanguage&&isLegacyChineseLanguage(currentLanguage))options.push({code:currentLanguage,label:spokenLanguageName(currentLanguage,locale)});
  return options;
}
