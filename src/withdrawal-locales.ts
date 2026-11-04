import type {Locale} from '../shared/config';

export const withdrawalEnglish={
  payoutBody:"Minimum withdrawal: US${minimum}. No platform withdrawal fee. Requests are processed within {minDays}–{maxDays} days of submission.",
  withdrawalGross:'Deducted from earnings',
  withdrawalFee:'Withdrawal fee',
  withdrawalNet:"Before provider fees",
} as const;
type Copy=Record<keyof typeof withdrawalEnglish,string>;
export const withdrawalMessages:Record<Locale,Copy>={
  en:withdrawalEnglish,
  'zh-TW':{payoutBody:"最低提領金額為 US${minimum}。不收取平台提領手續費，提領申請將於送出後 {minDays}–{maxDays} 天內處理。",withdrawalGross:'從收益扣除',withdrawalFee:'提領手續費',withdrawalNet:"未扣服務商費用的金額"},
  'zh-CN':{payoutBody:"最低提现金额为 US${minimum}。不收取平台提现手续费，提现申请将在提交后 {minDays}–{maxDays} 天内处理。",withdrawalGross:'从收益扣除',withdrawalFee:'提现手续费',withdrawalNet:"未扣服务商费用的金额"},
  ja:{payoutBody:"最低出金額は US${minimum} です。プラットフォームの出金手数料はかかりません。申請は提出後 {minDays}～{maxDays} 日以内に処理されます。",withdrawalGross:'収益からの差引額',withdrawalFee:'出金手数料',withdrawalNet:"事業者手数料差引前"},
  ko:{payoutBody:"최소 출금액은 US${minimum}입니다. 플랫폼 출금 수수료는 없습니다. 신청은 제출 후 {minDays}–{maxDays}일 이내에 처리됩니다.",withdrawalGross:'수익에서 차감되는 금액',withdrawalFee:'출금 수수료',withdrawalNet:"업체 수수료 차감 전"},
  hi:{payoutBody:"न्यूनतम निकासी US${minimum} है। प्लेटफ़ॉर्म निकासी शुल्क नहीं है। अनुरोध जमा करने के {minDays}–{maxDays} दिनों के भीतर संसाधित किए जाते हैं।",withdrawalGross:'कमाई से कटने वाली राशि',withdrawalFee:'निकासी शुल्क',withdrawalNet:"प्रदाता शुल्क से पहले"},
  id:{payoutBody:"Penarikan minimum US${minimum}. Tidak ada biaya penarikan platform. Permintaan diproses dalam {minDays}–{maxDays} hari sejak diajukan.",withdrawalGross:'Dipotong dari pendapatan',withdrawalFee:'Biaya penarikan',withdrawalNet:"Sebelum biaya penyedia"},
  'pt-BR':{payoutBody:"Saque mínimo: US${minimum}. Sem taxa de saque da plataforma. As solicitações são processadas em até {minDays}–{maxDays} dias após o envio.",withdrawalGross:'Descontado dos ganhos',withdrawalFee:'Taxa de saque',withdrawalNet:"Antes das taxas do provedor"},
  es:{payoutBody:"Retiro mínimo: US${minimum}. Sin comisión de retiro de la plataforma. Las solicitudes se procesan en un plazo de {minDays}–{maxDays} días desde su envío.",withdrawalGross:'Descontado de las ganancias',withdrawalFee:'Comisión de retiro',withdrawalNet:"Antes de comisiones del proveedor"},
  ar:{payoutBody:"الحد الأدنى للسحب: US${minimum}. لا توجد رسوم سحب للمنصة. تُعالج الطلبات خلال {minDays}–{maxDays} أيام من تقديمها.",withdrawalGross:'المبلغ المخصوم من الأرباح',withdrawalFee:'رسوم السحب',withdrawalNet:"قبل رسوم المزود"},
  bn:{payoutBody:"ন্যূনতম উত্তোলন US${minimum}। প্ল্যাটফর্ম উত্তোলন ফি নেই। জমা দেওয়ার {minDays}–{maxDays} দিনের মধ্যে অনুরোধ প্রক্রিয়া করা হয়।",withdrawalGross:'আয় থেকে কাটা পরিমাণ',withdrawalFee:'উত্তোলন ফি',withdrawalNet:"প্রদানকারীর ফি কাটার আগে"},
  ur:{payoutBody:"کم از کم نکاسی US${minimum} ہے۔ پلیٹ فارم کی نکاسی فیس نہیں ہے۔ درخواستیں جمع ہونے کے {minDays}–{maxDays} دنوں کے اندر نمٹائی جاتی ہیں۔",withdrawalGross:'آمدنی سے کٹوتی',withdrawalFee:'نکاسی کی فیس',withdrawalNet:"فراہم کنندہ کی فیس سے پہلے"},
  vi:{payoutBody:"Số tiền rút tối thiểu: US${minimum}. Không có phí rút tiền của nền tảng. Yêu cầu được xử lý trong vòng {minDays}–{maxDays} ngày kể từ khi gửi.",withdrawalGross:'Khấu trừ từ thu nhập',withdrawalFee:'Phí rút tiền',withdrawalNet:"Trước phí nhà cung cấp"},
  th:{payoutBody:"ยอดถอนขั้นต่ำ US${minimum} ไม่มีค่าธรรมเนียมการถอนของแพลตฟอร์ม คำขอจะได้รับการดำเนินการภายใน {minDays}–{maxDays} วันหลังส่งคำขอ",withdrawalGross:'หักจากรายได้',withdrawalFee:'ค่าธรรมเนียมการถอน',withdrawalNet:"ก่อนหักค่าธรรมเนียมผู้ให้บริการ"},
  fil:{payoutBody:"Minimum na withdrawal: US${minimum}. Walang bayad sa withdrawal ng platform. Pinoproseso ang mga kahilingan sa loob ng {minDays}–{maxDays} araw mula sa pagsusumite.",withdrawalGross:'Ibabawas sa kita',withdrawalFee:'Bayad sa withdrawal',withdrawalNet:"Bago ang bayarin ng provider"},
  tr:{payoutBody:"Minimum para çekme tutarı US${minimum}. Platform para çekme ücreti yoktur. Talepler gönderildikten sonra {minDays}–{maxDays} gün içinde işleme alınır.",withdrawalGross:'Kazançlardan düşülen tutar',withdrawalFee:'Para çekme ücreti',withdrawalNet:"Sağlayıcı ücretlerinden önce"},
  ru:{payoutBody:"Минимальная сумма вывода — US${minimum}. Комиссия платформы за вывод отсутствует. Заявки обрабатываются в течение {minDays}–{maxDays} дней после подачи.",withdrawalGross:'Списание из дохода',withdrawalFee:'Комиссия за вывод',withdrawalNet:"До комиссий провайдера"},
  fr:{payoutBody:"Retrait minimum : US${minimum}. Aucun frais de retrait de la plateforme. Les demandes sont traitées sous {minDays} à {maxDays} jours après leur envoi.",withdrawalGross:'Déduit des revenus',withdrawalFee:'Frais de retrait',withdrawalNet:"Avant frais du prestataire"},
  de:{payoutBody:"Mindestauszahlung: US${minimum}. Keine Auszahlungsgebühr der Plattform. Anträge werden innerhalb von {minDays}–{maxDays} Tagen nach Einreichung bearbeitet.",withdrawalGross:'Von Einnahmen abgezogen',withdrawalFee:'Auszahlungsgebühr',withdrawalNet:"Vor Anbietergebühren"},
  ms:{payoutBody:"Pengeluaran minimum: US${minimum}. Tiada fi pengeluaran platform. Permohonan diproses dalam {minDays}–{maxDays} hari selepas dihantar.",withdrawalGross:'Ditolak daripada pendapatan',withdrawalFee:'Fi pengeluaran',withdrawalNet:"Sebelum fi penyedia"},
  ta:{payoutBody:"குறைந்தபட்ச பணம் எடுப்பு US${minimum}. தளத்தின் பணம் எடுக்கும் கட்டணம் இல்லை. சமர்ப்பித்த பின் {minDays}–{maxDays} நாட்களுக்குள் கோரிக்கைகள் செயலாக்கப்படும்.",withdrawalGross:'வருமானத்திலிருந்து கழிக்கப்படும் தொகை',withdrawalFee:'பணம் எடுக்கும் கட்டணம்',withdrawalNet:"வழங்குநர் கட்டணங்களுக்கு முன்"},
};
