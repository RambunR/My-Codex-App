import type {Locale} from '../shared/config';

export const creatorPassRiskEnglish={
  creatorPassRiskBody:'Dramio Pass provides publishing access. Buying a pass does not guarantee content approval, promotion, views, sales, revenue or income. Earnings may be zero.',
} as const;
type CreatorPassRiskCopy=Record<keyof typeof creatorPassRiskEnglish,string>;

export const creatorPassRiskMessages:Record<Locale,CreatorPassRiskCopy>={
  en:creatorPassRiskEnglish,
  'zh-TW':{creatorPassRiskBody:'Dramio Pass 提供發佈權限。購買通行證並不保證內容獲批、宣傳推廣、觀看次數、銷售、營收或收入。收益可能為零。'},
  'zh-CN':{creatorPassRiskBody:'Dramio Pass 提供发布权限。购买通行证并不保证内容获批、宣传推广、观看次数、销售、营收或收入。收益可能为零。'},
  ja:{creatorPassRiskBody:'Dramio Pass は公開機能へのアクセスを提供します。パスの購入は、コンテンツの承認、宣伝、視聴数、販売、売上または収入を保証するものではありません。収益がゼロになる場合もあります。'},
  ko:{creatorPassRiskBody:'Dramio Pass는 콘텐츠 게시 권한을 제공합니다. 패스를 구매해도 콘텐츠 승인, 홍보, 조회수, 판매, 매출 또는 소득은 보장되지 않습니다. 수익이 없을 수도 있습니다.'},
  hi:{creatorPassRiskBody:'Dramio Pass प्रकाशन की सुविधा देता है। पास खरीदने से सामग्री की स्वीकृति, प्रचार, व्यूज़, बिक्री, राजस्व या आय की गारंटी नहीं मिलती। कमाई शून्य हो सकती है।'},
  id:{creatorPassRiskBody:'Dramio Pass memberikan akses untuk menerbitkan konten. Membeli pass tidak menjamin persetujuan konten, promosi, jumlah penayangan, penjualan, pendapatan usaha, atau penghasilan. Penghasilan bisa nol.'},
  'pt-BR':{creatorPassRiskBody:'O Dramio Pass oferece acesso à publicação. Comprar um passe não garante aprovação de conteúdo, promoção, visualizações, vendas, faturamento ou renda. Os ganhos podem ser zero.'},
  es:{creatorPassRiskBody:'Dramio Pass permite publicar contenido. Comprar un pase no garantiza la aprobación del contenido, promoción, visualizaciones, ventas, facturación ni ingresos. Las ganancias pueden ser cero.'},
  ar:{creatorPassRiskBody:'يتيح Dramio Pass إمكانية نشر المحتوى. شراء التصريح لا يضمن الموافقة على المحتوى أو الترويج أو المشاهدات أو المبيعات أو الإيرادات أو الدخل. قد تكون الأرباح صفرًا.'},
  bn:{creatorPassRiskBody:'Dramio Pass প্রকাশ করার সুবিধা দেয়। পাস কিনলে কনটেন্টের অনুমোদন, প্রচার, ভিউ, বিক্রি, রাজস্ব বা আয়ের নিশ্চয়তা পাওয়া যায় না। উপার্জন শূন্য হতে পারে।'},
  ur:{creatorPassRiskBody:'Dramio Pass مواد شائع کرنے کی رسائی دیتا ہے۔ پاس خریدنے سے مواد کی منظوری، تشہیر، ویوز، فروخت، محصول یا آمدنی کی ضمانت نہیں ملتی۔ کمائی صفر ہو سکتی ہے۔'},
  vi:{creatorPassRiskBody:'Dramio Pass cung cấp quyền xuất bản nội dung. Việc mua thẻ không bảo đảm nội dung được duyệt, được quảng bá, có lượt xem, lượt bán, doanh thu hay thu nhập. Thu nhập có thể bằng không.'},
  th:{creatorPassRiskBody:'Dramio Pass ให้สิทธิ์เผยแพร่เนื้อหา การซื้อพาสไม่ได้รับประกันการอนุมัติเนื้อหา การโปรโมต ยอดรับชม ยอดขาย รายได้จากการขาย หรือรายได้ส่วนบุคคล ผลตอบแทนอาจเป็นศูนย์'},
  fil:{creatorPassRiskBody:'Nagbibigay ang Dramio Pass ng access sa paglalathala. Hindi ginagarantiyahan ng pagbili ng pass ang pag-apruba ng nilalaman, promosyon, mga panonood, benta, kita mula sa benta o personal na kita. Maaaring zero ang kitain.'},
  tr:{creatorPassRiskBody:'Dramio Pass, içerik yayımlama erişimi sağlar. Pass satın almak içerik onayını, tanıtımı, izlenmeleri, satışları, hasılatı veya geliri garanti etmez. Kazanç sıfır olabilir.'},
  ru:{creatorPassRiskBody:'Dramio Pass предоставляет доступ к публикации. Покупка пропуска не гарантирует одобрение контента, продвижение, просмотры, продажи, выручку или доход. Заработок может быть нулевым.'},
  fr:{creatorPassRiskBody:'Dramio Pass donne accès à la publication. L’achat d’un pass ne garantit ni l’approbation du contenu, ni sa promotion, ni des vues, des ventes, un chiffre d’affaires ou un revenu. Les gains peuvent être nuls.'},
  de:{creatorPassRiskBody:'Dramio Pass ermöglicht das Veröffentlichen von Inhalten. Der Kauf eines Passes garantiert weder die Freigabe von Inhalten noch Werbung, Aufrufe, Verkäufe, Umsatz oder Einkommen. Die Einnahmen können null betragen.'},
  ms:{creatorPassRiskBody:'Dramio Pass memberikan akses untuk menerbitkan kandungan. Pembelian pas tidak menjamin kelulusan kandungan, promosi, tontonan, jualan, hasil atau pendapatan. Pendapatan mungkin sifar.'},
  ta:{creatorPassRiskBody:'Dramio Pass உள்ளடக்கத்தை வெளியிடும் அனுமதியை வழங்குகிறது. பாஸ் வாங்குவது உள்ளடக்க ஒப்புதல், விளம்பரம், பார்வைகள், விற்பனை, விற்பனை வருவாய் அல்லது தனிப்பட்ட வருமானத்தை உறுதி செய்யாது. ஈட்டும் தொகை பூஜ்ஜியமாக இருக்கலாம்.'},
};
