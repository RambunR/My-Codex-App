import type {Locale} from '../shared/config';
import {GENRES,STORY_THEMES,SERIES_FORMATS,type Genre,type StoryTheme,type SeriesFormat} from '../shared/taxonomy';

const metaKeys=[
  'taxonomyStoryThemes','taxonomyAllThemes','taxonomyFormat','taxonomyAllFormats','taxonomyChooseFormat',
  'taxonomyThemesHint','taxonomyFormatHint','taxonomyThemesInvalid','taxonomyFormatInvalid','taxonomyGenresHint',
  'taxonomyProductionMethod','human','taxonomyRemove',
] as const;
export type TaxonomyKey=`genre_${Genre}`|`theme_${StoryTheme}`|`format_${SeriesFormat}`|typeof metaKeys[number];
export type TaxonomyCopy=Record<TaxonomyKey,string>;
type TaxonomyRow={genres:string;themes:string;formats:string;meta:string};

// Each row follows the stable shared identifiers. Splitting keeps each locale's
// complete copy together; validation rejects missing labels instead of falling back.
const rows:Record<Locale,TaxonomyRow>={
  "en": {
    "genres": "Romance|Romantic Comedy|Drama|Comedy|Action|Adventure|Thriller|Mystery & Suspense|Crime|Horror|Science Fiction|Fantasy|Supernatural|Historical & Period|Family Drama|Detective & Investigation|Psychological Drama|School & Youth|Coming of Age|Workplace Drama|Medical Drama|Legal & Courtroom|War & Military|Martial Arts|Sports|Music & Dance|Slice of Life|Tragedy|Superhero|Animation",
    "themes": "Billionaire & CEO|Contract & Fake Marriage|Enemies to Lovers|Forbidden Romance|Second-Chance Love|Secret Baby|Hidden Identity & Double Life|Revenge|Betrayal & Dark Secrets|Strong Heroine|Against All Odds / Rags to Riches|Historical & Period Romance|Time Travel & Rebirth|Werewolf & Shifter Romance|Mafia",
    "formats": "Live-action|Animation|Anime / Donghua|Motion Comics",
    "meta": "Story themes|All story themes|Format|All formats|Choose format|Optional. Choose up to 5 story themes.|Choose how the series looks. Its format is separate from how it was produced.|Choose up to 5 valid story themes without duplicates.|Choose a valid format.|Choose 1 to 3 genres.|Production method|Human-created|Remove"
  },
  "zh-TW": {
    "genres": "愛情|浪漫喜劇|劇情|喜劇|動作|冒險|驚悚|懸疑與推理|犯罪|恐怖|科幻|奇幻|超自然|古裝與年代劇|家庭劇|偵探與調查|心理劇|校園與青春|成長故事|職場劇|醫療劇|法律與法庭劇|戰爭與軍事|武俠與格鬥|體育|音樂與舞蹈|日常生活|悲劇|超級英雄|動畫",
    "themes": "富豪與總裁|契約與假結婚|死對頭變戀人|禁忌之戀|破鏡重圓|隱藏的孩子|隱藏身分與雙重人生|復仇|背叛與黑暗祕密|強大女主|逆襲與白手起家|古裝與年代愛情|穿越與重生|狼人與變身者之戀|黑幫故事",
    "formats": "真人演出|動畫|日本動畫／中國動畫|動態漫畫",
    "meta": "故事主題|所有故事主題|影片形式|所有形式|選擇影片形式|選填，最多選擇 5 個故事主題。|選擇劇集的視覺形式，製作方式需另外選擇。|請選擇最多 5 個有效且不重複的故事主題。|請選擇有效的影片形式。|請選擇 1 至 3 個類型。|製作方式|人工創作|移除"
  },
  "zh-CN": {
    "genres": "爱情|浪漫喜剧|剧情|喜剧|动作|冒险|惊悚|悬疑与推理|犯罪|恐怖|科幻|奇幻|超自然|古装与年代剧|家庭剧|侦探与调查|心理剧|校园与青春|成长故事|职场剧|医疗剧|法律与法庭剧|战争与军事|武侠与格斗|体育|音乐与舞蹈|日常生活|悲剧|超级英雄|动画",
    "themes": "富豪与总裁|契约与假结婚|死对头变恋人|禁忌之恋|破镜重圆|隐藏的孩子|隐藏身份与双重人生|复仇|背叛与黑暗秘密|强大女主|逆袭与白手起家|古装与年代爱情|穿越与重生|狼人与变身者之恋|黑帮故事",
    "formats": "真人演出|动画|日本动画／中国动画|动态漫画",
    "meta": "故事主题|所有故事主题|影片形式|所有形式|选择影片形式|选填，最多选择 5 个故事主题。|选择剧集的视觉形式，制作方式需另外选择。|请选择最多 5 个有效且不重复的故事主题。|请选择有效的影片形式。|请选择 1 至 3 个类型。|制作方式|人工创作|移除"
  },
  "ja": {
    "genres": "恋愛|ラブコメ|ドラマ|コメディ|アクション|冒険|スリラー|ミステリー・サスペンス|犯罪|ホラー|SF|ファンタジー|超常現象|歴史・時代劇|家族ドラマ|探偵・捜査|心理ドラマ|学園・青春|成長物語|お仕事ドラマ|医療ドラマ|法廷・法律ドラマ|戦争・軍事|武術・格闘|スポーツ|音楽・ダンス|日常|悲劇|スーパーヒーロー|アニメーション",
    "themes": "億万長者・CEO|契約結婚・偽装結婚|敵同士から恋人へ|禁断の恋|やり直す恋|秘密の子ども|隠された正体・二重生活|復讐|裏切り・闇の秘密|強いヒロイン|逆境からの成功|歴史・時代ロマンス|タイムトラベル・転生|人狼・変身者の恋|マフィア",
    "formats": "実写|アニメーション|日本アニメ・中国アニメ|モーションコミック",
    "meta": "物語のテーマ|すべてのテーマ|映像形式|すべての形式|映像形式を選択|任意。テーマは5つまで選べます。|作品の映像形式を選びます。制作方法とは別の項目です。|有効なテーマを重複なしで5つまで選んでください。|有効な映像形式を選んでください。|ジャンルを1〜3つ選んでください。|制作方法|人による制作|削除"
  },
  "ko": {
    "genres": "로맨스|로맨틱 코미디|드라마|코미디|액션|모험|스릴러|미스터리·서스펜스|범죄|공포|공상 과학|판타지|초자연|역사·시대극|가족 드라마|탐정·수사|심리 드라마|학원·청춘|성장물|직장 드라마|의학 드라마|법률·법정|전쟁·군사|무술·격투|스포츠|음악·댄스|일상|비극|슈퍼히어로|애니메이션",
    "themes": "재벌·CEO|계약·위장 결혼|원수에서 연인으로|금지된 사랑|다시 시작하는 사랑|숨겨진 아이|숨겨진 정체·이중생활|복수|배신·어두운 비밀|강인한 여주인공|역경을 이겨낸 성공|역사·시대 로맨스|시간 여행·환생|늑대인간·변신족 로맨스|마피아",
    "formats": "실사|애니메이션|일본·중국 애니메이션|모션 코믹",
    "meta": "이야기 주제|모든 이야기 주제|영상 형식|모든 형식|영상 형식 선택|선택 사항입니다. 이야기 주제를 최대 5개 선택하세요.|시리즈의 영상 형식을 선택하세요. 제작 방식과는 별도입니다.|유효한 이야기 주제를 중복 없이 최대 5개 선택하세요.|유효한 영상 형식을 선택하세요.|장르를 1~3개 선택하세요.|제작 방식|사람이 제작|삭제"
  },
  "hi": {
    "genres": "रोमांस|रोमांटिक कॉमेडी|ड्रामा|कॉमेडी|एक्शन|रोमांचक सफ़र|थ्रिलर|रहस्य और रोमांच|अपराध|हॉरर|विज्ञान कथा|फ़ैंटेसी|अलौकिक|ऐतिहासिक और कालखंड आधारित|पारिवारिक ड्रामा|जासूसी और जाँच|मनोवैज्ञानिक ड्रामा|स्कूल और युवा|वयस्क होने का सफ़र|कार्यस्थल का ड्रामा|चिकित्सा ड्रामा|कानून और अदालत|युद्ध और सेना|मार्शल आर्ट्स|खेल|संगीत और नृत्य|रोज़मर्रा की ज़िंदगी|त्रासदी|सुपरहीरो|एनिमेशन",
    "themes": "अरबपति और सीईओ|अनुबंध और दिखावे की शादी|दुश्मनी से प्यार तक|वर्जित प्रेम|प्यार का दूसरा मौका|छिपी संतान|छिपी पहचान और दोहरी ज़िंदगी|बदला|विश्वासघात और गहरे राज़|सशक्त नायिका|हर मुश्किल के पार / गरीबी से अमीरी तक|ऐतिहासिक प्रेम|समय यात्रा और पुनर्जन्म|वेयरवुल्फ़ और रूप बदलने वालों का प्रेम|माफ़िया",
    "formats": "लाइव ऐक्शन|एनिमेशन|एनीमे / दोंगहुआ|मोशन कॉमिक्स",
    "meta": "कहानी के विषय|कहानी के सभी विषय|प्रस्तुति का प्रकार|प्रस्तुति के सभी प्रकार|प्रस्तुति का प्रकार चुनें|वैकल्पिक। कहानी के अधिकतम 5 विषय चुनें।|चुनें कि सीरीज़ किस दृश्य रूप में दिखाई देती है। यह उसे बनाने की विधि से अलग है।|बिना दोहराव के कहानी के अधिकतम 5 मान्य विषय चुनें।|प्रस्तुति का मान्य प्रकार चुनें।|1 से 3 शैलियाँ चुनें।|निर्माण की विधि|मानव-निर्मित|हटाएँ"
  },
  "id": {
    "genres": "Romansa|Komedi Romantis|Drama|Komedi|Aksi|Petualangan|Thriller|Misteri & Ketegangan|Kriminal|Horor|Fiksi Ilmiah|Fantasi|Supernatural|Sejarah & Drama Zaman|Drama Keluarga|Detektif & Penyelidikan|Drama Psikologis|Sekolah & Remaja|Pendewasaan|Drama Dunia Kerja|Drama Medis|Hukum & Pengadilan|Perang & Militer|Seni Bela Diri|Olahraga|Musik & Tari|Kehidupan Sehari-hari|Tragedi|Pahlawan Super|Animasi",
    "themes": "Miliarder & CEO|Pernikahan Kontrak & Palsu|Dari Musuh Menjadi Kekasih|Cinta Terlarang|Kesempatan Kedua dalam Cinta|Anak Rahasia|Identitas Tersembunyi & Kehidupan Ganda|Balas Dendam|Pengkhianatan & Rahasia Kelam|Tokoh Perempuan Tangguh|Melawan Rintangan / Dari Miskin Menjadi Kaya|Romansa Sejarah & Zaman|Perjalanan Waktu & Kelahiran Kembali|Romansa Manusia Serigala & Pengubah Wujud|Mafia",
    "formats": "Live-action|Animasi|Anime / Donghua|Komik Bergerak",
    "meta": "Tema Cerita|Semua tema cerita|Format|Semua format|Pilih format|Opsional. Pilih hingga 5 tema cerita.|Pilih bentuk visual serial. Format terpisah dari cara pembuatannya.|Pilih hingga 5 tema cerita yang valid tanpa duplikat.|Pilih format yang valid.|Pilih 1 hingga 3 genre.|Metode Produksi|Karya manusia|Hapus"
  },
  "pt-BR": {
    "genres": "Romance|Comédia Romântica|Drama|Comédia|Ação|Aventura|Thriller|Mistério e Suspense|Crime|Terror|Ficção Científica|Fantasia|Sobrenatural|Histórico e de Época|Drama Familiar|Detetives e Investigação|Drama Psicológico|Escola e Juventude|Amadurecimento|Drama Profissional|Drama Médico|Direito e Tribunais|Guerra e Militar|Artes Marciais|Esportes|Música e Dança|Cotidiano|Tragédia|Super-heróis|Animação",
    "themes": "Bilionário e CEO|Casamento por Contrato e de Fachada|De Inimigos a Amantes|Romance Proibido|Segunda Chance no Amor|Filho Secreto|Identidade Oculta e Vida Dupla|Vingança|Traição e Segredos Sombrios|Protagonista Forte|Superação / Da Pobreza à Riqueza|Romance Histórico e de Época|Viagem no Tempo e Renascimento|Romance com Lobisomens e Metamorfos|Máfia",
    "formats": "Live-action|Animação|Anime / Donghua|Quadrinhos Animados",
    "meta": "Temas da história|Todos os temas|Formato|Todos os formatos|Escolher formato|Opcional. Escolha até 5 temas.|Escolha o formato visual da série. Ele é separado do método de produção.|Escolha até 5 temas válidos sem repetições.|Escolha um formato válido.|Escolha de 1 a 3 gêneros.|Método de produção|Criado por pessoas|Remover"
  },
  "es": {
    "genres": "Romance|Comedia Romántica|Drama|Comedia|Acción|Aventura|Thriller|Misterio y Suspenso|Crimen|Terror|Ciencia Ficción|Fantasía|Sobrenatural|Histórico y de Época|Drama Familiar|Detectives e Investigación|Drama Psicológico|Escuela y Juventud|Paso a la Edad Adulta|Drama Laboral|Drama Médico|Drama Legal y Judicial|Guerra y Militar|Artes Marciales|Deportes|Música y Baile|Vida Cotidiana|Tragedia|Superhéroes|Animación",
    "themes": "Multimillonario y CEO|Matrimonio por Contrato y Fingido|De Enemigos a Amantes|Romance Prohibido|Segunda Oportunidad en el Amor|Hijo Secreto|Identidad Oculta y Doble Vida|Venganza|Traición y Secretos Oscuros|Protagonista Fuerte|Superación / De la Pobreza a la Riqueza|Romance Histórico y de Época|Viajes en el Tiempo y Renacimiento|Romance con Hombres Lobo y Cambiaformas|Mafia",
    "formats": "Acción real|Animación|Anime / Donghua|Cómics Animados",
    "meta": "Temas de la historia|Todos los temas|Formato|Todos los formatos|Elegir formato|Opcional. Elige hasta 5 temas.|Elige el formato visual de la serie. Es independiente del método de producción.|Elige hasta 5 temas válidos sin repetir.|Elige un formato válido.|Elige entre 1 y 3 géneros.|Método de producción|Creado por personas|Eliminar"
  },
  "ar": {
    "genres": "رومانسية|كوميديا رومانسية|دراما|كوميديا|أكشن|مغامرات|إثارة|غموض وتشويق|جريمة|رعب|خيال علمي|فانتازيا|خوارق|تاريخي وحقب زمنية|دراما عائلية|تحرٍّ وتحقيق|دراما نفسية|مدرسة وشباب|النضوج واكتشاف الذات|دراما العمل|دراما طبية|قانون ومحاكم|حرب وعسكرية|فنون قتالية|رياضة|موسيقى ورقص|حياة يومية|مأساة|أبطال خارقون|رسوم متحركة",
    "themes": "ملياردير ورئيس تنفيذي|زواج بعقد وزواج صوري|من العداوة إلى الحب|حب ممنوع|فرصة ثانية للحب|طفل سرّي|هوية مخفية وحياة مزدوجة|انتقام|خيانة وأسرار مظلمة|بطلة قوية|تحدي الصعاب / من الفقر إلى الثراء|رومانسية تاريخية|سفر عبر الزمن وولادة جديدة|رومانسية المستذئبين ومغيّري الأشكال|مافيا",
    "formats": "تمثيل حي|رسوم متحركة|أنمي / دونغوا|قصص مصورة متحركة",
    "meta": "موضوعات القصة|جميع موضوعات القصة|أسلوب العرض|جميع أساليب العرض|اختر أسلوب العرض|اختياري. اختر حتى 5 موضوعات للقصة.|اختر أسلوب عرض المسلسل. أسلوب العرض مستقل عن طريقة إنتاجه.|اختر حتى 5 موضوعات صحيحة للقصة دون تكرار.|اختر أسلوب عرض صحيحًا.|اختر من نوع واحد إلى 3 أنواع.|طريقة الإنتاج|من إبداع البشر|إزالة"
  },
  "bn": {
    "genres": "রোমান্স|রোমান্টিক কমেডি|ড্রামা|কমেডি|অ্যাকশন|অ্যাডভেঞ্চার|থ্রিলার|রহস্য ও উৎকণ্ঠা|অপরাধ|ভৌতিক|কল্পবিজ্ঞান|ফ্যান্টাসি|অতিপ্রাকৃত|ঐতিহাসিক ও যুগভিত্তিক|পারিবারিক ড্রামা|গোয়েন্দা ও তদন্ত|মনস্তাত্ত্বিক ড্রামা|স্কুল ও তরুণদের গল্প|বড় হয়ে ওঠার গল্প|কর্মক্ষেত্রের ড্রামা|চিকিৎসাবিষয়ক ড্রামা|আইন ও আদালত|যুদ্ধ ও সামরিক|মার্শাল আর্ট|খেলাধুলা|সংগীত ও নাচ|দৈনন্দিন জীবন|ট্র্যাজেডি|সুপারহিরো|অ্যানিমেশন",
    "themes": "বিলিয়নেয়ার ও সিইও|চুক্তিভিত্তিক ও ভুয়া বিয়ে|শত্রুতা থেকে প্রেম|নিষিদ্ধ প্রেম|প্রেমে দ্বিতীয় সুযোগ|গোপন সন্তান|গোপন পরিচয় ও দ্বৈত জীবন|প্রতিশোধ|বিশ্বাসঘাতকতা ও গোপন রহস্য|শক্তিশালী নায়িকা|প্রতিকূলতা জয় / দারিদ্র্য থেকে ধনসম্পদ|ঐতিহাসিক প্রেম|সময়ভ্রমণ ও পুনর্জন্ম|ওয়্যারউলফ ও রূপবদলকারীর প্রেম|মাফিয়া",
    "formats": "সরাসরি অভিনয়|অ্যানিমেশন|অ্যানিমে / দংহুয়া|মোশন কমিকস",
    "meta": "গল্পের বিষয়|গল্পের সব বিষয়|উপস্থাপনার ধরন|উপস্থাপনার সব ধরন|উপস্থাপনার ধরন বাছুন|ঐচ্ছিক। গল্পের সর্বাধিক 5টি বিষয় বাছুন।|সিরিজটি কোন দৃশ্যরূপে উপস্থাপিত হবে তা বাছুন। এটি তৈরির পদ্ধতি থেকে আলাদা।|পুনরাবৃত্তি ছাড়া গল্পের সর্বাধিক 5টি বৈধ বিষয় বাছুন।|উপস্থাপনার একটি বৈধ ধরন বাছুন।|1 থেকে 3টি ধরন বাছুন।|নির্মাণের পদ্ধতি|মানুষের তৈরি|সরান"
  },
  "ur": {
    "genres": "رومانوی|رومانوی مزاح|ڈراما|مزاح|ایکشن|مہم جوئی|سنسنی خیز|معمہ اور تجسس|جرائم|خوف ناک|سائنسی افسانہ|خیالی دنیا|مافوق الفطرت|تاریخی اور دورِ ماضی|خاندانی ڈراما|جاسوسی اور تفتیش|نفسیاتی ڈراما|اسکول اور نوجوان|بلوغت اور خودشناسی|کام کی جگہ کا ڈراما|طبی ڈراما|قانون اور عدالت|جنگ اور فوج|مارشل آرٹس|کھیل|موسیقی اور رقص|روزمرہ زندگی|المیہ|سپر ہیرو|اینی میشن",
    "themes": "ارب پتی اور سی ای او|معاہدے اور دکھاوے کی شادی|دشمنی سے محبت تک|ممنوع محبت|محبت کا دوسرا موقع|پوشیدہ اولاد|پوشیدہ شناخت اور دوہری زندگی|انتقام|دھوکا اور گہرے راز|مضبوط ہیروئن|مشکلات پر فتح / غربت سے امارت تک|تاریخی محبت|وقت کا سفر اور دوبارہ جنم|ویئر وولف اور روپ بدلنے والوں کی محبت|مافیا",
    "formats": "حقیقی اداکاری|اینی میشن|اینی می / ڈونگ ہوا|متحرک کامکس",
    "meta": "کہانی کے موضوعات|کہانی کے تمام موضوعات|پیشکش کی قسم|پیشکش کی تمام اقسام|پیشکش کی قسم منتخب کریں|اختیاری۔ کہانی کے زیادہ سے زیادہ 5 موضوعات منتخب کریں۔|منتخب کریں کہ سیریز کس بصری انداز میں دکھائی جائے گی۔ یہ اس کی تیاری کے طریقے سے الگ ہے۔|دہرائے بغیر کہانی کے زیادہ سے زیادہ 5 درست موضوعات منتخب کریں۔|پیشکش کی درست قسم منتخب کریں۔|1 سے 3 اصناف منتخب کریں۔|تیاری کا طریقہ|انسانوں کا تخلیق کردہ|ہٹائیں"
  },
  "vi": {
    "genres": "Lãng Mạn|Hài Lãng Mạn|Chính Kịch|Hài|Hành Động|Phiêu Lưu|Giật Gân|Bí Ẩn & Hồi Hộp|Tội Phạm|Kinh Dị|Khoa Học Viễn Tưởng|Kỳ Ảo|Siêu Nhiên|Lịch Sử & Cổ Trang|Phim Gia Đình|Trinh Thám & Điều Tra|Phim Tâm Lý|Học Đường & Tuổi Trẻ|Trưởng Thành|Phim Công Sở|Phim Y Khoa|Pháp Lý & Tòa Án|Chiến Tranh & Quân Sự|Võ Thuật|Thể Thao|Âm Nhạc & Vũ Đạo|Đời Thường|Bi Kịch|Siêu Anh Hùng|Hoạt Hình",
    "themes": "Tỷ Phú & Tổng Tài|Hôn Nhân Hợp Đồng & Giả|Từ Kẻ Thù Thành Người Yêu|Tình Yêu Cấm Kỵ|Cơ Hội Thứ Hai Trong Tình Yêu|Đứa Con Bí Mật|Thân Phận Bí Ẩn & Cuộc Sống Hai Mặt|Trả Thù|Phản Bội & Bí Mật Đen Tối|Nữ Chính Mạnh Mẽ|Vượt Nghịch Cảnh / Từ Nghèo Thành Giàu|Tình Yêu Lịch Sử & Cổ Trang|Du Hành Thời Gian & Tái Sinh|Tình Yêu Người Sói & Người Biến Hình|Mafia",
    "formats": "Người đóng|Hoạt hình|Anime / Donghua|Truyện tranh chuyển động",
    "meta": "Chủ đề câu chuyện|Tất cả chủ đề|Hình thức|Tất cả hình thức|Chọn hình thức|Không bắt buộc. Chọn tối đa 5 chủ đề.|Chọn hình thức hình ảnh của phim. Hình thức tách biệt với phương pháp sản xuất.|Chọn tối đa 5 chủ đề hợp lệ và không trùng lặp.|Chọn hình thức hợp lệ.|Chọn từ 1 đến 3 thể loại.|Phương pháp sản xuất|Do con người sáng tạo|Xóa"
  },
  "th": {
    "genres": "โรแมนติก|โรแมนติกคอมเมดี้|ดราม่า|ตลก|แอ็กชัน|ผจญภัย|ระทึกขวัญ|ปริศนาและลุ้นระทึก|อาชญากรรม|สยองขวัญ|วิทยาศาสตร์|แฟนตาซี|เหนือธรรมชาติ|ประวัติศาสตร์และย้อนยุค|ละครครอบครัว|สืบสวนสอบสวน|ดราม่าจิตวิทยา|โรงเรียนและวัยรุ่น|การเติบโตสู่วัยผู้ใหญ่|ละครชีวิตการทำงาน|ละครการแพทย์|กฎหมายและศาล|สงครามและทหาร|ศิลปะการต่อสู้|กีฬา|ดนตรีและการเต้น|ชีวิตประจำวัน|โศกนาฏกรรม|ซูเปอร์ฮีโร่|แอนิเมชัน",
    "themes": "มหาเศรษฐีและซีอีโอ|แต่งงานตามสัญญาและแต่งงานหลอก|จากศัตรูสู่คนรัก|รักต้องห้าม|โอกาสรักครั้งที่สอง|ลูกที่เป็นความลับ|ตัวตนที่ซ่อนอยู่และชีวิตสองด้าน|แก้แค้น|การทรยศและความลับดำมืด|นางเอกเข้มแข็ง|ฝ่าอุปสรรค / จากยากจนสู่ร่ำรวย|รักประวัติศาสตร์และย้อนยุค|ข้ามเวลาและเกิดใหม่|รักมนุษย์หมาป่าและผู้แปลงร่าง|มาเฟีย",
    "formats": "คนแสดง|แอนิเมชัน|อนิเมะ / ตงฮว่า|การ์ตูนภาพเคลื่อนไหว",
    "meta": "ธีมเรื่อง|ธีมเรื่องทั้งหมด|รูปแบบ|ทุกรูปแบบ|เลือกรูปแบบ|ไม่บังคับ เลือกธีมเรื่องได้สูงสุด 5 ธีม|เลือกรูปแบบภาพของซีรีส์ ซึ่งแยกจากวิธีการผลิต|เลือกธีมเรื่องที่ถูกต้องไม่ซ้ำกันสูงสุด 5 ธีม|เลือกรูปแบบที่ถูกต้อง|เลือกประเภท 1 ถึง 3 ประเภท|วิธีการผลิต|สร้างโดยมนุษย์|นำออก"
  },
  "fil": {
    "genres": "Romansa|Romantikong Komedya|Drama|Komedya|Aksyon|Pakikipagsapalaran|Thriller|Misteryo at Suspense|Krimen|Katakutan|Science Fiction|Pantasya|Supernatural|Makasaysayan at Panahon|Dramang Pampamilya|Detektib at Imbestigasyon|Sikolohikal na Drama|Paaralan at Kabataan|Paglaki at Pagkamulat|Drama sa Trabaho|Dramang Medikal|Batas at Hukuman|Digmaan at Militar|Sining Pandigma|Palakasan|Musika at Sayaw|Pang-araw-araw na Buhay|Trahedya|Superhero|Animasyon",
    "themes": "Bilyonaryo at CEO|Kontrata at Pekeng Kasal|Mula Magkaaway sa Magkasintahan|Ipinagbabawal na Pag-ibig|Ikalawang Pagkakataon sa Pag-ibig|Lihim na Anak|Lihim na Pagkakakilanlan at Dobleng Buhay|Paghihiganti|Pagtataksil at Madidilim na Lihim|Matatag na Pangunahing Babae|Pagtagumpayan ang Hamon / Mula Hirap sa Yaman|Makasaysayang Romansa|Paglalakbay sa Panahon at Muling Pagsilang|Romansa ng Taong Lobo at Nagpapalit-anyo|Mafia",
    "formats": "Live-action|Animasyon|Anime / Donghua|Gumagalaw na Komiks",
    "meta": "Mga tema ng kuwento|Lahat ng tema|Format|Lahat ng format|Pumili ng format|Opsyonal. Pumili ng hanggang 5 tema.|Piliin ang biswal na format ng serye. Hiwalay ito sa paraan ng paggawa.|Pumili ng hanggang 5 wastong tema na walang nauulit.|Pumili ng wastong format.|Pumili ng 1 hanggang 3 genre.|Paraan ng paggawa|Gawa ng tao|Alisin"
  },
  "tr": {
    "genres": "Romantik|Romantik Komedi|Dram|Komedi|Aksiyon|Macera|Gerilim|Gizem ve Gerilim|Suç|Korku|Bilim Kurgu|Fantastik|Doğaüstü|Tarihî ve Dönem|Aile Dramı|Dedektif ve Soruşturma|Psikolojik Dram|Okul ve Gençlik|Büyüme Hikâyesi|İş Hayatı Dramı|Tıbbi Dram|Hukuk ve Mahkeme|Savaş ve Askerî|Dövüş Sanatları|Spor|Müzik ve Dans|Gündelik Yaşam|Trajedi|Süper Kahraman|Animasyon",
    "themes": "Milyarder ve CEO|Sözleşmeli ve Sahte Evlilik|Düşmanlıktan Aşka|Yasak Aşk|Aşkta İkinci Şans|Gizli Çocuk|Gizli Kimlik ve Çifte Hayat|İntikam|İhanet ve Karanlık Sırlar|Güçlü Kadın Başrol|Zorlukları Aşmak / Yoksulluktan Zenginliğe|Tarihî ve Dönem Aşkı|Zaman Yolculuğu ve Yeniden Doğuş|Kurt Adam ve Şekil Değiştiren Aşkı|Mafya",
    "formats": "Canlı çekim|Animasyon|Anime / Donghua|Hareketli Çizgi Roman",
    "meta": "Hikâye temaları|Tüm hikâye temaları|Biçim|Tüm biçimler|Biçim seçin|İsteğe bağlı. En fazla 5 tema seçin.|Dizinin görsel biçimini seçin. Biçim, üretim yönteminden ayrıdır.|Tekrarsız en fazla 5 geçerli tema seçin.|Geçerli bir biçim seçin.|1 ile 3 tür seçin.|Üretim yöntemi|İnsan yapımı|Kaldır"
  },
  "ru": {
    "genres": "Романтика|Романтическая Комедия|Драма|Комедия|Боевик|Приключения|Триллер|Тайны и Саспенс|Криминал|Ужасы|Научная Фантастика|Фэнтези|Сверхъестественное|Историческое и Костюмное|Семейная Драма|Детектив и Расследование|Психологическая Драма|Школа и Молодёжь|Взросление|Рабочие Будни|Медицинская Драма|Право и Суд|Война и Армия|Боевые Искусства|Спорт|Музыка и Танцы|Повседневность|Трагедия|Супергерои|Анимация",
    "themes": "Миллиардер и CEO|Брак по Контракту и Фиктивный Брак|От Врагов к Влюблённым|Запретная Любовь|Второй Шанс в Любви|Тайный Ребёнок|Скрытая Личность и Двойная Жизнь|Месть|Предательство и Мрачные Тайны|Сильная Героиня|Вопреки Всему / Из Бедности в Богатство|Историческая и Костюмная Романтика|Путешествия во Времени и Перерождение|Любовь Оборотней и Метаморфов|Мафия",
    "formats": "С живыми актёрами|Анимация|Аниме / Дунхуа|Анимированные комиксы",
    "meta": "Темы сюжета|Все темы|Формат|Все форматы|Выберите формат|Необязательно. Выберите до 5 тем.|Выберите визуальный формат сериала. Он не зависит от способа производства.|Выберите до 5 допустимых тем без повторений.|Выберите допустимый формат.|Выберите от 1 до 3 жанров.|Способ производства|Создано людьми|Удалить"
  },
  "fr": {
    "genres": "Romance|Comédie Romantique|Drame|Comédie|Action|Aventure|Thriller|Mystère et Suspense|Crime|Horreur|Science-fiction|Fantastique|Surnaturel|Historique et d’Époque|Drame Familial|Détectives et Enquête|Drame Psychologique|École et Jeunesse|Passage à l’Âge Adulte|Drame Professionnel|Drame Médical|Justice et Tribunaux|Guerre et Armée|Arts Martiaux|Sport|Musique et Danse|Tranches de Vie|Tragédie|Super-héros|Animation",
    "themes": "Milliardaire et PDG|Mariage sous Contrat et de Façade|D’Ennemis à Amants|Amour Interdit|Seconde Chance en Amour|Enfant Secret|Identité Cachée et Double Vie|Vengeance|Trahison et Sombres Secrets|Héroïne Forte|Surmonter l’Adversité / De la Misère à la Richesse|Romance Historique et d’Époque|Voyage dans le Temps et Renaissance|Romance de Loups-garous et Métamorphes|Mafia",
    "formats": "Prise de vue réelle|Animation|Anime / Donghua|Bandes Dessinées Animées",
    "meta": "Thèmes de l’histoire|Tous les thèmes|Format|Tous les formats|Choisir un format|Facultatif. Choisissez jusqu’à 5 thèmes.|Choisissez le format visuel de la série. Il est indépendant du mode de production.|Choisissez jusqu’à 5 thèmes valides sans doublons.|Choisissez un format valide.|Choisissez entre 1 et 3 genres.|Mode de production|Créé par des humains|Supprimer"
  },
  "de": {
    "genres": "Romantik|Romantische Komödie|Drama|Komödie|Action|Abenteuer|Thriller|Mystery und Spannung|Krimi|Horror|Science-Fiction|Fantasy|Übernatürliches|Historisch und Kostümfilm|Familiendrama|Detektiv und Ermittlungen|Psychodrama|Schule und Jugend|Erwachsenwerden|Berufsleben|Arztdrama|Justiz und Gericht|Krieg und Militär|Kampfkunst|Sport|Musik und Tanz|Alltagsgeschichten|Tragödie|Superhelden|Animation",
    "themes": "Milliardär und CEO|Vertrags- und Scheinehe|Von Feinden zu Liebenden|Verbotene Liebe|Zweite Chance für die Liebe|Geheimes Kind|Verborgene Identität und Doppelleben|Rache|Verrat und Dunkle Geheimnisse|Starke Heldin|Allen Widrigkeiten zum Trotz / Vom Tellerwäscher zum Millionär|Historische Romanze|Zeitreise und Wiedergeburt|Werwolf- und Gestaltwandler-Romanze|Mafia",
    "formats": "Realfilm|Animation|Anime / Donghua|Animierte Comics",
    "meta": "Handlungsthemen|Alle Handlungsthemen|Format|Alle Formate|Format wählen|Optional. Wähle bis zu 5 Themen.|Wähle das visuelle Format der Serie. Es ist unabhängig von der Produktionsmethode.|Wähle bis zu 5 gültige Themen ohne Wiederholungen.|Wähle ein gültiges Format.|Wähle 1 bis 3 Genres.|Produktionsmethode|Von Menschen erstellt|Entfernen"
  },
  "ms": {
    "genres": "Romantik|Komedi Romantik|Drama|Komedi|Aksi|Pengembaraan|Thriller|Misteri dan Suspen|Jenayah|Seram|Fiksyen Sains|Fantasi|Alam Ghaib|Sejarah dan Zaman|Drama Keluarga|Detektif dan Siasatan|Drama Psikologi|Sekolah dan Remaja|Meniti Dewasa|Drama Tempat Kerja|Drama Perubatan|Undang-undang dan Mahkamah|Perang dan Ketenteraan|Seni Bela Diri|Sukan|Muzik dan Tarian|Kehidupan Harian|Tragedi|Adiwira|Animasi",
    "themes": "Bilionair dan CEO|Perkahwinan Kontrak dan Palsu|Daripada Musuh Menjadi Kekasih|Cinta Terlarang|Peluang Kedua dalam Cinta|Anak Rahsia|Identiti Tersembunyi dan Kehidupan Berganda|Balas Dendam|Pengkhianatan dan Rahsia Gelap|Heroin Kental|Mengatasi Dugaan / Daripada Miskin Menjadi Kaya|Percintaan Sejarah dan Zaman|Perjalanan Masa dan Kelahiran Semula|Percintaan Manusia Serigala dan Penukar Rupa|Mafia",
    "formats": "Aksi langsung|Animasi|Anime / Donghua|Komik Bergerak",
    "meta": "Tema cerita|Semua tema cerita|Format|Semua format|Pilih format|Pilihan. Pilih sehingga 5 tema cerita.|Pilih format visual siri. Format berasingan daripada kaedah penghasilannya.|Pilih sehingga 5 tema cerita yang sah tanpa ulangan.|Pilih format yang sah.|Pilih 1 hingga 3 genre.|Kaedah penghasilan|Karya manusia|Buang"
  },
  "ta": {
    "genres": "காதல்|காதல் நகைச்சுவை|நாடகம்|நகைச்சுவை|அதிரடி|சாகசம்|பரபரப்பு|மர்மம் மற்றும் சஸ்பென்ஸ்|குற்றம்|பயங்கரம்|அறிவியல் புனைவு|கற்பனை|இயற்கைக்கு அப்பாற்பட்டவை|வரலாறு மற்றும் காலகட்டம்|குடும்ப நாடகம்|துப்பறிதல் மற்றும் விசாரணை|உளவியல் நாடகம்|பள்ளி மற்றும் இளைஞர்கள்|வளர்பருவம்|பணியிட நாடகம்|மருத்துவ நாடகம்|சட்டம் மற்றும் நீதிமன்றம்|போர் மற்றும் இராணுவம்|தற்காப்புக் கலைகள்|விளையாட்டு|இசை மற்றும் நடனம்|அன்றாட வாழ்க்கை|துயரக் கதை|சூப்பர்ஹீரோ|அனிமேஷன்",
    "themes": "பில்லியனரும் தலைமைச் செயல் அதிகாரியும்|ஒப்பந்த மற்றும் போலித் திருமணம்|பகையிலிருந்து காதல்|தடைசெய்யப்பட்ட காதல்|காதலுக்கு இரண்டாவது வாய்ப்பு|மறைக்கப்பட்ட குழந்தை|மறைந்த அடையாளமும் இரட்டை வாழ்க்கையும்|பழிவாங்குதல்|துரோகமும் இரகசியங்களும்|வலிமையான நாயகி|தடைகளை மீறி / வறுமையிலிருந்து செல்வத்திற்கு|வரலாற்றுக் காதல்|காலப்பயணமும் மறுபிறவியும்|ஓநாய் மனிதர் மற்றும் உருவம் மாறுபவர்களின் காதல்|மாஃபியா",
    "formats": "நேரடி நடிப்பு|அனிமேஷன்|அனிமே / டோங்குவா|அசையும் காமிக்ஸ்",
    "meta": "கதைக் கருப்பொருள்கள்|அனைத்துக் கதைக் கருப்பொருள்களும்|காட்சி வடிவம்|அனைத்துக் காட்சி வடிவங்களும்|காட்சி வடிவத்தைத் தேர்ந்தெடுக்கவும்|விருப்பத் தேர்வு. அதிகபட்சம் 5 கதைக் கருப்பொருள்களைத் தேர்ந்தெடுக்கவும்.|தொடர் எந்தக் காட்சி வடிவில் தோன்றும் என்பதைத் தேர்ந்தெடுக்கவும். இது தயாரிப்பு முறையிலிருந்து வேறுபட்டது.|மீளாமல் அதிகபட்சம் 5 செல்லுபடியான கதைக் கருப்பொருள்களைத் தேர்ந்தெடுக்கவும்.|செல்லுபடியான காட்சி வடிவத்தைத் தேர்ந்தெடுக்கவும்.|1 முதல் 3 வகைகளைத் தேர்ந்தெடுக்கவும்.|தயாரிப்பு முறை|மனிதர்களால் உருவாக்கப்பட்டது|அகற்றவும்"
  }
};

function dictionary(locale:Locale,entry:TaxonomyRow):TaxonomyCopy{
  const result:Partial<TaxonomyCopy>={};
  const groups:[string,string,readonly string[]][]=[
    ['genre_',entry.genres,GENRES],['theme_',entry.themes,STORY_THEMES],
    ['format_',entry.formats,SERIES_FORMATS],['',entry.meta,metaKeys],
  ];
  for(const[prefix,packed,ids]of groups){
    const labels=packed.split('|');
    if(labels.length!==ids.length||labels.some(label=>!label.trim()))throw new Error(`Incomplete taxonomy translations: ${locale} ${prefix}`);
    ids.forEach((id,index)=>{result[`${prefix}${id}` as TaxonomyKey]=labels[index];});
  }
  return result as TaxonomyCopy;
}
export const taxonomyEnglish=dictionary('en',rows.en);
export const taxonomyMessages=Object.fromEntries(
  (Object.keys(rows) as Locale[]).map(locale=>[locale,dictionary(locale,rows[locale])]),
) as Record<Locale,TaxonomyCopy>;
