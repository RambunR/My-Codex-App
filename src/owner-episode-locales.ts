import type {Locale} from '../shared/config';

export const ownerEpisodeEnglish={
  ownerEpisodeLimits:'Platform owner uploads have no episode duration limit. The {size} MiB file limit still applies.',
  ownerEpisodeUnlimitedDuration:'No episode duration limit',
} as const;
type Messages=Record<keyof typeof ownerEpisodeEnglish,string>;
export const ownerEpisodeMessages:Record<Locale,Messages>={
  en:ownerEpisodeEnglish,
  'zh-TW':{ownerEpisodeLimits:'擁有者管理的上傳不設單集時長上限。每個檔案仍以 {size} MiB 為上限。',ownerEpisodeUnlimitedDuration:'不設單集時長上限'},
  'zh-CN':{ownerEpisodeLimits:'所有者管理的上传不设单集时长上限。每个文件仍以 {size} MiB 为上限。',ownerEpisodeUnlimitedDuration:'不设单集时长上限'},
  ja:{ownerEpisodeLimits:'オーナー管理のアップロードには1話の長さの制限はありません。ファイルサイズの上限は引き続き{size} MiBです。',ownerEpisodeUnlimitedDuration:'1話の長さは無制限'},
  ko:{ownerEpisodeLimits:'소유자가 관리하는 업로드는 에피소드 길이에 제한이 없습니다. 파일 크기 제한 {size} MiB는 계속 적용됩니다.',ownerEpisodeUnlimitedDuration:'에피소드 길이 제한 없음'},
  hi:{ownerEpisodeLimits:'मालिक द्वारा प्रबंधित अपलोड में एपिसोड की अवधि की कोई सीमा नहीं है। फ़ाइल की {size} MiB सीमा लागू रहती है।',ownerEpisodeUnlimitedDuration:'एपिसोड की अवधि की कोई सीमा नहीं'},
  id:{ownerEpisodeLimits:'Unggahan yang dikelola pemilik tidak memiliki batas durasi episode. Batas berkas {size} MiB tetap berlaku.',ownerEpisodeUnlimitedDuration:'Tanpa batas durasi episode'},
  'pt-BR':{ownerEpisodeLimits:'Uploads gerenciados pelo proprietário não têm limite de duração por episódio. O limite de {size} MiB por arquivo continua valendo.',ownerEpisodeUnlimitedDuration:'Sem limite de duração por episódio'},
  es:{ownerEpisodeLimits:'Las subidas gestionadas por el propietario no tienen límite de duración por episodio. Sigue vigente el límite de {size} MiB por archivo.',ownerEpisodeUnlimitedDuration:'Sin límite de duración por episodio'},
  ar:{ownerEpisodeLimits:'لا يوجد حد لمدة الحلقة للتحميلات التي يديرها المالك. يبقى حد حجم الملف {size} MiB ساريًا.',ownerEpisodeUnlimitedDuration:'لا يوجد حد لمدة الحلقة'},
  bn:{ownerEpisodeLimits:'মালিকের পরিচালিত আপলোডে পর্বের দৈর্ঘ্যের কোনো সীমা নেই। ফাইলের {size} MiB সীমা বহাল থাকে।',ownerEpisodeUnlimitedDuration:'পর্বের দৈর্ঘ্যের কোনো সীমা নেই'},
  ur:{ownerEpisodeLimits:'مالک کے زیر انتظام اپ لوڈز میں قسط کے دورانیے کی کوئی حد نہیں۔ فائل کی {size} MiB حد برقرار ہے۔',ownerEpisodeUnlimitedDuration:'قسط کے دورانیے کی کوئی حد نہیں'},
  vi:{ownerEpisodeLimits:'Nội dung tải lên do chủ sở hữu quản lý không giới hạn thời lượng mỗi tập. Giới hạn {size} MiB mỗi tệp vẫn áp dụng.',ownerEpisodeUnlimitedDuration:'Không giới hạn thời lượng mỗi tập'},
  th:{ownerEpisodeLimits:'การอัปโหลดที่เจ้าของจัดการไม่จำกัดความยาวต่อตอน โดยยังจำกัดขนาดไฟล์ไม่เกิน {size} MiB',ownerEpisodeUnlimitedDuration:'ไม่จำกัดความยาวต่อตอน'},
  fil:{ownerEpisodeLimits:'Walang limitasyon sa haba ng episode para sa mga upload na pinamamahalaan ng may-ari. Nananatili ang limitasyong {size} MiB bawat file.',ownerEpisodeUnlimitedDuration:'Walang limitasyon sa haba ng episode'},
  tr:{ownerEpisodeLimits:'Sahibin yönettiği yüklemelerde bölüm süresi sınırı yoktur. Dosya başına {size} MiB sınırı geçerliliğini korur.',ownerEpisodeUnlimitedDuration:'Bölüm süresi sınırı yok'},
  ru:{ownerEpisodeLimits:'Для загрузок под управлением владельца нет ограничения длительности эпизода. Ограничение размера файла {size} MiB сохраняется.',ownerEpisodeUnlimitedDuration:'Без ограничения длительности эпизода'},
  fr:{ownerEpisodeLimits:'Les envois gérés par le propriétaire n’ont pas de limite de durée par épisode. La limite de {size} MiB par fichier reste applicable.',ownerEpisodeUnlimitedDuration:'Sans limite de durée par épisode'},
  de:{ownerEpisodeLimits:'Für vom Inhaber verwaltete Uploads gibt es keine Begrenzung der Folgendauer. Die Dateigrößenbegrenzung von {size} MiB gilt weiterhin.',ownerEpisodeUnlimitedDuration:'Keine Begrenzung der Folgendauer'},
  ms:{ownerEpisodeLimits:'Muat naik yang diurus pemilik tiada had tempoh episod. Had fail {size} MiB masih terpakai.',ownerEpisodeUnlimitedDuration:'Tiada had tempoh episod'},
  ta:{ownerEpisodeLimits:'உரிமையாளர் நிர்வகிக்கும் பதிவேற்றங்களுக்கு அத்தியாய நேர வரம்பு இல்லை. கோப்பின் {size} MiB வரம்பு தொடர்ந்து பொருந்தும்.',ownerEpisodeUnlimitedDuration:'அத்தியாய நேர வரம்பு இல்லை'},
};
