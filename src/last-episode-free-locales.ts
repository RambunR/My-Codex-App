import type {Locale} from '../shared/config';

export const lastEpisodeFreeEnglish={
  lastEpisodeFreeLabel:'Make the last episode free',
  lastEpisodeFreeInfoLabel:'About making the last episode free',
  lastEpisodeFreeInfoBody:'If your final episode is much shorter than the others, enable this option to offer it free for a better viewing experience. It applies to the last episode in the current order, alongside your free opening episodes; reordering or new uploads may change which episode is last. This choice is manual: episode length never enables it automatically.',
} as const;
type LastEpisodeFreeCopy=Record<keyof typeof lastEpisodeFreeEnglish,string>;

export const lastEpisodeFreeMessages:Record<Locale,LastEpisodeFreeCopy>={
  en:lastEpisodeFreeEnglish,
  'zh-TW':{
    lastEpisodeFreeLabel:'將最後一集設為免費',
    lastEpisodeFreeInfoLabel:'關於將最後一集設為免費',
    lastEpisodeFreeInfoBody:'如果最後一集明顯比其他集數短，可啟用此選項免費提供該集，改善觀眾的觀看體驗。此設定在原有免費開場集數之外，適用於目前排序的最後一集；重新排序或上傳新集數，可能改變哪一集是最後一集。此選項由你自行決定，系統不會按影片時長自動啟用。',
  },
  'zh-CN':{
    lastEpisodeFreeLabel:'将最后一集设为免费',
    lastEpisodeFreeInfoLabel:'关于将最后一集设为免费',
    lastEpisodeFreeInfoBody:'如果最后一集明显比其他集数短，可启用此选项免费提供该集，改善观众的观看体验。此设置在原有免费开场集数之外，适用于当前排序的最后一集；重新排序或上传新集数，可能改变哪一集是最后一集。此选项由你自行决定，系统不会按视频时长自动启用。',
  },
  ja:{
    lastEpisodeFreeLabel:'最後のエピソードを無料にする',
    lastEpisodeFreeInfoLabel:'最後のエピソードの無料設定について',
    lastEpisodeFreeInfoBody:'最後のエピソードが他より大幅に短い場合は、この設定で無料にして視聴体験を改善できます。冒頭の無料エピソードに加え、現在の並び順の最後のエピソードに適用されるため、並べ替えや新規アップロードで対象が変わる場合があります。この設定は手動で選択するもので、動画の長さによって自動的に有効になることはありません。',
  },
  ko:{
    lastEpisodeFreeLabel:'마지막 에피소드를 무료로 제공',
    lastEpisodeFreeInfoLabel:'마지막 에피소드 무료 제공 안내',
    lastEpisodeFreeInfoBody:'마지막 에피소드가 다른 에피소드보다 훨씬 짧다면 이 옵션을 켜서 무료로 제공하고 시청 경험을 개선할 수 있습니다. 기존 무료 첫 에피소드들에 더해 현재 순서의 마지막 에피소드에 적용되므로, 순서를 바꾸거나 새 에피소드를 업로드하면 대상이 달라질 수 있습니다. 직접 선택하는 옵션이며 영상 길이에 따라 자동으로 켜지지 않습니다.',
  },
  hi:{
    lastEpisodeFreeLabel:'आखिरी एपिसोड मुफ़्त करें',
    lastEpisodeFreeInfoLabel:'आखिरी एपिसोड मुफ़्त करने के बारे में',
    lastEpisodeFreeInfoBody:'अगर आपका आखिरी एपिसोड बाकी एपिसोड से बहुत छोटा है, तो बेहतर देखने के अनुभव के लिए उसे मुफ़्त देने का यह विकल्प चालू करें। यह शुरुआती मुफ़्त एपिसोड के अलावा मौजूदा क्रम के आखिरी एपिसोड पर लागू होता है; क्रम बदलने या नए अपलोड से आखिरी एपिसोड बदल सकता है। यह आपका अपना चयन है: एपिसोड की अवधि इसे अपने आप चालू नहीं करती।',
  },
  id:{
    lastEpisodeFreeLabel:'Gratiskan episode terakhir',
    lastEpisodeFreeInfoLabel:'Tentang episode terakhir gratis',
    lastEpisodeFreeInfoBody:'Jika episode terakhir jauh lebih pendek daripada yang lain, aktifkan opsi ini untuk menggratiskannya demi pengalaman menonton yang lebih baik. Opsi ini berlaku untuk episode terakhir dalam urutan saat ini, selain episode awal yang gratis; pengurutan ulang atau unggahan baru dapat mengubah episode mana yang terakhir. Pilihan ini bersifat manual: durasi episode tidak pernah mengaktifkannya secara otomatis.',
  },
  'pt-BR':{
    lastEpisodeFreeLabel:'Deixar o último episódio grátis',
    lastEpisodeFreeInfoLabel:'Sobre deixar o último episódio grátis',
    lastEpisodeFreeInfoBody:'Se o último episódio for muito mais curto que os demais, ative esta opção para oferecê-lo grátis e melhorar a experiência de quem assiste. Ela se aplica ao último episódio na ordem atual, além dos episódios iniciais grátis; mudar a ordem ou enviar novos episódios pode alterar qual é o último. A escolha é manual: a duração do episódio nunca ativa esta opção automaticamente.',
  },
  es:{
    lastEpisodeFreeLabel:'Ofrecer gratis el último episodio',
    lastEpisodeFreeInfoLabel:'Acerca del último episodio gratis',
    lastEpisodeFreeInfoBody:'Si el último episodio es mucho más corto que los demás, activa esta opción para ofrecerlo gratis y mejorar la experiencia del público. Se aplica al último episodio del orden actual, además de los episodios iniciales gratis; cambiar el orden o subir nuevos episodios puede cambiar cuál es el último. La elección es manual: la duración del episodio nunca activa esta opción automáticamente.',
  },
  ar:{
    lastEpisodeFreeLabel:'إتاحة الحلقة الأخيرة مجانًا',
    lastEpisodeFreeInfoLabel:'حول إتاحة الحلقة الأخيرة مجانًا',
    lastEpisodeFreeInfoBody:'إذا كانت الحلقة الأخيرة أقصر بكثير من بقية الحلقات، فعّل هذا الخيار لإتاحتها مجانًا وتحسين تجربة المشاهدة. ينطبق على الحلقة الأخيرة في الترتيب الحالي، إضافة إلى الحلقات الأولى المجانية؛ وقد تتغير الحلقة الأخيرة عند إعادة الترتيب أو رفع حلقات جديدة. تختار تفعيله يدويًا، ولا تُفعّله مدة الحلقة تلقائيًا أبدًا.',
  },
  bn:{
    lastEpisodeFreeLabel:'শেষ পর্ব বিনামূল্যে দিন',
    lastEpisodeFreeInfoLabel:'শেষ পর্ব বিনামূল্যে দেওয়া সম্পর্কে',
    lastEpisodeFreeInfoBody:'আপনার শেষ পর্ব অন্যগুলোর তুলনায় অনেক ছোট হলে, দেখার অভিজ্ঞতা উন্নত করতে সেটি বিনামূল্যে দেওয়ার জন্য এই বিকল্পটি চালু করুন। এটি শুরুর বিনামূল্যের পর্বগুলোর পাশাপাশি বর্তমান ক্রমের শেষ পর্বে প্রযোজ্য; ক্রম বদলালে বা নতুন পর্ব আপলোড করলে শেষ পর্ব বদলাতে পারে। এটি আপনার নিজের নির্বাচন: পর্বের দৈর্ঘ্য অনুযায়ী কখনো স্বয়ংক্রিয়ভাবে চালু হয় না।',
  },
  ur:{
    lastEpisodeFreeLabel:'آخری قسط مفت کریں',
    lastEpisodeFreeInfoLabel:'آخری قسط مفت کرنے کے بارے میں',
    lastEpisodeFreeInfoBody:'اگر آخری قسط باقی اقساط سے بہت مختصر ہے تو دیکھنے کے بہتر تجربے کے لیے اسے مفت فراہم کرنے کا یہ اختیار فعال کریں۔ یہ ابتدائی مفت اقساط کے علاوہ موجودہ ترتیب کی آخری قسط پر لاگو ہوتا ہے؛ ترتیب بدلنے یا نئی اقساط اپ لوڈ کرنے سے آخری قسط بدل سکتی ہے۔ یہ آپ کا دستی انتخاب ہے: قسط کا دورانیہ اسے کبھی خودکار طور پر فعال نہیں کرتا۔',
  },
  vi:{
    lastEpisodeFreeLabel:'Cho xem tập cuối miễn phí',
    lastEpisodeFreeInfoLabel:'Về việc cho xem tập cuối miễn phí',
    lastEpisodeFreeInfoBody:'Nếu tập cuối ngắn hơn nhiều so với các tập khác, hãy bật tùy chọn này để cho xem miễn phí và cải thiện trải nghiệm người xem. Tùy chọn áp dụng cho tập cuối trong thứ tự hiện tại, ngoài các tập đầu miễn phí; đổi thứ tự hoặc tải tập mới lên có thể thay đổi tập nào là tập cuối. Bạn tự chọn bật tùy chọn này: thời lượng tập không bao giờ tự động bật nó.',
  },
  th:{
    lastEpisodeFreeLabel:'เปิดให้ดูตอนสุดท้ายฟรี',
    lastEpisodeFreeInfoLabel:'เกี่ยวกับการเปิดให้ดูตอนสุดท้ายฟรี',
    lastEpisodeFreeInfoBody:'หากตอนสุดท้ายสั้นกว่าตอนอื่นมาก ให้เปิดตัวเลือกนี้เพื่อให้ดูฟรีและปรับปรุงประสบการณ์การรับชม ตัวเลือกนี้ใช้กับตอนสุดท้ายตามลำดับปัจจุบัน นอกเหนือจากตอนต้นที่ให้ดูฟรี โดยการจัดลำดับใหม่หรืออัปโหลดตอนใหม่อาจเปลี่ยนว่าตอนใดเป็นตอนสุดท้าย คุณเป็นผู้เลือกเปิดเอง ความยาวตอนไม่ทำให้ตัวเลือกนี้เปิดโดยอัตโนมัติ',
  },
  fil:{
    lastEpisodeFreeLabel:'Gawing libre ang huling episode',
    lastEpisodeFreeInfoLabel:'Tungkol sa libreng huling episode',
    lastEpisodeFreeInfoBody:'Kung mas maikli nang malaki ang huling episode kaysa sa iba, i-enable ito upang ialok nang libre para sa mas magandang karanasan sa panonood. Nalalapat ito sa huling episode sa kasalukuyang pagkakasunod-sunod, bukod sa mga libreng panimulang episode; maaaring magbago ang huling episode kapag inayos ang pagkakasunod-sunod o nag-upload ng bago. Ikaw ang pipili: hindi ito awtomatikong nae-enable batay sa haba ng episode.',
  },
  tr:{
    lastEpisodeFreeLabel:'Son bölümü ücretsiz yap',
    lastEpisodeFreeInfoLabel:'Son bölümü ücretsiz yapma hakkında',
    lastEpisodeFreeInfoBody:'Son bölüm diğerlerinden çok daha kısaysa daha iyi bir izleme deneyimi için bu seçeneği açarak ücretsiz sunabilirsiniz. Ücretsiz başlangıç bölümlerine ek olarak mevcut sıradaki son bölüme uygulanır; sıralamayı değiştirmek veya yeni bölüm yüklemek son bölümün hangisi olduğunu değiştirebilir. Bu seçim manueldir: bölüm süresi seçeneği hiçbir zaman otomatik olarak açmaz.',
  },
  ru:{
    lastEpisodeFreeLabel:'Сделать последний эпизод бесплатным',
    lastEpisodeFreeInfoLabel:'О бесплатном последнем эпизоде',
    lastEpisodeFreeInfoBody:'Если последний эпизод намного короче остальных, включите эту опцию, чтобы предложить его бесплатно и улучшить впечатления зрителей. Она применяется к последнему эпизоду в текущем порядке дополнительно к бесплатным начальным эпизодам; изменение порядка или загрузка новых эпизодов может изменить, какой из них последний. Вы выбираете вручную: длительность эпизода никогда не включает эту опцию автоматически.',
  },
  fr:{
    lastEpisodeFreeLabel:'Rendre le dernier épisode gratuit',
    lastEpisodeFreeInfoLabel:'À propos du dernier épisode gratuit',
    lastEpisodeFreeInfoBody:'Si le dernier épisode est beaucoup plus court que les autres, activez cette option pour le proposer gratuitement et améliorer l’expérience de visionnage. Elle s’applique au dernier épisode dans l’ordre actuel, en plus des premiers épisodes gratuits ; modifier l’ordre ou ajouter des épisodes peut changer lequel est le dernier. Ce choix est manuel : la durée d’un épisode n’active jamais cette option automatiquement.',
  },
  de:{
    lastEpisodeFreeLabel:'Letzte Episode kostenlos anbieten',
    lastEpisodeFreeInfoLabel:'Informationen zur kostenlosen letzten Episode',
    lastEpisodeFreeInfoBody:'Wenn die letzte Episode viel kürzer als die anderen ist, können Sie sie mit dieser Option kostenlos anbieten, um das Seherlebnis zu verbessern. Sie gilt zusätzlich zu den kostenlosen Anfangsepisoden für die letzte Episode in der aktuellen Reihenfolge; eine neue Reihenfolge oder neue Uploads können ändern, welche Episode die letzte ist. Sie wählen dies manuell: Die Episodendauer aktiviert die Option niemals automatisch.',
  },
  ms:{
    lastEpisodeFreeLabel:'Jadikan episod terakhir percuma',
    lastEpisodeFreeInfoLabel:'Tentang episod terakhir percuma',
    lastEpisodeFreeInfoBody:'Jika episod terakhir jauh lebih pendek daripada yang lain, aktifkan pilihan ini untuk menawarkannya secara percuma demi pengalaman menonton yang lebih baik. Ia terpakai pada episod terakhir dalam susunan semasa, selain episod awal yang percuma; menyusun semula atau memuat naik episod baharu mungkin mengubah episod yang terakhir. Pilihan ini dibuat secara manual: tempoh episod tidak akan mengaktifkannya secara automatik.',
  },
  ta:{
    lastEpisodeFreeLabel:'கடைசி அத்தியாயத்தை இலவசமாக்கு',
    lastEpisodeFreeInfoLabel:'கடைசி அத்தியாயத்தை இலவசமாக்குவது பற்றி',
    lastEpisodeFreeInfoBody:'கடைசி அத்தியாயம் மற்றவற்றைவிட மிகவும் குறுகியதாக இருந்தால், சிறந்த பார்வை அனுபவத்திற்காக அதை இலவசமாக வழங்க இந்த விருப்பத்தை இயக்கவும். தொடக்க இலவச அத்தியாயங்களுடன், தற்போதைய வரிசையில் கடைசியாக உள்ள அத்தியாயத்திற்கும் இது பொருந்தும்; வரிசையை மாற்றுவது அல்லது புதியவற்றைப் பதிவேற்றுவது கடைசி அத்தியாயத்தை மாற்றலாம். நீங்களே இதைத் தேர்ந்தெடுக்க வேண்டும்; அத்தியாயத்தின் நேர அளவு இதைத் தானாக இயக்காது.',
  },
};
