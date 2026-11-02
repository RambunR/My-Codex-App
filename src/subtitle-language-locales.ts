import type {Locale} from '../shared/config';

export const subtitleLanguageEnglish={
  "subtitleLanguages": "Subtitle languages",
  "subtitleLanguagesHint": "Select the subtitle languages already included in your uploaded video. This does not create or translate subtitles.",
  "subtitleLanguagesChoose": "Choose subtitle languages",
  "subtitleLanguagesSelected": "{count} selected",
  "subtitleLanguagesNone": "No subtitle languages selected",
  "subtitleLanguagesClear": "Clear subtitle languages",
  "subtitleDeclaredHint": "Languages declared by the publisher. Subtitles may be part of the video; playback controls depend on the uploaded video."
} as const;
export type SubtitleLanguageKey=keyof typeof subtitleLanguageEnglish;
type SubtitleLanguageCopy=Record<SubtitleLanguageKey,string>;

export const subtitleLanguageMessages:Record<Locale,SubtitleLanguageCopy>={
  "en": {
    "subtitleLanguages": "Subtitle languages",
    "subtitleLanguagesHint": "Select the subtitle languages already included in your uploaded video. This does not create or translate subtitles.",
    "subtitleLanguagesChoose": "Choose subtitle languages",
    "subtitleLanguagesSelected": "{count} selected",
    "subtitleLanguagesNone": "No subtitle languages selected",
    "subtitleLanguagesClear": "Clear subtitle languages",
    "subtitleDeclaredHint": "Languages declared by the publisher. Subtitles may be part of the video; playback controls depend on the uploaded video."
  },
  "zh-TW": {
    "subtitleLanguages": "字幕語言",
    "subtitleLanguagesHint": "選擇已包含在上傳影片中的字幕語言。此選項不會產生或翻譯字幕。",
    "subtitleLanguagesChoose": "選擇字幕語言",
    "subtitleLanguagesSelected": "已選取 {count} 種",
    "subtitleLanguagesNone": "未選取字幕語言",
    "subtitleLanguagesClear": "清除字幕語言",
    "subtitleDeclaredHint": "此語言資訊由發布者提供。字幕可能已包含在影片中，播放控制選項取決於上傳的影片。"
  },
  "zh-CN": {
    "subtitleLanguages": "字幕语言",
    "subtitleLanguagesHint": "选择已包含在上传视频中的字幕语言。此选项不会生成或翻译字幕。",
    "subtitleLanguagesChoose": "选择字幕语言",
    "subtitleLanguagesSelected": "已选择 {count} 种",
    "subtitleLanguagesNone": "未选择字幕语言",
    "subtitleLanguagesClear": "清除字幕语言",
    "subtitleDeclaredHint": "此语言信息由发布者提供。字幕可能已包含在视频中，播放控制选项取决于上传的视频。"
  },
  "ja": {
    "subtitleLanguages": "字幕の言語",
    "subtitleLanguagesHint": "アップロードした動画に含まれている字幕の言語を選択してください。字幕の作成や翻訳は行いません。",
    "subtitleLanguagesChoose": "字幕の言語を選択",
    "subtitleLanguagesSelected": "{count} 言語を選択中",
    "subtitleLanguagesNone": "字幕の言語は未選択です",
    "subtitleLanguagesClear": "字幕の言語選択を解除",
    "subtitleDeclaredHint": "配信者が申告した言語です。字幕は動画に含まれている場合があり、再生時の操作はアップロードされた動画によって異なります。"
  },
  "ko": {
    "subtitleLanguages": "자막 언어",
    "subtitleLanguagesHint": "업로드한 영상에 이미 포함된 자막 언어를 선택하세요. 자막을 생성하거나 번역하지는 않습니다.",
    "subtitleLanguagesChoose": "자막 언어 선택",
    "subtitleLanguagesSelected": "{count}개 선택됨",
    "subtitleLanguagesNone": "선택한 자막 언어가 없습니다",
    "subtitleLanguagesClear": "자막 언어 선택 해제",
    "subtitleDeclaredHint": "게시자가 등록한 언어 정보입니다. 자막은 영상에 포함되어 있을 수 있으며 재생 제어 기능은 업로드한 영상에 따라 달라집니다."
  },
  "hi": {
    "subtitleLanguages": "सबटाइटल की भाषाएँ",
    "subtitleLanguagesHint": "अपलोड किए गए वीडियो में पहले से मौजूद सबटाइटल की भाषाएँ चुनें। इससे सबटाइटल बनाए या अनुवाद नहीं किए जाते।",
    "subtitleLanguagesChoose": "सबटाइटल की भाषाएँ चुनें",
    "subtitleLanguagesSelected": "{count} चुनी गईं",
    "subtitleLanguagesNone": "सबटाइटल की कोई भाषा नहीं चुनी गई",
    "subtitleLanguagesClear": "सबटाइटल की भाषाओं का चयन हटाएँ",
    "subtitleDeclaredHint": "भाषाओं की जानकारी प्रकाशक ने दी है। सबटाइटल वीडियो का हिस्सा हो सकते हैं; प्लेबैक नियंत्रण अपलोड किए गए वीडियो पर निर्भर करते हैं।"
  },
  "id": {
    "subtitleLanguages": "Bahasa subtitle",
    "subtitleLanguagesHint": "Pilih bahasa subtitle yang sudah ada dalam video unggahan Anda. Pilihan ini tidak membuat atau menerjemahkan subtitle.",
    "subtitleLanguagesChoose": "Pilih bahasa subtitle",
    "subtitleLanguagesSelected": "{count} dipilih",
    "subtitleLanguagesNone": "Belum ada bahasa subtitle yang dipilih",
    "subtitleLanguagesClear": "Hapus pilihan bahasa subtitle",
    "subtitleDeclaredHint": "Bahasa yang dinyatakan penerbit. Subtitle mungkin menjadi bagian dari video; kontrol pemutaran bergantung pada video yang diunggah."
  },
  "pt-BR": {
    "subtitleLanguages": "Idiomas das legendas",
    "subtitleLanguagesHint": "Selecione os idiomas das legendas já incluídas no vídeo enviado. Isso não cria nem traduz legendas.",
    "subtitleLanguagesChoose": "Escolher idiomas das legendas",
    "subtitleLanguagesSelected": "{count} selecionados",
    "subtitleLanguagesNone": "Nenhum idioma de legenda selecionado",
    "subtitleLanguagesClear": "Limpar idiomas das legendas",
    "subtitleDeclaredHint": "Idiomas informados pelo publicador. As legendas podem fazer parte do vídeo; os controles de reprodução dependem do vídeo enviado."
  },
  "es": {
    "subtitleLanguages": "Idiomas de los subtítulos",
    "subtitleLanguagesHint": "Selecciona los idiomas de los subtítulos ya incluidos en el vídeo subido. Esto no crea ni traduce subtítulos.",
    "subtitleLanguagesChoose": "Elegir idiomas de subtítulos",
    "subtitleLanguagesSelected": "{count} seleccionados",
    "subtitleLanguagesNone": "No se han seleccionado idiomas de subtítulos",
    "subtitleLanguagesClear": "Borrar selección de idiomas de subtítulos",
    "subtitleDeclaredHint": "Idiomas declarados por el editor. Los subtítulos pueden formar parte del vídeo; los controles de reproducción dependen del vídeo subido."
  },
  "ar": {
    "subtitleLanguages": "لغات الترجمة النصية",
    "subtitleLanguagesHint": "اختر لغات الترجمة النصية الموجودة بالفعل في الفيديو الذي رفعته. لا يؤدي هذا إلى إنشاء الترجمة أو ترجمتها إلى لغة أخرى.",
    "subtitleLanguagesChoose": "اختيار لغات الترجمة النصية",
    "subtitleLanguagesSelected": "تم تحديد {count}",
    "subtitleLanguagesNone": "لم تُحدّد لغات للترجمة النصية",
    "subtitleLanguagesClear": "مسح لغات الترجمة النصية",
    "subtitleDeclaredHint": "اللغات بحسب تصريح الناشر. قد تكون الترجمة جزءًا من الفيديو؛ وتعتمد عناصر التحكم في التشغيل على الفيديو المرفوع."
  },
  "bn": {
    "subtitleLanguages": "সাবটাইটেলের ভাষা",
    "subtitleLanguagesHint": "আপলোড করা ভিডিওতে আগে থেকেই থাকা সাবটাইটেলের ভাষা বেছে নিন। এতে সাবটাইটেল তৈরি বা অনুবাদ হয় না।",
    "subtitleLanguagesChoose": "সাবটাইটেলের ভাষা বেছে নিন",
    "subtitleLanguagesSelected": "{count}টি নির্বাচিত",
    "subtitleLanguagesNone": "সাবটাইটেলের কোনো ভাষা নির্বাচিত হয়নি",
    "subtitleLanguagesClear": "সাবটাইটেলের ভাষার নির্বাচন মুছুন",
    "subtitleDeclaredHint": "প্রকাশকের দেওয়া ভাষার তথ্য। সাবটাইটেল ভিডিওর অংশ হতে পারে; প্লেব্যাকের নিয়ন্ত্রণ আপলোড করা ভিডিওর ওপর নির্ভর করে।"
  },
  "ur": {
    "subtitleLanguages": "سب ٹائٹلز کی زبانیں",
    "subtitleLanguagesHint": "اپ لوڈ کردہ ویڈیو میں پہلے سے موجود سب ٹائٹلز کی زبانیں منتخب کریں۔ اس سے سب ٹائٹلز بنائے یا ترجمہ نہیں کیے جاتے۔",
    "subtitleLanguagesChoose": "سب ٹائٹلز کی زبانیں منتخب کریں",
    "subtitleLanguagesSelected": "{count} منتخب",
    "subtitleLanguagesNone": "سب ٹائٹلز کی کوئی زبان منتخب نہیں",
    "subtitleLanguagesClear": "سب ٹائٹلز کی زبانوں کا انتخاب ختم کریں",
    "subtitleDeclaredHint": "زبانوں کی معلومات ناشر نے دی ہیں۔ سب ٹائٹلز ویڈیو کا حصہ ہو سکتے ہیں؛ پلے بیک کے کنٹرول اپ لوڈ کردہ ویڈیو پر منحصر ہیں۔"
  },
  "vi": {
    "subtitleLanguages": "Ngôn ngữ phụ đề",
    "subtitleLanguagesHint": "Chọn ngôn ngữ phụ đề đã có trong video tải lên. Lựa chọn này không tạo hoặc dịch phụ đề.",
    "subtitleLanguagesChoose": "Chọn ngôn ngữ phụ đề",
    "subtitleLanguagesSelected": "Đã chọn {count}",
    "subtitleLanguagesNone": "Chưa chọn ngôn ngữ phụ đề",
    "subtitleLanguagesClear": "Xóa lựa chọn ngôn ngữ phụ đề",
    "subtitleDeclaredHint": "Ngôn ngữ do nhà phát hành khai báo. Phụ đề có thể là một phần của video; các điều khiển phát phụ thuộc vào video được tải lên."
  },
  "th": {
    "subtitleLanguages": "ภาษาคำบรรยาย",
    "subtitleLanguagesHint": "เลือกภาษาคำบรรยายที่มีอยู่แล้วในวิดีโอที่อัปโหลด การเลือกนี้ไม่ได้สร้างหรือแปลคำบรรยาย",
    "subtitleLanguagesChoose": "เลือกภาษาคำบรรยาย",
    "subtitleLanguagesSelected": "เลือกแล้ว {count} ภาษา",
    "subtitleLanguagesNone": "ยังไม่ได้เลือกภาษาคำบรรยาย",
    "subtitleLanguagesClear": "ล้างการเลือกภาษาคำบรรยาย",
    "subtitleDeclaredHint": "ข้อมูลภาษาระบุโดยผู้เผยแพร่ คำบรรยายอาจเป็นส่วนหนึ่งของวิดีโอ ส่วนการควบคุมการเล่นขึ้นอยู่กับวิดีโอที่อัปโหลด"
  },
  "fil": {
    "subtitleLanguages": "Mga wika ng subtitle",
    "subtitleLanguagesHint": "Piliin ang mga wika ng subtitle na nasa video mo na. Hindi nito ginagawa o isinasalin ang mga subtitle.",
    "subtitleLanguagesChoose": "Pumili ng mga wika ng subtitle",
    "subtitleLanguagesSelected": "{count} ang napili",
    "subtitleLanguagesNone": "Walang napiling wika ng subtitle",
    "subtitleLanguagesClear": "Alisin ang mga napiling wika ng subtitle",
    "subtitleDeclaredHint": "Mga wikang ipinahayag ng publisher. Maaaring bahagi ng video ang mga subtitle; nakadepende sa na-upload na video ang mga kontrol sa pag-play."
  },
  "tr": {
    "subtitleLanguages": "Altyazı dilleri",
    "subtitleLanguagesHint": "Yüklediğiniz videoda zaten bulunan altyazı dillerini seçin. Bu seçim altyazı oluşturmaz veya çevirmez.",
    "subtitleLanguagesChoose": "Altyazı dillerini seçin",
    "subtitleLanguagesSelected": "{count} seçildi",
    "subtitleLanguagesNone": "Altyazı dili seçilmedi",
    "subtitleLanguagesClear": "Altyazı dili seçimini temizle",
    "subtitleDeclaredHint": "Yayıncının bildirdiği dillerdir. Altyazılar videonun bir parçası olabilir; oynatma kontrolleri yüklenen videoya bağlıdır."
  },
  "ru": {
    "subtitleLanguages": "Языки субтитров",
    "subtitleLanguagesHint": "Выберите языки субтитров, уже имеющихся в загруженном видео. Субтитры не создаются и не переводятся автоматически.",
    "subtitleLanguagesChoose": "Выбрать языки субтитров",
    "subtitleLanguagesSelected": "Выбрано: {count}",
    "subtitleLanguagesNone": "Языки субтитров не выбраны",
    "subtitleLanguagesClear": "Очистить выбор языков субтитров",
    "subtitleDeclaredHint": "Языки указаны издателем. Субтитры могут быть частью видео; возможности управления воспроизведением зависят от загруженного видео."
  },
  "fr": {
    "subtitleLanguages": "Langues des sous-titres",
    "subtitleLanguagesHint": "Sélectionnez les langues des sous-titres déjà inclus dans votre vidéo. Cela ne crée ni ne traduit de sous-titres.",
    "subtitleLanguagesChoose": "Choisir les langues des sous-titres",
    "subtitleLanguagesSelected": "{count} sélectionnées",
    "subtitleLanguagesNone": "Aucune langue de sous-titres sélectionnée",
    "subtitleLanguagesClear": "Effacer les langues des sous-titres",
    "subtitleDeclaredHint": "Langues déclarées par l’éditeur. Les sous-titres peuvent faire partie de la vidéo ; les commandes de lecture dépendent de la vidéo envoyée."
  },
  "de": {
    "subtitleLanguages": "Untertitelsprachen",
    "subtitleLanguagesHint": "Wähle die Sprachen der Untertitel, die bereits in deinem hochgeladenen Video enthalten sind. Dadurch werden keine Untertitel erstellt oder übersetzt.",
    "subtitleLanguagesChoose": "Untertitelsprachen auswählen",
    "subtitleLanguagesSelected": "{count} ausgewählt",
    "subtitleLanguagesNone": "Keine Untertitelsprachen ausgewählt",
    "subtitleLanguagesClear": "Auswahl der Untertitelsprachen aufheben",
    "subtitleDeclaredHint": "Vom Publisher angegebene Sprachen. Untertitel können Teil des Videos sein; die Wiedergabesteuerung hängt vom hochgeladenen Video ab."
  },
  "ms": {
    "subtitleLanguages": "Bahasa sari kata",
    "subtitleLanguagesHint": "Pilih bahasa sari kata yang sudah ada dalam video yang dimuat naik. Pilihan ini tidak mencipta atau menterjemah sari kata.",
    "subtitleLanguagesChoose": "Pilih bahasa sari kata",
    "subtitleLanguagesSelected": "{count} dipilih",
    "subtitleLanguagesNone": "Tiada bahasa sari kata dipilih",
    "subtitleLanguagesClear": "Kosongkan pilihan bahasa sari kata",
    "subtitleDeclaredHint": "Bahasa yang dinyatakan oleh penerbit. Sari kata mungkin sebahagian daripada video; kawalan main balik bergantung pada video yang dimuat naik."
  },
  "ta": {
    "subtitleLanguages": "வசன மொழிகள்",
    "subtitleLanguagesHint": "பதிவேற்றிய காணொளியில் ஏற்கெனவே உள்ள வசன மொழிகளைத் தேர்ந்தெடுக்கவும். இதனால் வசனங்கள் உருவாக்கப்படவோ மொழிபெயர்க்கப்படவோ மாட்டாது.",
    "subtitleLanguagesChoose": "வசன மொழிகளைத் தேர்ந்தெடுக்கவும்",
    "subtitleLanguagesSelected": "{count} தேர்ந்தெடுக்கப்பட்டன",
    "subtitleLanguagesNone": "வசன மொழிகள் தேர்ந்தெடுக்கப்படவில்லை",
    "subtitleLanguagesClear": "வசன மொழித் தேர்வை நீக்கு",
    "subtitleDeclaredHint": "வெளியீட்டாளர் குறிப்பிட்ட மொழிகள். வசனங்கள் காணொளியின் பகுதியாக இருக்கலாம்; இயக்கக் கட்டுப்பாடுகள் பதிவேற்றிய காணொளியைச் சார்ந்திருக்கும்."
  }
};
