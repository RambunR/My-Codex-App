import type {Locale} from '../shared/config';

export const withdrawalEnglish={
  payoutBody:'Minimum withdrawal: US${minimum}. A US${fee} fee is deducted from each withdrawal from available earnings. Requests are processed within {minDays}–{maxDays} days of submission.',
  withdrawalGross:'Deducted from earnings',
  withdrawalFee:'Withdrawal fee',
  withdrawalNet:'Net withdrawal',
} as const;
type Copy=Record<keyof typeof withdrawalEnglish,string>;
export const withdrawalMessages:Record<Locale,Copy>={
  en:withdrawalEnglish,
  'zh-TW':{payoutBody:'最低提領金額為 US${minimum}。每次從可用收益提領將扣除 US${fee} 手續費，提領申請將於送出後 {minDays}–{maxDays} 天內處理。',withdrawalGross:'從收益扣除',withdrawalFee:'提領手續費',withdrawalNet:'扣除手續費後的提領金額'},
  'zh-CN':{payoutBody:'最低提现金额为 US${minimum}。每次从可用收益提现将扣除 US${fee} 手续费，提现申请将在提交后 {minDays}–{maxDays} 天内处理。',withdrawalGross:'从收益扣除',withdrawalFee:'提现手续费',withdrawalNet:'扣除手续费后的提现金额'},
  ja:{payoutBody:'最低出金額は US${minimum} です。利用可能な収益から出金するたびに US${fee} の手数料が差し引かれます。申請は提出後 {minDays}～{maxDays} 日以内に処理されます。',withdrawalGross:'収益からの差引額',withdrawalFee:'出金手数料',withdrawalNet:'手数料差引後の出金額'},
  ko:{payoutBody:'최소 출금액은 US${minimum}입니다. 사용 가능한 수익에서 출금할 때마다 US${fee}의 수수료가 차감됩니다. 신청은 제출 후 {minDays}–{maxDays}일 이내에 처리됩니다.',withdrawalGross:'수익에서 차감되는 금액',withdrawalFee:'출금 수수료',withdrawalNet:'수수료 차감 후 출금액'},
  hi:{payoutBody:'न्यूनतम निकासी US${minimum} है। उपलब्ध कमाई से हर निकासी पर US${fee} शुल्क काटा जाता है। अनुरोध जमा करने के {minDays}–{maxDays} दिनों के भीतर संसाधित किए जाते हैं।',withdrawalGross:'कमाई से कटने वाली राशि',withdrawalFee:'निकासी शुल्क',withdrawalNet:'शुल्क के बाद निकासी'},
  id:{payoutBody:'Penarikan minimum US${minimum}. Biaya US${fee} dipotong dari setiap penarikan pendapatan tersedia. Permintaan diproses dalam {minDays}–{maxDays} hari sejak diajukan.',withdrawalGross:'Dipotong dari pendapatan',withdrawalFee:'Biaya penarikan',withdrawalNet:'Penarikan setelah biaya'},
  'pt-BR':{payoutBody:'Saque mínimo: US${minimum}. Uma taxa de US${fee} é descontada de cada saque dos ganhos disponíveis. As solicitações são processadas em até {minDays}–{maxDays} dias após o envio.',withdrawalGross:'Descontado dos ganhos',withdrawalFee:'Taxa de saque',withdrawalNet:'Saque líquido'},
  es:{payoutBody:'Retiro mínimo: US${minimum}. Se descuenta una comisión de US${fee} de cada retiro de las ganancias disponibles. Las solicitudes se procesan en un plazo de {minDays}–{maxDays} días desde su envío.',withdrawalGross:'Descontado de las ganancias',withdrawalFee:'Comisión de retiro',withdrawalNet:'Retiro neto'},
  ar:{payoutBody:'الحد الأدنى للسحب: US${minimum}. تُخصم رسوم قدرها US${fee} من كل عملية سحب من الأرباح المتاحة. تُعالج الطلبات خلال {minDays}–{maxDays} أيام من تقديمها.',withdrawalGross:'المبلغ المخصوم من الأرباح',withdrawalFee:'رسوم السحب',withdrawalNet:'صافي السحب'},
  bn:{payoutBody:'ন্যূনতম উত্তোলন US${minimum}। উপলব্ধ আয় থেকে প্রতিবার উত্তোলনে US${fee} ফি কাটা হয়। জমা দেওয়ার {minDays}–{maxDays} দিনের মধ্যে অনুরোধ প্রক্রিয়া করা হয়।',withdrawalGross:'আয় থেকে কাটা পরিমাণ',withdrawalFee:'উত্তোলন ফি',withdrawalNet:'ফি বাদে উত্তোলন'},
  ur:{payoutBody:'کم از کم نکاسی US${minimum} ہے۔ دستیاب آمدنی سے ہر نکاسی پر US${fee} فیس کاٹی جاتی ہے۔ درخواستیں جمع ہونے کے {minDays}–{maxDays} دنوں کے اندر نمٹائی جاتی ہیں۔',withdrawalGross:'آمدنی سے کٹوتی',withdrawalFee:'نکاسی کی فیس',withdrawalNet:'فیس کے بعد نکاسی'},
  vi:{payoutBody:'Số tiền rút tối thiểu: US${minimum}. Phí US${fee} được khấu trừ cho mỗi lần rút từ thu nhập khả dụng. Yêu cầu được xử lý trong vòng {minDays}–{maxDays} ngày kể từ khi gửi.',withdrawalGross:'Khấu trừ từ thu nhập',withdrawalFee:'Phí rút tiền',withdrawalNet:'Số tiền rút sau phí'},
  th:{payoutBody:'ยอดถอนขั้นต่ำ US${minimum} โดยหักค่าธรรมเนียม US${fee} จากการถอนรายได้ที่ใช้ได้แต่ละครั้ง คำขอจะได้รับการดำเนินการภายใน {minDays}–{maxDays} วันหลังส่งคำขอ',withdrawalGross:'หักจากรายได้',withdrawalFee:'ค่าธรรมเนียมการถอน',withdrawalNet:'ยอดถอนหลังหักค่าธรรมเนียม'},
  fil:{payoutBody:'Minimum na withdrawal: US${minimum}. May US${fee} na bayad na ibinabawas sa bawat withdrawal mula sa magagamit na kita. Pinoproseso ang mga kahilingan sa loob ng {minDays}–{maxDays} araw mula sa pagsusumite.',withdrawalGross:'Ibabawas sa kita',withdrawalFee:'Bayad sa withdrawal',withdrawalNet:'Withdrawal matapos ang bayad'},
  tr:{payoutBody:'Minimum para çekme tutarı US${minimum}. Kullanılabilir kazançlardan yapılan her çekimden US${fee} ücret kesilir. Talepler gönderildikten sonra {minDays}–{maxDays} gün içinde işleme alınır.',withdrawalGross:'Kazançlardan düşülen tutar',withdrawalFee:'Para çekme ücreti',withdrawalNet:'Net çekim tutarı'},
  ru:{payoutBody:'Минимальная сумма вывода — US${minimum}. При каждом выводе доступного дохода удерживается комиссия US${fee}. Заявки обрабатываются в течение {minDays}–{maxDays} дней после подачи.',withdrawalGross:'Списание из дохода',withdrawalFee:'Комиссия за вывод',withdrawalNet:'Вывод после комиссии'},
  fr:{payoutBody:'Retrait minimum : US${minimum}. Des frais de US${fee} sont déduits de chaque retrait des revenus disponibles. Les demandes sont traitées sous {minDays} à {maxDays} jours après leur envoi.',withdrawalGross:'Déduit des revenus',withdrawalFee:'Frais de retrait',withdrawalNet:'Retrait net'},
  de:{payoutBody:'Mindestauszahlung: US${minimum}. Bei jeder Auszahlung aus verfügbaren Einnahmen werden US${fee} Gebühren abgezogen. Anträge werden innerhalb von {minDays}–{maxDays} Tagen nach Einreichung bearbeitet.',withdrawalGross:'Von Einnahmen abgezogen',withdrawalFee:'Auszahlungsgebühr',withdrawalNet:'Nettoauszahlung'},
  ms:{payoutBody:'Pengeluaran minimum: US${minimum}. Fi US${fee} ditolak daripada setiap pengeluaran pendapatan tersedia. Permohonan diproses dalam {minDays}–{maxDays} hari selepas dihantar.',withdrawalGross:'Ditolak daripada pendapatan',withdrawalFee:'Fi pengeluaran',withdrawalNet:'Pengeluaran selepas fi'},
  ta:{payoutBody:'குறைந்தபட்ச பணம் எடுப்பு US${minimum}. கிடைக்கும் வருமானத்திலிருந்து ஒவ்வொரு முறை பணம் எடுக்கும்போதும் US${fee} கட்டணம் கழிக்கப்படும். சமர்ப்பித்த பின் {minDays}–{maxDays} நாட்களுக்குள் கோரிக்கைகள் செயலாக்கப்படும்.',withdrawalGross:'வருமானத்திலிருந்து கழிக்கப்படும் தொகை',withdrawalFee:'பணம் எடுக்கும் கட்டணம்',withdrawalNet:'கட்டணத்திற்குப் பின் தொகை'},
};
