import type {Locale} from '../shared/config';

export const storageUnlimitedEnglish={
  storageUnlimited:'Unlimited',
  adminUnlimitedStorageBody:'Unlimited total storage for your own uploads. Episode duration and file-size limits still apply.',
} as const;
type StorageUnlimitedCopy=Record<keyof typeof storageUnlimitedEnglish,string>;
export const storageUnlimitedMessages:Record<Locale,StorageUnlimitedCopy>={
  en:storageUnlimitedEnglish,
  'zh-TW':{storageUnlimited:'無上限',adminUnlimitedStorageBody:'你自己上傳的內容享有無上限總儲存空間。每集時長及檔案大小限制仍然適用。'},
  'zh-CN':{storageUnlimited:'无限制',adminUnlimitedStorageBody:'你自己上传的内容享有无限总存储空间。每集时长及文件大小限制仍然适用。'},
  ja:{storageUnlimited:'無制限',adminUnlimitedStorageBody:'自分のアップロードの合計ストレージは無制限です。各エピソードの長さとファイルサイズの制限は引き続き適用されます。'},
  ko:{storageUnlimited:'무제한',adminUnlimitedStorageBody:'직접 업로드한 콘텐츠의 총 저장 공간은 무제한입니다. 에피소드 길이와 파일 크기 제한은 계속 적용됩니다.'},
  hi:{storageUnlimited:'असीमित',adminUnlimitedStorageBody:'आपके अपने अपलोड के लिए कुल स्टोरेज असीमित है। एपिसोड की अवधि और फ़ाइल आकार की सीमाएँ लागू रहती हैं।'},
  id:{storageUnlimited:'Tanpa batas',adminUnlimitedStorageBody:'Total penyimpanan untuk unggahan Anda sendiri tanpa batas. Batas durasi episode dan ukuran file tetap berlaku.'},
  'pt-BR':{storageUnlimited:'Ilimitado',adminUnlimitedStorageBody:'Armazenamento total ilimitado para seus próprios envios. Os limites de duração dos episódios e tamanho dos arquivos continuam valendo.'},
  es:{storageUnlimited:'Ilimitado',adminUnlimitedStorageBody:'Almacenamiento total ilimitado para tus propias subidas. Siguen vigentes los límites de duración de los episodios y tamaño de los archivos.'},
  ar:{storageUnlimited:'غير محدود',adminUnlimitedStorageBody:'مساحة تخزين إجمالية غير محدودة لملفاتك المرفوعة. تظل حدود مدة الحلقة وحجم الملف سارية.'},
  bn:{storageUnlimited:'সীমাহীন',adminUnlimitedStorageBody:'আপনার নিজের আপলোডের জন্য মোট স্টোরেজ সীমাহীন। পর্বের দৈর্ঘ্য ও ফাইলের আকারের সীমা বহাল থাকবে।'},
  ur:{storageUnlimited:'لامحدود',adminUnlimitedStorageBody:'آپ کے اپنے اپ لوڈز کے لیے کل اسٹوریج لامحدود ہے۔ قسط کے دورانیے اور فائل کے سائز کی حدیں برقرار ہیں۔'},
  vi:{storageUnlimited:'Không giới hạn',adminUnlimitedStorageBody:'Tổng dung lượng lưu trữ không giới hạn cho nội dung bạn tự tải lên. Giới hạn thời lượng tập và kích thước tệp vẫn áp dụng.'},
  th:{storageUnlimited:'ไม่จำกัด',adminUnlimitedStorageBody:'พื้นที่จัดเก็บรวมไม่จำกัดสำหรับเนื้อหาที่คุณอัปโหลดเอง ยังคงจำกัดความยาวตอนและขนาดไฟล์'},
  fil:{storageUnlimited:'Walang limitasyon',adminUnlimitedStorageBody:'Walang limitasyon ang kabuuang storage para sa sarili mong mga upload. Nananatili ang mga limitasyon sa haba ng episode at laki ng file.'},
  tr:{storageUnlimited:'Sınırsız',adminUnlimitedStorageBody:'Kendi yüklemeleriniz için toplam depolama alanı sınırsızdır. Bölüm süresi ve dosya boyutu sınırları geçerliliğini korur.'},
  ru:{storageUnlimited:'Без ограничений',adminUnlimitedStorageBody:'Общий объём хранилища для ваших собственных загрузок не ограничен. Ограничения длительности серий и размера файлов сохраняются.'},
  fr:{storageUnlimited:'Illimité',adminUnlimitedStorageBody:'Stockage total illimité pour vos propres importations. Les limites de durée des épisodes et de taille des fichiers restent applicables.'},
  de:{storageUnlimited:'Unbegrenzt',adminUnlimitedStorageBody:'Unbegrenzter Gesamtspeicher für Ihre eigenen Uploads. Die Begrenzungen für Episodendauer und Dateigröße gelten weiterhin.'},
  ms:{storageUnlimited:'Tanpa had',adminUnlimitedStorageBody:'Jumlah storan tanpa had untuk muat naik anda sendiri. Had tempoh episod dan saiz fail masih terpakai.'},
  ta:{storageUnlimited:'வரம்பற்றது',adminUnlimitedStorageBody:'உங்கள் சொந்தப் பதிவேற்றங்களுக்கான மொத்தச் சேமிப்பிடம் வரம்பற்றது. அத்தியாயத்தின் நேர அளவு மற்றும் கோப்பின் அளவிற்கான வரம்புகள் தொடர்ந்து பொருந்தும்.'},
};
