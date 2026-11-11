import type {Locale} from '../shared/config';

export const seriesTitleAvailabilityEnglish={
  seriesTitleChecking:'Checking drama title…',
  seriesTitleAvailable:'This drama title is available.',
  seriesTitleDuplicate:'This drama title is already in use. Choose another title.',
  seriesTitleCheckFailed:'Unable to check this title. Please try saving again.',
} as const;
type Messages=Record<keyof typeof seriesTitleAvailabilityEnglish,string>;
export const seriesTitleAvailabilityMessages:Record<Locale,Messages>={
  en:seriesTitleAvailabilityEnglish,
  'zh-TW':{seriesTitleChecking:'正在檢查劇名…',seriesTitleAvailable:'此劇名可供使用。',seriesTitleDuplicate:'此劇名已被使用，請選擇其他名稱。',seriesTitleCheckFailed:'無法檢查此劇名，請再次嘗試儲存。'},
  'zh-CN':{seriesTitleChecking:'正在检查剧名…',seriesTitleAvailable:'此剧名可以使用。',seriesTitleDuplicate:'此剧名已被使用，请选择其他名称。',seriesTitleCheckFailed:'无法检查此剧名，请再次尝试保存。'},
  ja:{seriesTitleChecking:'作品名を確認しています…',seriesTitleAvailable:'この作品名は使用できます。',seriesTitleDuplicate:'この作品名はすでに使用されています。別の名前を選んでください。',seriesTitleCheckFailed:'作品名を確認できませんでした。もう一度保存をお試しください。'},
  ko:{seriesTitleChecking:'작품 제목을 확인하는 중…',seriesTitleAvailable:'사용할 수 있는 작품 제목입니다.',seriesTitleDuplicate:'이미 사용 중인 작품 제목입니다. 다른 제목을 선택해 주세요.',seriesTitleCheckFailed:'제목을 확인할 수 없습니다. 저장을 다시 시도해 주세요.'},
  hi:{seriesTitleChecking:'ड्रामा का शीर्षक जाँचा जा रहा है…',seriesTitleAvailable:'यह ड्रामा शीर्षक उपलब्ध है।',seriesTitleDuplicate:'यह ड्रामा शीर्षक पहले से इस्तेमाल हो रहा है। दूसरा शीर्षक चुनें।',seriesTitleCheckFailed:'इस शीर्षक की जाँच नहीं हो सकी। कृपया फिर से सहेजने का प्रयास करें।'},
  id:{seriesTitleChecking:'Memeriksa judul drama…',seriesTitleAvailable:'Judul drama ini tersedia.',seriesTitleDuplicate:'Judul drama ini sudah digunakan. Pilih judul lain.',seriesTitleCheckFailed:'Judul ini tidak dapat diperiksa. Silakan coba simpan lagi.'},
  'pt-BR':{seriesTitleChecking:'Verificando o título do drama…',seriesTitleAvailable:'Este título está disponível.',seriesTitleDuplicate:'Este título já está em uso. Escolha outro título.',seriesTitleCheckFailed:'Não foi possível verificar este título. Tente salvar novamente.'},
  es:{seriesTitleChecking:'Comprobando el título del drama…',seriesTitleAvailable:'Este título está disponible.',seriesTitleDuplicate:'Este título ya está en uso. Elige otro título.',seriesTitleCheckFailed:'No se pudo comprobar este título. Intenta guardar de nuevo.'},
  ar:{seriesTitleChecking:'جارٍ التحقق من عنوان المسلسل…',seriesTitleAvailable:'عنوان المسلسل هذا متاح.',seriesTitleDuplicate:'عنوان المسلسل هذا مستخدم بالفعل. اختر عنوانًا آخر.',seriesTitleCheckFailed:'تعذر التحقق من هذا العنوان. يرجى محاولة الحفظ مرة أخرى.'},
  bn:{seriesTitleChecking:'ড্রামার শিরোনাম যাচাই করা হচ্ছে…',seriesTitleAvailable:'এই ড্রামার শিরোনামটি ব্যবহার করা যাবে।',seriesTitleDuplicate:'এই ড্রামার শিরোনামটি ইতিমধ্যে ব্যবহৃত হচ্ছে। অন্য শিরোনাম বেছে নিন।',seriesTitleCheckFailed:'এই শিরোনামটি যাচাই করা যায়নি। আবার সংরক্ষণ করার চেষ্টা করুন।'},
  ur:{seriesTitleChecking:'ڈرامے کا عنوان چیک کیا جا رہا ہے…',seriesTitleAvailable:'یہ ڈرامہ عنوان دستیاب ہے۔',seriesTitleDuplicate:'یہ ڈرامہ عنوان پہلے سے استعمال ہو رہا ہے۔ دوسرا عنوان منتخب کریں۔',seriesTitleCheckFailed:'اس عنوان کو چیک نہیں کیا جا سکا۔ براہ کرم دوبارہ محفوظ کرنے کی کوشش کریں۔'},
  vi:{seriesTitleChecking:'Đang kiểm tra tên phim…',seriesTitleAvailable:'Tên phim này có thể sử dụng.',seriesTitleDuplicate:'Tên phim này đã được sử dụng. Vui lòng chọn tên khác.',seriesTitleCheckFailed:'Không thể kiểm tra tên phim này. Vui lòng thử lưu lại.'},
  th:{seriesTitleChecking:'กำลังตรวจสอบชื่อเรื่อง…',seriesTitleAvailable:'สามารถใช้ชื่อเรื่องนี้ได้',seriesTitleDuplicate:'มีผู้ใช้ชื่อเรื่องนี้แล้ว โปรดเลือกชื่ออื่น',seriesTitleCheckFailed:'ไม่สามารถตรวจสอบชื่อเรื่องนี้ได้ โปรดลองบันทึกอีกครั้ง'},
  fil:{seriesTitleChecking:'Sinusuri ang pamagat ng drama…',seriesTitleAvailable:'Maaaring gamitin ang pamagat na ito.',seriesTitleDuplicate:'Ginagamit na ang pamagat na ito. Pumili ng ibang pamagat.',seriesTitleCheckFailed:'Hindi masuri ang pamagat na ito. Pakisubukang i-save muli.'},
  tr:{seriesTitleChecking:'Dizi adı kontrol ediliyor…',seriesTitleAvailable:'Bu dizi adı kullanılabilir.',seriesTitleDuplicate:'Bu dizi adı zaten kullanılıyor. Başka bir ad seçin.',seriesTitleCheckFailed:'Bu ad kontrol edilemedi. Lütfen yeniden kaydetmeyi deneyin.'},
  ru:{seriesTitleChecking:'Проверяем название сериала…',seriesTitleAvailable:'Это название доступно.',seriesTitleDuplicate:'Это название уже используется. Выберите другое название.',seriesTitleCheckFailed:'Не удалось проверить название. Попробуйте сохранить ещё раз.'},
  fr:{seriesTitleChecking:'Vérification du titre de la série…',seriesTitleAvailable:'Ce titre est disponible.',seriesTitleDuplicate:'Ce titre est déjà utilisé. Choisissez un autre titre.',seriesTitleCheckFailed:'Impossible de vérifier ce titre. Réessayez de sauvegarder.'},
  de:{seriesTitleChecking:'Serientitel wird geprüft…',seriesTitleAvailable:'Dieser Serientitel ist verfügbar.',seriesTitleDuplicate:'Dieser Serientitel wird bereits verwendet. Wähle einen anderen Titel.',seriesTitleCheckFailed:'Dieser Titel konnte nicht geprüft werden. Versuche erneut zu speichern.'},
  ms:{seriesTitleChecking:'Menyemak tajuk drama…',seriesTitleAvailable:'Tajuk drama ini tersedia.',seriesTitleDuplicate:'Tajuk drama ini sudah digunakan. Pilih tajuk lain.',seriesTitleCheckFailed:'Tajuk ini tidak dapat disemak. Sila cuba simpan semula.'},
  ta:{seriesTitleChecking:'நாடகத் தலைப்பு சரிபார்க்கப்படுகிறது…',seriesTitleAvailable:'இந்த நாடகத் தலைப்பைப் பயன்படுத்தலாம்.',seriesTitleDuplicate:'இந்த நாடகத் தலைப்பு ஏற்கனவே பயன்பாட்டில் உள்ளது. வேறு தலைப்பைத் தேர்ந்தெடுக்கவும்.',seriesTitleCheckFailed:'இந்தத் தலைப்பைச் சரிபார்க்க முடியவில்லை. மீண்டும் சேமிக்க முயற்சிக்கவும்.'},
};
