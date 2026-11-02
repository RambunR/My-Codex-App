import {LANGUAGES,type Locale} from '../shared/config';

export const adminAccountEnglish={
  "adminAccountRole": "Administrator",
  "adminUploadEnabled": "Uploads enabled",
  "adminUploadIncluded": "Upload access is included with your administrator role.",
  "adminUploadHeld": "Uploads paused",
  "adminOpenContent": "Manage content",
  "adminOpenStudio": "Open Creator Studio",
  "adminUploadDrama": "Upload drama",
  "adminAccessTitle": "Administrator access",
  "adminUploadReviewBody": "Uploads are temporarily paused while your account payment review is resolved."
} as const;
export type AdminAccountKey=keyof typeof adminAccountEnglish;
type AdminAccountCopy=Record<AdminAccountKey,string>;
const rows:Record<Exclude<Locale,'en'>,readonly string[]>={
  "zh-TW": [
    "管理員",
    "已開放上傳",
    "管理員身分已包含上傳權限。",
    "暫停上傳",
    "管理內容",
    "開啟創作者工作室",
    "上傳短劇",
    "管理員權限",
    "帳戶付款審核處理期間，暫停上傳。"
  ],
  "zh-CN": [
    "管理员",
    "已开放上传",
    "管理员身份已包含上传权限。",
    "暂停上传",
    "管理内容",
    "打开创作者工作室",
    "上传短剧",
    "管理员权限",
    "账户付款审核处理期间，暂停上传。"
  ],
  "ja": [
    "管理者",
    "アップロード可能",
    "管理者権限にはアップロード権限が含まれています。",
    "アップロード停止中",
    "コンテンツを管理",
    "クリエイタースタジオを開く",
    "ドラマをアップロード",
    "管理者権限",
    "アカウントのお支払いの確認が完了するまで、アップロードは一時停止されます。"
  ],
  "ko": [
    "관리자",
    "업로드 가능",
    "관리자 권한에는 업로드 권한이 포함됩니다.",
    "업로드 일시 중지",
    "콘텐츠 관리",
    "크리에이터 스튜디오 열기",
    "드라마 업로드",
    "관리자 권한",
    "계정 결제 검토가 해결될 때까지 업로드가 일시 중지됩니다."
  ],
  "hi": [
    "व्यवस्थापक",
    "अपलोड सक्षम",
    "आपकी व्यवस्थापक भूमिका में अपलोड करने की अनुमति शामिल है।",
    "अपलोड रोके गए हैं",
    "सामग्री प्रबंधित करें",
    "क्रिएटर स्टूडियो खोलें",
    "ड्रामा अपलोड करें",
    "व्यवस्थापक पहुँच",
    "आपके खाते के भुगतान की समीक्षा का समाधान होने तक अपलोड अस्थायी रूप से रोके गए हैं।"
  ],
  "id": [
    "Administrator",
    "Upload diaktifkan",
    "Akses upload termasuk dalam peran administrator Anda.",
    "Upload dijeda",
    "Kelola konten",
    "Buka Studio Kreator",
    "Upload drama",
    "Akses administrator",
    "Upload dijeda sementara hingga peninjauan pembayaran akun Anda diselesaikan."
  ],
  "pt-BR": [
    "Administrador",
    "Uploads habilitados",
    "O acesso a uploads está incluído na sua função de administrador.",
    "Uploads pausados",
    "Gerenciar conteúdo",
    "Abrir Estúdio do Criador",
    "Enviar drama",
    "Acesso de administrador",
    "Os uploads estão temporariamente suspensos até a conclusão da análise de pagamentos da sua conta."
  ],
  "es": [
    "Administrador",
    "Subidas habilitadas",
    "Tu rol de administrador incluye permiso para subir contenido.",
    "Subidas pausadas",
    "Gestionar contenido",
    "Abrir estudio de creadores",
    "Subir drama",
    "Acceso de administrador",
    "Las subidas están pausadas temporalmente hasta resolver la revisión de pagos de tu cuenta."
  ],
  "ar": [
    "المسؤول",
    "الرفع مفعّل",
    "تتضمن صلاحيات المسؤول إمكانية رفع المحتوى.",
    "الرفع متوقف مؤقتًا",
    "إدارة المحتوى",
    "فتح استوديو المبدعين",
    "رفع مسلسل",
    "صلاحيات المسؤول",
    "تم إيقاف رفع المحتوى مؤقتًا إلى حين الانتهاء من مراجعة مدفوعات حسابك."
  ],
  "bn": [
    "প্রশাসক",
    "আপলোড চালু",
    "প্রশাসক ভূমিকার সঙ্গে আপলোডের অনুমতি অন্তর্ভুক্ত রয়েছে।",
    "আপলোড স্থগিত",
    "কনটেন্ট পরিচালনা করুন",
    "ক্রিয়েটর স্টুডিও খুলুন",
    "ড্রামা আপলোড করুন",
    "প্রশাসকের প্রবেশাধিকার",
    "আপনার অ্যাকাউন্টের পেমেন্ট পর্যালোচনার নিষ্পত্তি না হওয়া পর্যন্ত আপলোড সাময়িকভাবে স্থগিত রয়েছে।"
  ],
  "ur": [
    "منتظم",
    "اپ لوڈ فعال ہے",
    "آپ کے منتظم کردار میں مواد اپ لوڈ کرنے کی اجازت شامل ہے۔",
    "اپ لوڈ معطل",
    "مواد کا انتظام کریں",
    "تخلیق کار اسٹوڈیو کھولیں",
    "ڈراما اپ لوڈ کریں",
    "منتظم کی رسائی",
    "آپ کے اکاؤنٹ کی ادائیگی کے جائزے کا معاملہ حل ہونے تک اپ لوڈ عارضی طور پر معطل ہیں۔"
  ],
  "vi": [
    "Quản trị viên",
    "Đã bật tải lên",
    "Vai trò quản trị viên của bạn bao gồm quyền tải lên.",
    "Tạm dừng tải lên",
    "Quản lý nội dung",
    "Mở Studio Nhà sáng tạo",
    "Tải phim lên",
    "Quyền quản trị viên",
    "Tính năng tải lên tạm dừng cho đến khi việc xem xét thanh toán của tài khoản được giải quyết."
  ],
  "th": [
    "ผู้ดูแลระบบ",
    "อัปโหลดได้",
    "สิทธิ์ผู้ดูแลระบบของคุณรวมสิทธิ์ในการอัปโหลดด้วย",
    "หยุดอัปโหลดชั่วคราว",
    "จัดการเนื้อหา",
    "เปิดสตูดิโอผู้สร้าง",
    "อัปโหลดละคร",
    "สิทธิ์ผู้ดูแลระบบ",
    "การอัปโหลดถูกระงับชั่วคราวจนกว่าการตรวจสอบการชำระเงินของบัญชีจะเสร็จสิ้น"
  ],
  "fil": [
    "Tagapangasiwa",
    "Naka-enable ang pag-upload",
    "Kasama sa tungkulin mong tagapangasiwa ang pahintulot na mag-upload.",
    "Naka-pause ang pag-upload",
    "Pamahalaan ang nilalaman",
    "Buksan ang Creator Studio",
    "Mag-upload ng drama",
    "Access ng tagapangasiwa",
    "Pansamantalang naka-pause ang pag-upload habang inaayos ang pagsusuri sa mga bayad ng iyong account."
  ],
  "tr": [
    "Yönetici",
    "Yükleme etkin",
    "Yönetici rolünüz içerik yükleme erişimini de içerir.",
    "Yükleme duraklatıldı",
    "İçeriği yönet",
    "İçerik Üretici Stüdyosunu aç",
    "Dizi yükle",
    "Yönetici erişimi",
    "Hesabınızın ödeme incelemesi sonuçlanana kadar yüklemeler geçici olarak duraklatılmıştır."
  ],
  "ru": [
    "Администратор",
    "Загрузка разрешена",
    "Ваша роль администратора включает право загружать контент.",
    "Загрузка приостановлена",
    "Управлять контентом",
    "Открыть студию автора",
    "Загрузить сериал",
    "Доступ администратора",
    "Загрузка временно приостановлена до завершения проверки платежей вашего аккаунта."
  ],
  "fr": [
    "Administrateur",
    "Importation activée",
    "Votre rôle d’administrateur inclut l’autorisation d’importer du contenu.",
    "Importation en pause",
    "Gérer le contenu",
    "Ouvrir le studio de création",
    "Importer une série",
    "Accès administrateur",
    "L’importation est temporairement suspendue jusqu’à la résolution de l’examen des paiements de votre compte."
  ],
  "de": [
    "Administrator",
    "Uploads freigeschaltet",
    "Ihre Administratorrolle umfasst die Berechtigung zum Hochladen.",
    "Uploads pausiert",
    "Inhalte verwalten",
    "Creator Studio öffnen",
    "Serie hochladen",
    "Administratorzugriff",
    "Uploads sind vorübergehend pausiert, bis die Zahlungsprüfung Ihres Kontos abgeschlossen ist."
  ],
  "ms": [
    "Pentadbir",
    "Muat naik dibenarkan",
    "Akses muat naik disertakan dalam peranan pentadbir anda.",
    "Muat naik dijeda",
    "Urus kandungan",
    "Buka Studio Pencipta",
    "Muat naik drama",
    "Akses pentadbir",
    "Muat naik dijeda buat sementara waktu sehingga semakan pembayaran akaun anda diselesaikan."
  ],
  "ta": [
    "நிர்வாகி",
    "பதிவேற்றம் இயங்குகிறது",
    "நிர்வாகி பொறுப்பில் பதிவேற்ற அனுமதியும் அடங்கும்.",
    "பதிவேற்றம் நிறுத்தப்பட்டுள்ளது",
    "உள்ளடக்கத்தை நிர்வகி",
    "படைப்பாளர் ஸ்டுடியோவைத் திற",
    "நாடகத்தைப் பதிவேற்று",
    "நிர்வாகி அணுகல்",
    "உங்கள் கணக்கின் கட்டண ஆய்வு முடியும் வரை பதிவேற்றங்கள் தற்காலிகமாக நிறுத்தப்பட்டுள்ளன."
  ]
};
const keys=Object.keys(adminAccountEnglish) as AdminAccountKey[];
export const adminAccountMessages={} as Record<Locale,AdminAccountCopy>;
for(const {code} of LANGUAGES){
  if(code==='en'){adminAccountMessages[code]={...adminAccountEnglish};continue;}
  const values=rows[code];
  if(values.length!==keys.length||values.some(value=>!value.trim()))throw new Error(`Administrator account translations incomplete: ${code}`);
  adminAccountMessages[code]=Object.fromEntries(keys.map((key,index)=>[key,values[index]])) as AdminAccountCopy;
}
