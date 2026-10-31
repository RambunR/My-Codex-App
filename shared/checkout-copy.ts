import type {Locale} from './config';

type CheckoutCopy={description:string;submit:string;afterSubmit:string};

// Wallet top-ups only. The USD amount is inserted without local-currency
// conversion; none of this copy changes the server-controlled Checkout price.
const messages:Record<Locale,CheckoutCopy>={
  en:{
    description:'Receive {amount} in LingYing wallet credit to unlock paid drama episodes.',
    submit:'One-time top-up. No subscription. Your wallet will be credited after payment is confirmed.',
    afterSubmit:'Need help? Contact contactus@hknovaxrproduction.com',
  },
  'zh-TW':{
    description:'儲值 {amount} 至 LingYing 錢包，用於解鎖付費短劇集數。',
    submit:'一次性儲值，並非訂閱。付款確認後，金額將存入你的錢包。',
    afterSubmit:'需要協助？請聯絡 contactus@hknovaxrproduction.com',
  },
  'zh-CN':{
    description:'充值 {amount} 至 LingYing 钱包，用于解锁付费短剧剧集。',
    submit:'一次性充值，无需订阅。付款确认后，金额将存入你的钱包。',
    afterSubmit:'需要帮助？请联系 contactus@hknovaxrproduction.com',
  },
  ja:{
    description:'有料のショートドラマのエピソードを視聴するために、LingYing ウォレットへ {amount} をチャージします。',
    submit:'1 回限りのチャージです。サブスクリプションではありません。お支払いの確認後、ウォレットに残高が反映されます。',
    afterSubmit:'お困りの場合は contactus@hknovaxrproduction.com までお問い合わせください。',
  },
  ko:{
    description:'유료 숏드라마 에피소드를 잠금 해제할 수 있도록 LingYing 지갑에 {amount} 크레딧을 충전합니다.',
    submit:'일회성 충전이며 구독이 아닙니다. 결제가 확인되면 지갑에 크레딧이 충전됩니다.',
    afterSubmit:'도움이 필요하신가요? contactus@hknovaxrproduction.com로 문의해 주세요.',
  },
  hi:{
    description:'सशुल्क शॉर्ट ड्रामा एपिसोड अनलॉक करने के लिए LingYing वॉलेट में {amount} का क्रेडिट पाएँ।',
    submit:'एक बार का टॉप-अप। कोई सदस्यता नहीं। भुगतान की पुष्टि के बाद आपके वॉलेट में क्रेडिट जोड़ दिया जाएगा।',
    afterSubmit:'मदद चाहिए? contactus@hknovaxrproduction.com पर संपर्क करें।',
  },
  id:{
    description:'Dapatkan saldo dompet LingYing sebesar {amount} untuk membuka episode drama pendek berbayar.',
    submit:'Isi saldo satu kali. Bukan langganan. Saldo akan masuk ke dompet setelah pembayaran dikonfirmasi.',
    afterSubmit:'Perlu bantuan? Hubungi contactus@hknovaxrproduction.com',
  },
  'pt-BR':{
    description:'Receba {amount} em créditos na carteira LingYing para desbloquear episódios pagos de dramas curtos.',
    submit:'Recarga única. Sem assinatura. O crédito será adicionado à sua carteira após a confirmação do pagamento.',
    afterSubmit:'Precisa de ajuda? Entre em contato pelo e-mail contactus@hknovaxrproduction.com',
  },
  es:{
    description:'Recibe {amount} de saldo en tu monedero de LingYing para desbloquear episodios de dramas cortos de pago.',
    submit:'Recarga única. Sin suscripción. El saldo se añadirá a tu monedero cuando se confirme el pago.',
    afterSubmit:'¿Necesitas ayuda? Escribe a contactus@hknovaxrproduction.com',
  },
  ar:{
    description:'احصل على رصيد بقيمة {amount} في محفظة LingYing لفتح حلقات الدراما القصيرة المدفوعة.',
    submit:'شحن لمرة واحدة، دون اشتراك. سيُضاف الرصيد إلى محفظتك بعد تأكيد الدفع.',
    afterSubmit:'تحتاج إلى مساعدة؟ تواصل عبر contactus@hknovaxrproduction.com',
  },
  bn:{
    description:'পেইড স্বল্পদৈর্ঘ্য ড্রামার পর্ব আনলক করতে LingYing ওয়ালেটে {amount} ক্রেডিট নিন।',
    submit:'একবারের টপ-আপ। কোনো সাবস্ক্রিপশন নেই। পেমেন্ট নিশ্চিত হলে আপনার ওয়ালেটে ক্রেডিট যোগ হবে।',
    afterSubmit:'সাহায্য দরকার? contactus@hknovaxrproduction.com-এ যোগাযোগ করুন।',
  },
  ur:{
    description:'مختصر ڈراموں کی بامعاوضہ اقساط کھولنے کے لیے LingYing والیٹ میں {amount} کا کریڈٹ حاصل کریں۔',
    submit:'یہ ایک بار کی ٹاپ اَپ ہے، سبسکرپشن نہیں۔ ادائیگی کی تصدیق کے بعد آپ کے والیٹ میں کریڈٹ شامل کر دیا جائے گا۔',
    afterSubmit:'مدد چاہیے؟ contactus@hknovaxrproduction.com پر رابطہ کریں۔',
  },
  vi:{
    description:'Nhận {amount} vào số dư ví LingYing để mở khóa các tập phim ngắn trả phí.',
    submit:'Nạp một lần, không đăng ký định kỳ. Ví sẽ được cộng tiền sau khi thanh toán được xác nhận.',
    afterSubmit:'Cần hỗ trợ? Liên hệ contactus@hknovaxrproduction.com',
  },
  th:{
    description:'รับเครดิตกระเป๋าเงิน LingYing มูลค่า {amount} เพื่อปลดล็อกตอนละครสั้นแบบเสียเงิน',
    submit:'เติมเงินครั้งเดียว ไม่ใช่การสมัครสมาชิก กระเป๋าเงินจะได้รับเครดิตเมื่อยืนยันการชำระเงินแล้ว',
    afterSubmit:'ต้องการความช่วยเหลือ? ติดต่อ contactus@hknovaxrproduction.com',
  },
  fil:{
    description:'Makakuha ng {amount} na credit sa LingYing wallet para i-unlock ang mga bayad na episode ng maiikling drama.',
    submit:'Isang beses na pagdagdag ng pondo. Walang subscription. Madaragdagan ang wallet mo kapag nakumpirma ang bayad.',
    afterSubmit:'Kailangan ng tulong? Makipag-ugnayan sa contactus@hknovaxrproduction.com',
  },
  tr:{
    description:'Ücretli kısa drama bölümlerinin kilidini açmak için LingYing cüzdanınıza {amount} bakiye yükleyin.',
    submit:'Tek seferlik yükleme. Abonelik yoktur. Ödeme onaylandıktan sonra bakiye cüzdanınıza eklenir.',
    afterSubmit:'Yardıma mı ihtiyacınız var? contactus@hknovaxrproduction.com adresinden bize ulaşın.',
  },
  ru:{
    description:'Получите {amount} на кошелёк LingYing для открытия платных эпизодов коротких драм.',
    submit:'Разовое пополнение. Без подписки. Средства поступят в кошелёк после подтверждения оплаты.',
    afterSubmit:'Нужна помощь? Напишите на contactus@hknovaxrproduction.com',
  },
  fr:{
    description:'Recevez {amount} de crédit dans votre portefeuille LingYing pour débloquer les épisodes payants de séries courtes.',
    submit:'Recharge unique. Sans abonnement. Votre portefeuille sera crédité après confirmation du paiement.',
    afterSubmit:'Besoin d’aide ? Contactez contactus@hknovaxrproduction.com',
  },
  de:{
    description:'Erhalte {amount} Guthaben für deine LingYing-Wallet, um kostenpflichtige Kurzdrama-Folgen freizuschalten.',
    submit:'Einmalige Aufladung. Kein Abonnement. Das Guthaben wird deiner Wallet nach Bestätigung der Zahlung gutgeschrieben.',
    afterSubmit:'Brauchst du Hilfe? Schreib an contactus@hknovaxrproduction.com',
  },
  ms:{
    description:'Terima kredit {amount} dalam dompet LingYing untuk membuka episod drama pendek berbayar.',
    submit:'Tambah nilai sekali sahaja. Tiada langganan. Dompet anda akan dikreditkan selepas pembayaran disahkan.',
    afterSubmit:'Perlukan bantuan? Hubungi contactus@hknovaxrproduction.com',
  },
  ta:{
    description:'கட்டண குறுநாடக அத்தியாயங்களைத் திறக்க LingYing பணப்பையில் {amount} மதிப்பிலான தொகையைச் சேர்க்கவும்.',
    submit:'ஒரு முறை பணம் சேர்த்தல். சந்தா இல்லை. கட்டணம் உறுதிசெய்யப்பட்ட பின் உங்கள் பணப்பையில் தொகை சேர்க்கப்படும்.',
    afterSubmit:'உதவி தேவையா? contactus@hknovaxrproduction.com என்ற மின்னஞ்சலில் தொடர்புகொள்ளவும்.',
  },
};

export function checkoutCopy(locale:string,amountCents:number):CheckoutCopy{
  if(!Number.isSafeInteger(amountCents)||amountCents<0)throw new RangeError('Wallet credit must be a nonnegative safe integer number of USD cents.');
  const copy=Object.hasOwn(messages,locale)?messages[locale as Locale]:messages.en;
  const amount=`US$${Math.floor(amountCents/100)}.${String(amountCents%100).padStart(2,'0')}`;
  return{description:copy.description.replace('{amount}',amount),submit:copy.submit,afterSubmit:copy.afterSubmit};
}
