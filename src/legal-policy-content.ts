import {COMPANY_NAME,CONTACT_EMAIL} from './company';

export {LEGAL_POLICY_VERSION} from '../shared/creator-pass-consent';
export type LegalLocale='en'|'zh-TW'|'zh-CN';
export type LegalPolicyType='terms'|'privacy';
export interface LegalSection{id:string;title:string;paragraphs:string[];items?:string[];contact?:boolean}
export interface LegalDocument{title:string;intro:string;summary:string[];sections:LegalSection[]}
export interface LegalPolicyCopy{
  effective:string;date:string;version:string;contents:string;summary:string;contact:string;languages:string;related:string;fallback:string;
  terms:LegalDocument;privacy:LegalDocument;
}

const en:LegalPolicyCopy={
  effective:'Effective date',date:'8 November 2026',version:'Version',contents:'On this page',summary:'Key points',contact:'Contact the company',languages:'Policy language',related:'Related policies',
  fallback:'This policy is available in English, Traditional Chinese and Simplified Chinese. English is shown for your selected interface language.',
  terms:{title:'Terms of Use',intro:`These Terms describe the conditions for using LingYing, operated by ${COMPANY_NAME} (the “Company”, “we” or “us”). They apply to the extent they form a valid agreement with you. Read them before registering, purchasing a Dramio Pass or publishing content. Your rights that cannot legally be excluded continue to apply.`,
    summary:[
      'A Dramio Pass provides publishing access. Buying a pass does not guarantee content approval, promotion, views, sales, revenue or income. Earnings may be zero.',
      'You must hold the necessary rights to everything you upload. The Company may restrict or remove infringing, unlawful or inappropriate content.',
      'The Company makes the final decision within its internal review process, subject to applicable law, correction of errors and your rights to approach courts, regulators or payment providers.',
      'Refunds, existing earnings and purchased access are assessed under the applicable transaction terms and law; these Terms do not permit arbitrary confiscation or remove mandatory consumer protections.',
    ],sections:[
      {id:'using-lingying',title:'1. Accounts, eligibility and free viewing',paragraphs:[
        'Episodes marked free may be watched without registration or login. Paid unlocks, wallet funding and creator publishing require the relevant account and permissions. An account does not guarantee access to every episode.',
        'You must be at least 18 and legally able to enter a contract to purchase, publish or request withdrawals. Anyone below 18 may browse only with a parent or guardian’s permission and where the content is lawful and age-appropriate. Provide accurate information, protect your credentials and report suspected unauthorised access. Do not share or sell accounts, impersonate others or evade restrictions.',
      ]},
      {id:'creator-pass',title:'2. Dramio Pass: publishing access, not guaranteed results',paragraphs:[
        'Before opening a new Pass checkout, review these Terms, acknowledge the Privacy Policy and expressly confirm that results are not guaranteed using the required checkbox. We record the accepted versions, language, time and related payment as evidence of that acknowledgement. This acknowledgement does not provide consent to unrelated marketing.',
        'Dramio Pass is a one-time payment for access to the creator publishing features described at purchase, subject to these Terms, account eligibility, content review and technical limits. The regular price is HK$88; a valid promotion may change the amount shown at checkout. Actual billing is in HKD. Other-currency displays are indicative estimates. The Pass is not a purchase of viewers, advertising, investment returns or employment.',
        'Buying a Pass, uploading content or being featured does not guarantee approval, distribution, recommendations, any minimum view count, followers, paid unlocks, sales, revenue, income or recovery of production and Pass costs. Earnings may be zero. Results depend on audience demand, content, pricing, lawful availability and other factors. Examples, estimates, promotional language and another creator’s results are not promises of your results.',
        'Regular publishers currently receive a 5 GiB storage allowance. Administrator-owned media may have different access. The current episode limits are 4 minutes and 200 MiB per input file; covers are subject to separate limits. Any storage increase or additional service must be separately approved and quoted. A Pass does not exempt content from moderation or provide an unconditional right to permanent hosting.',
      ]},
      {id:'content-rights',title:'3. Your content and permission to operate the service',paragraphs:[
        'You retain the rights you lawfully hold in your content. You confirm that you have all permissions needed to upload, store, display, stream and monetise it, including video, music, scripts, artwork, trademarks, performances, personal data, voices and likenesses. An AI-generated or AI-assisted label does not establish ownership, clear third-party rights or excuse infringement. Describe the production method and language accurately.',
        'You grant the Company a non-exclusive, worldwide permission to host, copy, technically process, format, display and stream submitted content as needed to operate, secure and promote its availability on LingYing, including through service providers. This does not transfer ownership or authorise unrelated exploitation of your work. Removing content ends future public use where practicable, while limited copies and records may remain for existing transactions, legal duties, disputes, security, backups or removal processing.',
      ]},
      {id:'acceptable-use',title:'4. Acceptable use and prohibited content',paragraphs:['Do not use LingYing to violate law, another person’s rights or the service’s security. In particular, do not upload or engage in:'],items:[
        'Copyright or trademark infringement, stolen or unauthorised media, impersonation, misleading ownership claims or misuse of a person’s voice or likeness.',
        'Child sexual abuse or exploitation, non-consensual sexual material, unlawful sexual content, or content that endangers or exploits children.',
        'Unlawful hate, credible threats, targeted harassment, doxxing, fraud, scams or other unlawful or seriously harmful conduct.',
        'Malware, unauthorised access, payment abuse, automated fake views or purchases, manipulation of statistics, or attempts to bypass access, moderation or storage controls.',
      ]},
      {id:'content-removal',title:'5. Review, restrictions and content removal',paragraphs:[
        'The Company reserves the right to decline publication, limit recommendations, restrict access, suspend an account, or hide or remove content when it reasonably considers action necessary for suspected infringement, unlawful or inappropriate material, a breach of these Terms, security, fraud prevention, legal requests or protection of users and the service. Payment of a Pass does not require the Company to publish or continue hosting a product.',
        'Urgent restrictions or removal may occur without prior notice. Where reasonably practicable and lawful, we will explain the action and allow the affected creator to provide relevant information for review. We may withhold details where disclosure would create legal, privacy, safety or security risks. Send a review request with the relevant content URL, account details and supporting evidence.',
        'Creators may also hide or delete their series using available tools. Removal can end viewing access even where an episode was previously unlocked; purchase records are not a guarantee of perpetual availability. Removal does not by itself erase transaction history, decide a refund claim or forfeit legitimate accrued earnings. Those matters require separate review under the applicable terms and law.',
      ],contact:true},
      {id:'copyright-reports',title:'6. Copyright and other rights complaints',paragraphs:[
        `Send rights complaints to ${CONTACT_EMAIL}. Include your name and contact details, the affected work and LingYing URL, the rights you claim or represent, evidence of ownership or authority, and a good-faith explanation of the alleged infringement. State the remedy requested. Do not send unnecessary identity documents or knowingly false claims.`,
        'We may restrict the material while reviewing the complaint and seek information from the uploader. The uploader may provide evidence of a licence, ownership, consent or another lawful basis. We will consider relevant evidence and applicable law; restoration is not guaranteed. Necessary complaint information may be shared for a fair response, with appropriate protection of personal data. This procedure does not replace any statutory notice process or court remedy.',
      ],contact:true},
      {id:'purchases-refunds',title:'7. Prices, wallet credit, episode access and refunds',paragraphs:[
        'Review the price, currency, promotion and service description before confirming payment. Wallet credit and episode prices are accounted for in USD; wallet credit is for purchases on LingYing and is not a cash-withdrawal facility. A price change does not retrospectively change a completed purchase. Applicable tax, exchange or payment-provider charges are governed by the information shown for the transaction and applicable law.',
        'A Pass fee buys publishing access rather than a particular commercial outcome. Disappointing views or earnings alone do not create a promised-results refund entitlement. This does not exclude a refund or other remedy required by law, including where a paid service was not supplied or was misdescribed. Contact us with the receipt or payment reference and the problem so we can review an appropriate remedy. Do not send full card details.',
        'There is no blanket waiver of refund, chargeback or other consumer rights. Failed, duplicate, unauthorised or disputed payments and loss of paid access are reviewed on their facts. A content removal or account closure does not automatically create or automatically defeat a refund claim.',
      ],contact:true},
      {id:'creator-earnings',title:'8. Creator revenue, fees and withdrawals',paragraphs:[
        'For valid paid episode unlocks, the creator is allocated 70% and the platform 30% before actual Stripe or other transaction-provider fees. Actual provider fees are borne within the creator’s 70% share; they vary and may include fixed charges, conversion and bank costs. They are not a guaranteed 1% or an additional fixed LingYing fee. Displayed estimates are not a promise of the final bank amount. Test or simulated balances and payouts are not real earnings.',
        'New withdrawal requests currently have a US$10 minimum and no platform withdrawal fee. Processing is stated as 3–5 days after submission, subject to review, available earnings, required verification, lawful holds and provider availability; bank receipt may take longer. Existing requests keep their saved transaction terms. Creator payouts may be paused independently of customer card payments, and buying a Pass does not activate or guarantee payouts.',
        'Application view and watch-time figures are estimates of recorded playback activity, not audited unique audience counts or guaranteed revenue. Corrections, invalid activity, refunds, chargebacks or rights disputes can require review and lawful adjustments supported by evidence. Legitimate accrued amounts are not arbitrarily confiscated because the Company removes a product or a creator raises a complaint. We may apply proportionate review holds while determining the amount properly payable. You are responsible for your own tax and reporting obligations.',
      ]},
      {id:'disputes',title:'9. Company review and dispute decisions',paragraphs:[
        `For disputes about a Pass, views, income, revenue allocation, withdrawals, moderation or access, contact ${CONTACT_EMAIL} with the relevant account, payment reference or content URL, a clear description, supporting evidence and the outcome you seek. We may ask for information reasonably needed to verify the request and investigate.`,
        'The Company has final decision-making authority within its internal review process. We will exercise that authority reasonably and in good faith, considering the applicable terms, records and evidence. We may correct mistakes and reconsider an outcome when material new evidence is provided. We will explain the outcome where reasonably practicable and lawful.',
        'An internal decision is not a binding determination of your legal rights and does not prevent you from using mandatory consumer remedies, a competent court, a regulator or an available payment-provider dispute process. No clause makes the Company the final authority over matters reserved by law to those bodies.',
      ],contact:true},
      {id:'availability-liability',title:'10. Availability, responsibility and liability',paragraphs:[
        'We take reasonable care in operating the service, but do not promise uninterrupted access, an error-free service, permanent hosting, a specific audience or commercial success. Maintain your own copies of uploaded material. Third-party services and lawful content restrictions may affect availability.',
        'To the extent permitted by law, we are not responsible for unforeseeable or indirect business losses, lost anticipated profits, or loss caused by your breach or by matters outside our reasonable control. Nothing excludes or limits liability that cannot lawfully be excluded, including applicable liability for fraud, death or personal injury caused by negligence, mandatory consumer remedies or personal-data obligations.',
        'A creator remains responsible for their own unlawful uploads or breach of another person’s rights. To the extent lawful, the creator is responsible for reasonable losses and costs resulting from third-party claims caused by that breach, with prompt notice and a reasonable opportunity to respond. This does not cover loss caused by the Company’s own wrongdoing or remove a defence or protection provided by law.',
      ]},
      {id:'changes-law',title:'11. Changes, applicable law and contact',paragraphs:[
        'We may update these Terms prospectively to reflect changes to the service, law or reasonable operational needs. Material changes will be brought to users’ attention through an appropriate service notice, and consent will be requested where required. A new version does not retrospectively rewrite completed transactions or demonstrate that an existing user previously accepted it. Any unenforceable provision is limited or separated only as law allows; the remaining lawful provisions continue.',
        `Hong Kong law governs to the extent permitted, with disputes subject to courts having lawful jurisdiction. Mandatory protections and dispute rights that apply in your place of residence are preserved. For questions or complaints, contact ${COMPANY_NAME} at ${CONTACT_EMAIL}.`,
      ],contact:true},
    ]},
  privacy:{title:'Privacy Policy',intro:`${COMPANY_NAME} operates LingYing and is responsible for the personal data it collects for the service. This policy explains the data we use, why we use it, who may receive it and how to make a privacy request. It covers visitors, viewers and creators, including people watching free episodes without an account.`,summary:[
    'We use account, content, viewing and transaction information to provide and secure LingYing. Free guest viewing still involves essential cookies, playback measurement and network processing.',
    'Creators receive aggregate performance statistics, not individual viewers’ names, email addresses, passwords or card details.',
    'Hosting, payment, sign-in and email providers may process data, including outside Hong Kong. We do not store full payment-card numbers or your Google or Apple password.',
    'Contact us to request access, correction or account/data deletion. Requests are handled through support; legal, accounting, dispute and security records may need to be retained.',
  ],sections:[
    {id:'data-controller',title:'1. Who is responsible and how to contact us',paragraphs:[`The service is operated by ${COMPANY_NAME}. Contact ${CONTACT_EMAIL} for privacy questions, access or correction requests, account closure requests, or concerns about an upload containing personal data. Explain the request without sending passwords or full payment-card details.`],contact:true},
    {id:'data-collected',title:'2. Information collected',paragraphs:[
      'Account and identity information includes your name, email address, language, account role and status, authentication-provider identifiers, timestamps and storage allowance. Password registration uses a salted password hash rather than a stored plain-text password. Google or Apple sign-in can supply an account identifier, name and email, including an Apple relay email; we do not request your Google or Apple password, Gmail messages, contacts or Drive files, and do not store their access or refresh tokens for sign-in.',
      'Content and activity information includes uploaded video, artwork, titles, descriptions, classifications and declared languages; public publisher-profile information; likes, saved stories, watch progress, playback events, viewing time and related aggregate statistics. Account-linked or random guest identifiers are hashed for playback measurement. A hash is a protective measure, not a promise that the data is completely anonymous.',
      'Transaction and support information includes payment and purchase identifiers, amounts and currencies, wallet and creator-ledger entries, Pass status, policy and acknowledgement versions, acceptance times and languages linked to Pass payments, withdrawal requests, connected-payment-account references, fraud or payment reviews, moderation records and messages you send us. Hosting and security systems may process IP addresses, request times, browser/device information and diagnostic records. Raw IP addresses are not stored in the application’s playback-measurement records, but may be processed for network delivery, security and rate limiting.',
    ]},
    {id:'purposes',title:'3. Why information is used and what is optional',paragraphs:[
      'We use information to authenticate users; provide viewing, purchases and publishing; remember choices; process and reconcile payments; calculate creator statistics; review content and rights complaints; prevent abuse; troubleshoot; answer support requests; and meet legal or regulatory requirements. We use data for these purposes or directly related purposes permitted by law. A new use unrelated to the original collection purpose will require an appropriate notice and consent where required.',
      'Providing accurate account information is needed for registration and account services; payment and publishing information is needed for the corresponding transaction. You can browse and watch marked free episodes without registering. Optional profile information or uploads are provided at your choice. Withholding information needed to verify a payment, identity or complaint can prevent us from providing that particular service or completing the request.',
      'We do not treat account creation or a Pass purchase as consent to unrelated direct marketing. If direct marketing is introduced, we will provide the notices, choices and consent required by applicable law. This policy does not grant a separate right to use creator uploads for unrelated AI training.',
    ]},
    {id:'cookies',title:'4. Cookies, browser storage and location-related display',paragraphs:[
      'The application uses a secure, HTTP-only session cookie for sign-in and a separate random guest-viewer cookie when guest playback begins. These application cookies currently have a 30-day lifetime. Short-lived sign-in cookies help bind Google or Apple authentication attempts to your browser. Cookie expiry is not the retention period for the associated business or playback records.',
      'Browser local storage remembers your interface language; session storage may temporarily retain a deliberately entered promotion code during registration. Browser or installed-app storage may also hold static application files. You can clear browser storage or manage cookies in your browser, but sign-in, purchases, preferences and some measurement or app features may stop working.',
      'Cloudflare may provide coarse country information to show an indicative local-currency price. This does not require GPS location. The exchange-rate service receives the currency pair needed for the estimate, not your LingYing account details. Hosting, delivery and security providers may also use their own operational measurement and logs. Our application playback measurement is described here separately from those provider services.',
    ]},
    {id:'providers-transfers',title:'5. Service providers, disclosures and international processing',paragraphs:[
      'Cloudflare provides hosting, delivery, security, database and object-storage infrastructure. Stripe hosts card-entry pages and processes payments; where payout services are configured, Stripe Connect may handle creator identity and bank verification. We keep transaction records and references, not full card numbers. If you use Google or Apple sign-in, those providers authenticate you under their own privacy terms. Configured email delivery services, such as Cloudflare Email Sending or Resend, receive the recipient address and the account-security message or link they deliver.',
      'We may provide information reasonably needed to service providers acting for the stated purpose, professional advisers, competent authorities where legally required, or parties needed to investigate fraud, security incidents, legal claims or rights complaints. Necessary complaint details may be shared with an affected uploader for a fair response; unnecessary personal details should be withheld or redacted where practicable. We do not sell personal data.',
      'Providers may process or store data in locations outside Hong Kong and your residence. We seek appropriate contractual and security arrangements for service-provider processing and retention, subject to applicable law. Provider privacy terms also apply to information you give them directly. We do not promise that all data stays in a particular country.',
    ]},
    {id:'public-information',title:'6. Public content and who can see other records',paragraphs:[
      'Published series, covers, descriptions, public creator or publisher names, declared content languages, public profile dates, and displayed views or likes may be visible to other visitors and search engines. Consider what you disclose before uploading. Do not place private personal information in public fields unless you have an appropriate lawful basis and understand that others may copy it.',
      'Creators receive aggregate views, viewing time, likes, paid unlocks and distinct paid-user counts relating to their work, including daily or episode-level summaries. They do not receive individual viewers’ names, emails, passwords, payment-card details or individual viewing histories through those reports. Authorised administrators may access account, content, financial, storage, support and moderation records as needed for service administration and reviews.',
    ]},
    {id:'retention',title:'7. Retention, content removal and account closure',paragraphs:[
      'We retain personal data only for as long as reasonably needed for the purposes described, including the service relationship, transaction and tax records, dispute resolution, rights complaints, security and other legal obligations. We review retention needs and remove or anonymise information when it is no longer needed, subject to lawful holds and operational backup or removal processes. There is no single retention period that applies to every record.',
      'Series deletion can remove public content and associated viewing, likes and saved-story records, while preserving limited content references, purchase/ledger records and moderation history needed for legitimate business and legal purposes. A media-removal or backup process may take additional time. Account closure or a deletion request does not automatically erase records required for legal, accounting, fraud-prevention or unresolved-dispute purposes.',
    ]},
    {id:'security',title:'8. Security',paragraphs:[
      'We use reasonable organisational and technical measures, including controlled account access, password hashing, protected session mechanisms and authorised access to private media. Access is limited according to service responsibilities. No internet service, transmission method or storage system can be guaranteed completely secure; these measures are not a promise that misuse or a breach is impossible.',
      'Keep credentials private and contact us promptly if you suspect account misuse or unintended disclosure. We will assess security incidents and make notifications where applicable law requires them. Do not submit passwords, full card details or unnecessary sensitive documents in a support message.',
    ]},
    {id:'privacy-rights',title:'9. Access, correction and other privacy requests',paragraphs:[
      `Contact ${CONTACT_EMAIL} to request access to or correction of your personal data, ask about its use, request account closure or deletion, or raise a privacy complaint. Please identify your account and the request. We may ask for proportionate verification or information needed to locate the data and protect another person’s privacy. Requests are handled through support rather than an automatic account-deletion or export tool.`,
      'We will handle requests within the applicable statutory periods, explain any lawful refusal or restriction, and tell you about any permitted fee before it is incurred. Hong Kong data-access and correction requests normally have a 40-day response period, subject to the applicable legal requirements and exceptions; this is not a promise to erase every record within 40 days. Deletion and portability requests depend on the rights available under the law applying to you; they are not unlimited. You may raise an unresolved Hong Kong personal-data concern with the Privacy Commissioner for Personal Data, or another competent authority where applicable. Nothing in this policy restricts a statutory complaint or remedy.',
    ],contact:true},
    {id:'children',title:'10. Children and other people’s information',paragraphs:[
      'The service is not directed at children. Purchases, creator publishing and withdrawals are restricted by the eligibility rules in the Terms. We do not claim to verify every visitor’s age. If you believe a child has provided personal data inappropriately, or an upload unlawfully exposes another person’s information, contact us so we can assess removal and other appropriate action.',
    ],contact:true},
    {id:'privacy-changes',title:'11. Policy updates',paragraphs:[
      'We may update this policy when data practices, services or legal requirements change. The effective date and version identify this notice. Material changes will be communicated appropriately, and consent will be sought where required. A policy update does not by itself authorise an incompatible new use of previously collected personal data.',
    ]},
  ]},
};

const zhTW:LegalPolicyCopy={
  effective:'生效日期',date:'2026年11月8日',version:'版本',contents:'本頁內容',summary:'重點摘要',contact:'聯絡公司',languages:'政策語言',related:'相關政策',fallback:en.fallback,
  terms:{title:'使用條款',intro:`本條款說明使用 LingYing 靈映的條件。平台由 ${COMPANY_NAME}（下稱「公司」、「我們」）營運，並在與您構成有效協議的範圍內適用。請在註冊、購買 Dramio Pass 或發布內容前閱讀本條款。法律規定不得排除的權利仍然適用。`,summary:[
    'Dramio Pass 提供發布功能的使用權。購買通行證不保證內容獲批、宣傳、觀看次數、銷售、營收或收入；收益可能為零。',
    '您必須擁有上傳內容所需的全部權利。公司可限制或移除侵權、違法或不適當的內容。',
    '公司對內部覆核程序作最終決定，但仍須遵守適用法律、糾正錯誤，並保留您向法院、監管機構或支付服務商提出爭議的權利。',
    '退款、已有收益及已購存取權須按相關交易條款及法律處理；本條款不允許任意沒收款項，亦不排除強制性消費者保障。',
  ],sections:[
    {id:'using-lingying',title:'1. 帳戶、資格及免費觀看',paragraphs:[
      '標示為免費的集數可免註冊、免登入觀看。付費解鎖、錢包儲值及創作者發布功能需要相應帳戶及權限。擁有帳戶並不代表可觀看所有集數。',
      '購買、發布內容或申請提領者須年滿18歲，並具備訂立合約的法律能力。未滿18歲人士只可在家長或監護人同意下瀏覽合法且適齡的內容。請提供準確資料、保管登入憑證，並及時報告疑似未經授權的存取。不得分享或出售帳戶、冒充他人或規避限制。',
    ]},
    {id:'creator-pass',title:'2. Dramio Pass：發布權限，不保證成果',paragraphs:[
      '開啟新的通行證結帳前，請閱讀本條款、知悉私隱政策，並透過必填確認方格明確確認成果不獲保證。我們會記錄所接受的版本、語言、時間及相關付款，作為該項確認的紀錄。這不構成對無關直接促銷的同意。',
      'Dramio Pass 是使用購買時所描述之創作者發布功能的一次性付款，並受本條款、帳戶資格、內容審核及技術限制約束。標準價格為一次港幣88元；有效優惠可能改變結帳顯示的金額。實際以港幣收費，其他貨幣顯示僅供估算。通行證並非購買觀眾、廣告、投資回報或僱傭關係。',
      '購買通行證、上傳內容或獲平台推薦，均不保證審核通過、分發、推薦曝光、最低觀看次數、追蹤者、付費解鎖、銷售、營收、收入，亦不保證收回製作費或通行證成本。收益可能為零。成果取決於觀眾需求、內容、定價、合法可用性及其他因素。示例、估算、宣傳用語及其他創作者的成果，均非對您成果的承諾。',
      '一般發布者目前獲5 GiB儲存額度，管理員自有媒體的權限可能不同。目前每集輸入檔案上限為4分鐘及200 MiB，封面另有上限。增加儲存額度或其他服務須另行批准及報價。通行證不豁免內容審核，也不提供無條件永久託管的權利。',
    ]},
    {id:'content-rights',title:'3. 您的內容及平台營運授權',paragraphs:[
      '您保留依法享有的內容權利，並確認已取得上傳、儲存、展示、串流及營利所需的一切許可，包括影片、音樂、劇本、美術、商標、演出、個人資料、聲音及肖像。標示為AI生成或AI輔助，不等於已確立擁有權、清除第三方權利或免除侵權責任。請準確描述製作方式及語言。',
      '您授予公司非獨家、全球性的許可，讓公司及其服務供應商在營運、保障 LingYing 及宣傳內容在平台上可用所需的範圍內，託管、複製、技術處理、轉換格式、展示及串流所提交內容。這不轉移擁有權，也不授權與服務無關的利用。移除內容後，未來公開使用會在可行情況下停止，但為現有交易、法律義務、爭議、安全、備份或移除程序所需的有限副本及紀錄可能保留。',
    ]},
    {id:'acceptable-use',title:'4. 可接受使用及禁止內容',paragraphs:['不得利用 LingYing 違反法律、侵犯他人權利或破壞服務安全，尤其不得上傳或從事：'],items:[
      '侵犯版權或商標、盜用或未經授權的媒體、冒充他人、虛報擁有權，或濫用他人聲音及肖像。',
      '兒童性虐待或剝削、未經同意的性影像、違法性內容，或危害、剝削兒童的內容。',
      '違法仇恨內容、可信威脅、針對性騷擾、公開私人資料、欺詐、詐騙或其他違法或嚴重有害行為。',
      '惡意軟件、未經授權存取、濫用付款、偽造自動觀看或購買、操縱統計，或規避存取、審核及儲存限制。',
    ]},
    {id:'content-removal',title:'5. 審核、限制及下架',paragraphs:[
      '如公司合理認為有必要處理疑似侵權、違法或不適當內容、違反本條款、安全、預防欺詐、法律要求，或保障用戶及服務，公司保留拒絕發布、限制推薦、限制存取、暫停帳戶、隱藏或移除內容的權利。支付通行證費用不代表公司必須發布或持續託管某項作品。',
      '在緊急情況下，公司可不事先通知而採取限制或下架措施。在合理可行且合法的情況下，我們會解釋措施，並讓受影響創作者提供資料申請覆核。如披露詳情會造成法律、私隱、安全或保安風險，我們可能不予披露。申請覆核時，請提供內容網址、帳戶資料及支持證據。',
      '創作者亦可透過現有工具隱藏或刪除自己的劇集。即使某集已解鎖，下架仍可能終止觀看；購買紀錄並不保證永久供應。下架本身不會抹除交易紀錄、決定退款申請，或沒收合法已累積的收益；相關事宜須按適用條款及法律另行覆核。',
    ],contact:true},
    {id:'copyright-reports',title:'6. 版權及其他權利投訴',paragraphs:[
      `請將權利投訴寄至 ${CONTACT_EMAIL}，並提供姓名及聯絡資料、受影響作品及 LingYing 網址、所主張或代表的權利、擁有權或授權證明，以及真誠說明涉嫌侵權的原因和所要求的處理方式。請勿提交不必要的身份證明文件或明知不實的指控。`,
      '覆核期間，我們可限制有關內容，並向上傳者查詢。上傳者可提供授權、擁有權、同意或其他合法依據的證據。我們會考慮相關證據及適用法律，但不保證恢復內容。為公平回應投訴，必要資料可能在適當保障個人資料的情況下與相關人士分享。本程序不取代任何法定通知程序或法院救濟。',
    ],contact:true},
    {id:'purchases-refunds',title:'7. 價格、錢包、集數存取及退款',paragraphs:[
      '確認付款前，請查閱價格、貨幣、優惠及服務描述。錢包額度及集數價格以美元記帳；錢包僅供在 LingYing 購物，不提供現金提領功能。價格變動不會追溯改變已完成交易。適用稅項、匯兌或支付服務商費用，以交易所展示的資料及適用法律為準。',
      '通行證費用購買的是發布權限，而非指定商業成果。觀看或收益未如理想，本身不會產生「保證成果」的退款權利。但本條款不排除法律要求的退款或其他救濟，包括已付款服務未獲提供或描述失實。請提供收據或付款編號及問題，讓我們覆核適當處理方式；請勿提供完整卡號。',
      '本條款不概括豁免退款、拒付或其他消費者權利。失敗、重複、未經授權或有爭議的付款，以及喪失已付款存取權，均按實際情況覆核。內容下架或帳戶結束，不會自動成立或自動否定退款申請。',
    ],contact:true},
    {id:'creator-earnings',title:'8. 創作者營收、費用及提領',paragraphs:[
      '有效付費集數解鎖在扣除實際 Stripe 或其他交易服務商費用前，按70%分配予創作者、30%分配予平台。實際服務商費用由創作者70%的份額內承擔，可能包括固定費、匯兌及銀行費用。費用並非保證為1%，也不是額外固定的 LingYing 費用。顯示的估算不保證最終銀行到帳金額。測試或模擬餘額及提領並非真實收益。',
      '新提領申請目前最低為10美元，不另收平台提領費。處理時間為提交後3至5天，但受覆核、可用收益、必要驗證、合法保留及服務商可用性影響；銀行到帳可能需更長時間。現有申請保留其已儲存的交易條款。創作者提領可獨立於顧客刷卡付款而暫停；購買通行證不會啟用或保證提領。',
      '平台觀看及觀看時間數字是所記錄播放活動的估算，並非經審計的獨立觀眾人數或收益保證。錯誤更正、無效活動、退款、拒付或權利爭議，可能須根據證據覆核及依法調整。公司不會僅因下架作品或創作者提出投訴而任意沒收合法已累積款項；釐定應付款項期間，可作相稱的覆核保留。您須自行履行稅務及申報義務。',
    ]},
    {id:'disputes',title:'9. 公司覆核及爭議決定',paragraphs:[
      `如對通行證、觀看次數、收入、營收分配、提領、審核或存取有爭議，請聯絡 ${CONTACT_EMAIL}，並提供相關帳戶、付款編號或內容網址、清楚說明、支持證據及希望獲得的處理結果。我們可要求核實及調查所合理需要的資料。`,
      '公司在內部覆核程序中擁有最終決定權，並會合理、真誠地考慮適用條款、紀錄及證據。我們可更正錯誤，或在獲得重要新證據後重新考慮決定；在合理可行且合法的情況下，會解釋處理結果。',
      '內部決定並非對您法律權利具約束力的裁定，亦不妨礙您使用強制性消費者救濟、有管轄權的法院、監管機構或適用支付服務商的爭議程序。任何條款均不使公司成為法律保留予上述機構之事項的最終裁決者。',
    ],contact:true},
    {id:'availability-liability',title:'10. 服務供應、責任及法律限制',paragraphs:[
      '我們會以合理謹慎方式營運服務，但不承諾存取永不中斷、服務毫無錯誤、永久託管、指定觀眾人數或商業成功。請自行備份上傳作品。第三方服務及合法內容限制可能影響供應。',
      '在法律允許的範圍內，我們不對不可預見或間接的商業損失、預期利潤損失，或因您違約及我們合理控制範圍以外事項所造成的損失負責。本條款不排除或限制依法不得排除的責任，包括適用的欺詐責任、因疏忽導致死亡或人身傷害的責任、強制性消費者救濟或個人資料責任。',
      '創作者須對自己的違法上傳或侵犯他人權利負責。在合法範圍內，創作者須承擔因該等違反而引起第三方索償的合理損失及費用，並應及時獲通知及有合理回應機會。這不涵蓋公司自身不當行為所造成的損失，也不剝奪法律提供的抗辯或保障。',
    ]},
    {id:'changes-law',title:'11. 條款變更、適用法律及聯絡',paragraphs:[
      '我們可因服務、法律或合理營運需要而向將來更新本條款。重大變更會透過適當服務通知提醒用戶，並在法律要求時徵求同意。新版本不追溯改寫已完成交易，也不證明現有用戶曾接受該版本。不可執行的條款只會在法律允許下予以限制或分割，其餘合法條款繼續適用。',
      `在法律允許的範圍內，適用香港法律，爭議由依法有管轄權的法院處理。您居住地適用的強制性保障及爭議權利仍予保留。如有問題或投訴，請聯絡 ${COMPANY_NAME}：${CONTACT_EMAIL}。`,
    ],contact:true},
  ]},
  privacy:{title:'私隱政策',intro:`${COMPANY_NAME} 營運 LingYing 靈映，並對服務所收集的個人資料負責。本政策說明使用哪些資料、使用目的、可能的接收者及提出私隱要求的方法，涵蓋訪客、觀眾及創作者，包括免帳戶觀看免費集數的人士。`,summary:[
    '我們使用帳戶、內容、觀看及交易資料提供並保障 LingYing。免費訪客觀看仍涉及必要Cookie、播放統計及網絡處理。',
    '創作者只獲整體成效統計，不會透過報表獲得個別觀眾姓名、電郵、密碼或卡資料。',
    '託管、支付、登入及電郵供應商可能處理資料，包括在香港以外處理。我們不儲存完整付款卡號或您的 Google、Apple 密碼。',
    '請聯絡我們申請查閱、更正資料或刪除帳戶／資料。要求由支援人員處理；法律、會計、爭議及安全紀錄可能須保留。',
  ],sections:[
    {id:'data-controller',title:'1. 責任主體及聯絡方式',paragraphs:[`服務由 ${COMPANY_NAME} 營運。如有私隱問題、查閱或更正要求、結束帳戶要求，或擔心上傳內容包含個人資料，請聯絡 ${CONTACT_EMAIL}。說明要求時，請勿提供密碼或完整付款卡資料。`],contact:true},
    {id:'data-collected',title:'2. 所收集的資料',paragraphs:[
      '帳戶及身份資料包括姓名、電郵、語言、帳戶角色及狀態、身份驗證服務商識別碼、時間紀錄及儲存額度。密碼註冊使用加鹽雜湊值，不儲存明文密碼。Google 或 Apple 登入可提供帳戶識別碼、姓名及電郵，包括 Apple 轉送電郵；我們不要求 Google 或 Apple 密碼、Gmail 郵件、通訊錄或 Drive 檔案，也不為登入儲存其存取或更新權杖。',
      '內容及活動資料包括上傳影片、美術、標題、描述、分類及所聲明的語言；公開發布者資料；讚好、片單、觀看進度、播放事件、觀看時間及相關整體統計。與帳戶相關或隨機訪客識別碼會經雜湊處理作播放統計用途。雜湊是一項保障措施，並非資料完全匿名的保證。',
      '交易及支援資料包括付款和購買識別碼、金額及貨幣、錢包和創作者帳目、通行證狀態、與通行證付款相關的政策及確認版本、接受時間及語言、提領申請、關聯支付帳戶參考、欺詐或付款覆核、審核紀錄及您寄給我們的訊息。託管及安全系統可能處理IP位址、請求時間、瀏覽器／裝置資料及診斷紀錄。應用程式的播放統計紀錄不儲存原始IP位址，但網絡傳送、安全及速率限制可能處理IP。',
    ]},
    {id:'purposes',title:'3. 使用目的及可選資料',paragraphs:[
      '資料用於身份驗證、觀看、購買及發布服務、記憶選項、處理和核對付款、計算創作者統計、內容及權利投訴覆核、預防濫用、排解故障、回應支援要求，以及履行法律或監管義務。我們只按上述用途或法律允許的直接相關用途使用資料。與原收集目的無直接關係的新用途，將按需要另行通知並取得同意。',
      '註冊及帳戶服務需要準確帳戶資料；相應付款及發布服務需要相關交易資料。您可免註冊瀏覽及觀看標示免費的集數。可選的個人檔案資料及上傳內容由您自行選擇提供。如未提供核實付款、身份或投訴所必需的資料，我們可能無法提供該項服務或完成要求。',
      '建立帳戶或購買通行證不會被視為同意無關的直接促銷。如日後引入直接促銷，我們會提供適用法律要求的通知、選擇及同意機制。本政策不另外授權將創作者上傳內容用於與服務無關的AI訓練。',
    ]},
    {id:'cookies',title:'4. Cookie、瀏覽器儲存及地區價格顯示',paragraphs:[
      '應用程式以安全、HTTP-only工作階段Cookie維持登入，並在訪客開始播放時使用獨立的隨機訪客Cookie。這些應用程式Cookie目前有效期為30天。短期登入Cookie會將 Google 或 Apple 身份驗證嘗試與瀏覽器連結。Cookie到期日並不是相關商業或播放紀錄的保留期限。',
      '瀏覽器本機儲存記憶介面語言；工作階段儲存可能在註冊期間暫存您主動輸入的優惠碼。瀏覽器或已安裝應用程式亦可能儲存靜態檔案。您可透過瀏覽器清除儲存或管理Cookie，但登入、購買、偏好及部分統計或功能可能無法正常使用。',
      'Cloudflare 可能提供概略國家資料，以顯示本地貨幣價格估算；這不需要GPS定位。匯率服務只取得估算所需的貨幣組合，不會收到您的 LingYing 帳戶資料。託管、傳送及安全供應商亦可能使用自身的營運統計及紀錄；其服務與本政策所述的應用程式播放統計分開說明。',
    ]},
    {id:'providers-transfers',title:'5. 服務供應商、披露及跨境處理',paragraphs:[
      'Cloudflare 提供託管、傳送、安全、資料庫及物件儲存基礎設施。Stripe 提供卡資料輸入頁及處理付款；配置提領服務後，Stripe Connect 可能處理創作者身份及銀行驗證。我們保留交易紀錄和參考，不儲存完整卡號。如使用 Google 或 Apple 登入，相關供應商按自身私隱條款驗證身份。已配置的電郵傳送服務（例如 Cloudflare Email Sending 或 Resend）會收到收件人地址及其傳送的帳戶安全訊息或連結。',
      '我們可向按所述用途提供服務的供應商、專業顧問、依法有權要求的機關，或為調查欺詐、安全事件、法律申索及權利投訴而必要的相關人士，提供合理所需資料。為讓受影響上傳者公平回應，可能分享必要投訴詳情；在可行情況下，會保留或遮蓋不必要的個人資料。我們不出售個人資料。',
      '供應商可能在香港或您居住地以外處理及儲存資料。我們會尋求適當的合約及安全安排，以保障供應商的處理及保留，並遵守適用法律。您直接向供應商提供的資料亦受其私隱條款規管。我們不保證所有資料只留在某個國家。',
    ]},
    {id:'public-information',title:'6. 公開資料及其他紀錄的存取',paragraphs:[
      '已發布劇集、封面、描述、公開創作者或發布者名稱、聲明的內容語言、公開檔案日期，以及顯示的觀看及讚好數字，可能被其他訪客及搜尋引擎查看。上傳前請考慮披露內容。除非具備適當合法依據，並了解他人可能複製，否則不要將私人個人資料放入公開欄位。',
      '創作者會取得與自己作品相關的整體觀看、觀看時間、讚好、付費解鎖及不同付費用戶人數，包括每日或每集摘要。這些報表不提供個別觀眾姓名、電郵、密碼、付款卡資料或個人觀看歷史。獲授權管理員可按服務管理及覆核需要，存取帳戶、內容、財務、儲存、支援及審核紀錄。',
    ]},
    {id:'retention',title:'7. 保留、內容移除及結束帳戶',paragraphs:[
      '我們只在達成本政策所述用途合理所需的期間內保留個人資料，包括服務關係、交易及稅務紀錄、爭議處理、權利投訴、安全及其他法律義務。我們會檢視保留需要，並在不再需要時移除或匿名化資料，但合法保留、營運備份或移除程序可能適用。並非所有紀錄都適用同一保留期限。',
      '刪除劇集可移除公開內容及相關觀看、讚好和片單紀錄，但為正當商業及法律用途所需的有限內容參考、購買／帳目紀錄及審核歷史可能保留。媒體移除或備份程序可能需要額外時間。結束帳戶或刪除要求不會自動抹除法律、會計、預防欺詐或未解決爭議所需紀錄。',
    ]},
    {id:'security',title:'8. 資料安全',paragraphs:[
      '我們採取合理的組織及技術措施，包括受控帳戶存取、密碼雜湊、受保護的工作階段機制及私人媒體授權存取，並按服務職責限制權限。任何互聯網服務、傳送方法或儲存系統均不能保證完全安全；這些措施並不保證濫用或外洩絕不發生。',
      '請保管登入憑證，並在懷疑帳戶被濫用或資料意外披露時及時聯絡我們。我們會評估安全事件，並按適用法律要求作出通知。請勿在支援訊息中提交密碼、完整卡資料或不必要的敏感文件。',
    ]},
    {id:'privacy-rights',title:'9. 查閱、更正及其他私隱要求',paragraphs:[
      `如欲查閱或更正個人資料、查詢其使用方式、要求結束帳戶或刪除資料，或提出私隱投訴，請聯絡 ${CONTACT_EMAIL} 並提供帳戶及要求內容。我們可能要求相稱的核實或必要資料，以尋找紀錄並保障他人私隱。要求由支援人員處理，而非透過自動刪除帳戶或匯出工具。`,
      '我們會在適用法定期限內處理要求、解釋任何合法拒絕或限制，並在產生法律允許的費用前通知您。香港查閱及更正資料要求一般有40天回應期限，惟須遵守相關法定規定及例外；這並非承諾在40天內刪除所有紀錄。刪除及資料可攜要求視乎適用於您的法律權利，並非無限權利。香港個人資料問題未獲解決時，您可向個人資料私隱專員公署或其他適用主管機關提出。本政策不限制法定投訴或救濟。',
    ],contact:true},
    {id:'children',title:'10. 兒童及他人的資料',paragraphs:[
      '本服務並非以兒童為對象。購買、創作者發布及提領受使用條款的資格規定限制。我們不聲稱核實每位訪客年齡。如您認為兒童不適當地提交個人資料，或某項上傳違法披露他人資料，請聯絡我們評估移除及其他適當措施。',
    ],contact:true},
    {id:'privacy-changes',title:'11. 政策更新',paragraphs:[
      '資料處理、服務或法律要求改變時，我們可更新本政策，並以生效日期及版本識別本通知。重大變更會以適當方式通知，並在需要時取得同意。更新政策本身並不授權將過往已收集的個人資料用於不相容的新用途。',
    ]},
  ]},
};

const zhCN:LegalPolicyCopy={
  effective:'生效日期',date:'2026年11月8日',version:'版本',contents:'本页内容',summary:'重点摘要',contact:'联系公司',languages:'政策语言',related:'相关政策',fallback:en.fallback,
  terms:{title:'使用条款',intro:`本条款说明使用 LingYing 灵映的条件。平台由 ${COMPANY_NAME}（下称“公司”“我们”）运营，并在与您构成有效协议的范围内适用。请在注册、购买 Dramio Pass 或发布内容前阅读本条款。法律规定不得排除的权利仍然适用。`,summary:[
    'Dramio Pass 提供发布功能的使用权。购买通行证不保证内容获批、宣传、观看次数、销售、营收或收入；收益可能为零。',
    '您必须拥有上传内容所需的全部权利。公司可限制或移除侵权、违法或不适当的内容。',
    '公司对内部复核程序作最终决定，但仍须遵守适用法律、纠正错误，并保留您向法院、监管机构或支付服务商提出争议的权利。',
    '退款、已有收益及已购访问权须按相关交易条款及法律处理；本条款不允许任意没收款项，也不排除强制性消费者保护。',
  ],sections:[
    {id:'using-lingying',title:'1. 账户、资格及免费观看',paragraphs:[
      '标示为免费的集数可免注册、免登录观看。付费解锁、钱包充值及创作者发布功能需要相应账户及权限。拥有账户并不代表可观看所有集数。',
      '购买、发布内容或申请提现者须年满18岁，并具备订立合同的法律能力。未满18岁人士只可在家长或监护人同意下浏览合法且适龄的内容。请提供准确资料、保管登录凭证，并及时报告疑似未经授权的访问。不得分享或出售账户、冒充他人或规避限制。',
    ]},
    {id:'creator-pass',title:'2. Dramio Pass：发布权限，不保证成果',paragraphs:[
      '开启新的通行证结账前，请阅读本条款、知悉隐私政策，并通过必填确认框明确确认成果不获保证。我们会记录所接受的版本、语言、时间及相关付款，作为该项确认的记录。这不构成对无关直接营销的同意。',
      'Dramio Pass 是使用购买时所描述的创作者发布功能的一次性付款，并受本条款、账户资格、内容审核及技术限制约束。标准价格为一次港币88元；有效优惠可能改变结账显示的金额。实际以港币收费，其他货币显示仅供估算。通行证并非购买观众、广告、投资回报或雇佣关系。',
      '购买通行证、上传内容或获平台推荐，均不保证审核通过、分发、推荐曝光、最低观看次数、关注者、付费解锁、销售、营收、收入，也不保证收回制作费或通行证成本。收益可能为零。成果取决于观众需求、内容、定价、合法可用性及其他因素。示例、估算、宣传用语及其他创作者的成果，均非对您成果的承诺。',
      '一般发布者目前获5 GiB存储额度，管理员自有媒体的权限可能不同。目前每集输入文件上限为4分钟及200 MiB，封面另有上限。增加存储额度或其他服务须另行批准及报价。通行证不豁免内容审核，也不提供无条件永久托管的权利。',
    ]},
    {id:'content-rights',title:'3. 您的内容及平台运营授权',paragraphs:[
      '您保留依法享有的内容权利，并确认已取得上传、存储、展示、串流及营利所需的一切许可，包括视频、音乐、剧本、美术、商标、表演、个人资料、声音及肖像。标示为AI生成或AI辅助，不等于已确立所有权、清除第三方权利或免除侵权责任。请准确描述制作方式及语言。',
      '您授予公司非独家、全球性的许可，让公司及其服务供应商在运营、保障 LingYing 及宣传内容在平台上可用所需的范围内，托管、复制、技术处理、转换格式、展示及串流所提交内容。这不转移所有权，也不授权与服务无关的利用。移除内容后，未来公开使用会在可行情况下停止，但为现有交易、法律义务、争议、安全、备份或移除程序所需的有限副本及记录可能保留。',
    ]},
    {id:'acceptable-use',title:'4. 可接受使用及禁止内容',paragraphs:['不得利用 LingYing 违反法律、侵犯他人权利或破坏服务安全，尤其不得上传或从事：'],items:[
      '侵犯版权或商标、盗用或未经授权的媒体、冒充他人、虚报所有权，或滥用他人声音及肖像。',
      '儿童性虐待或剥削、未经同意的性影像、违法性内容，或危害、剥削儿童的内容。',
      '违法仇恨内容、可信威胁、针对性骚扰、公开私人资料、欺诈、诈骗或其他违法或严重有害行为。',
      '恶意软件、未经授权访问、滥用付款、伪造自动观看或购买、操纵统计，或规避访问、审核及存储限制。',
    ]},
    {id:'content-removal',title:'5. 审核、限制及下架',paragraphs:[
      '如公司合理认为有必要处理疑似侵权、违法或不适当内容、违反本条款、安全、预防欺诈、法律要求，或保护用户及服务，公司保留拒绝发布、限制推荐、限制访问、暂停账户、隐藏或移除内容的权利。支付通行证费用不代表公司必须发布或持续托管某项作品。',
      '在紧急情况下，公司可不事先通知而采取限制或下架措施。在合理可行且合法的情况下，我们会解释措施，并让受影响创作者提供资料申请复核。如披露详情会造成法律、隐私、安全或保安风险，我们可能不予披露。申请复核时，请提供内容网址、账户资料及支持证据。',
      '创作者也可通过现有工具隐藏或删除自己的剧集。即使某集已解锁，下架仍可能终止观看；购买记录并不保证永久供应。下架本身不会抹除交易记录、决定退款申请，或没收合法已累积的收益；相关事宜须按适用条款及法律另行复核。',
    ],contact:true},
    {id:'copyright-reports',title:'6. 版权及其他权利投诉',paragraphs:[
      `请将权利投诉寄至 ${CONTACT_EMAIL}，并提供姓名及联系资料、受影响作品及 LingYing 网址、所主张或代表的权利、所有权或授权证明，以及真诚说明涉嫌侵权的原因和所要求的处理方式。请勿提交不必要的身份证明文件或明知不实的指控。`,
      '复核期间，我们可限制有关内容，并向上传者查询。上传者可提供授权、所有权、同意或其他合法依据的证据。我们会考虑相关证据及适用法律，但不保证恢复内容。为公平回应投诉，必要资料可能在适当保护个人资料的情况下与相关人士分享。本程序不取代任何法定通知程序或法院救济。',
    ],contact:true},
    {id:'purchases-refunds',title:'7. 价格、钱包、集数访问及退款',paragraphs:[
      '确认付款前，请查阅价格、货币、优惠及服务描述。钱包额度及集数价格以美元记账；钱包仅供在 LingYing 购物，不提供现金提现功能。价格变动不会追溯改变已完成交易。适用税项、汇兑或支付服务商费用，以交易所展示的资料及适用法律为准。',
      '通行证费用购买的是发布权限，而非指定商业成果。观看或收益未如理想，本身不会产生“保证成果”的退款权利。但本条款不排除法律要求的退款或其他救济，包括已付款服务未获提供或描述失实。请提供收据或付款编号及问题，让我们复核适当处理方式；请勿提供完整卡号。',
      '本条款不概括豁免退款、拒付或其他消费者权利。失败、重复、未经授权或有争议的付款，以及丧失已付款访问权，均按实际情况复核。内容下架或账户结束，不会自动成立或自动否定退款申请。',
    ],contact:true},
    {id:'creator-earnings',title:'8. 创作者营收、费用及提现',paragraphs:[
      '有效付费集数解锁在扣除实际 Stripe 或其他交易服务商费用前，按70%分配予创作者、30%分配予平台。实际服务商费用由创作者70%的份额内承担，可能包括固定费、汇兑及银行费用。费用并非保证为1%，也不是额外固定的 LingYing 费用。显示的估算不保证最终银行到账金额。测试或模拟余额及提现并非真实收益。',
      '新提现申请目前最低为10美元，不另收平台提现费。处理时间为提交后3至5天，但受复核、可用收益、必要验证、合法保留及服务商可用性影响；银行到账可能需更长时间。现有申请保留其已存储的交易条款。创作者提现可独立于顾客刷卡付款而暂停；购买通行证不会启用或保证提现。',
      '平台观看及观看时间数字是所记录播放活动的估算，并非经审计的独立观众人数或收益保证。错误更正、无效活动、退款、拒付或权利争议，可能须根据证据复核及依法调整。公司不会仅因下架作品或创作者提出投诉而任意没收合法已累积款项；厘定应付款项期间，可作相称的复核保留。您须自行履行税务及申报义务。',
    ]},
    {id:'disputes',title:'9. 公司复核及争议决定',paragraphs:[
      `如对通行证、观看次数、收入、营收分配、提现、审核或访问有争议，请联系 ${CONTACT_EMAIL}，并提供相关账户、付款编号或内容网址、清楚说明、支持证据及希望获得的处理结果。我们可要求核实及调查所合理需要的资料。`,
      '公司在内部复核程序中拥有最终决定权，并会合理、真诚地考虑适用条款、记录及证据。我们可更正错误，或在获得重要新证据后重新考虑决定；在合理可行且合法的情况下，会解释处理结果。',
      '内部决定并非对您法律权利具约束力的裁定，也不妨碍您使用强制性消费者救济、有管辖权的法院、监管机构或适用支付服务商的争议程序。任何条款均不使公司成为法律保留予上述机构之事项的最终裁决者。',
    ],contact:true},
    {id:'availability-liability',title:'10. 服务供应、责任及法律限制',paragraphs:[
      '我们会以合理谨慎方式运营服务，但不承诺访问永不中断、服务毫无错误、永久托管、指定观众人数或商业成功。请自行备份上传作品。第三方服务及合法内容限制可能影响供应。',
      '在法律允许的范围内，我们不对不可预见或间接的商业损失、预期利润损失，或因您违约及我们合理控制范围以外事项所造成的损失负责。本条款不排除或限制依法不得排除的责任，包括适用的欺诈责任、因疏忽导致死亡或人身伤害的责任、强制性消费者救济或个人资料责任。',
      '创作者须对自己的违法上传或侵犯他人权利负责。在合法范围内，创作者须承担因该等违反而引起第三方索偿的合理损失及费用，并应及时获通知及有合理回应机会。这不涵盖公司自身不当行为所造成的损失，也不剥夺法律提供的抗辩或保护。',
    ]},
    {id:'changes-law',title:'11. 条款变更、适用法律及联系',paragraphs:[
      '我们可因服务、法律或合理运营需要而向将来更新本条款。重大变更会通过适当服务通知提醒用户，并在法律要求时征求同意。新版本不追溯改写已完成交易，也不证明现有用户曾接受该版本。不可执行的条款只会在法律允许下予以限制或分割，其余合法条款继续适用。',
      `在法律允许的范围内，适用香港法律，争议由依法有管辖权的法院处理。您居住地适用的强制性保护及争议权利仍予保留。如有问题或投诉，请联系 ${COMPANY_NAME}：${CONTACT_EMAIL}。`,
    ],contact:true},
  ]},
  privacy:{title:'隐私政策',intro:`${COMPANY_NAME} 运营 LingYing 灵映，并对服务所收集的个人资料负责。本政策说明使用哪些资料、使用目的、可能的接收者及提出隐私要求的方法，涵盖访客、观众及创作者，包括免账户观看免费集数的人士。`,summary:[
    '我们使用账户、内容、观看及交易资料提供并保护 LingYing。免费访客观看仍涉及必要Cookie、播放统计及网络处理。',
    '创作者只获整体成效统计，不会通过报表获得个别观众姓名、电邮、密码或卡资料。',
    '托管、支付、登录及电邮供应商可能处理资料，包括在香港以外处理。我们不存储完整付款卡号或您的 Google、Apple 密码。',
    '请联系我们申请查阅、更正资料或删除账户／资料。要求由支持人员处理；法律、会计、争议及安全记录可能须保留。',
  ],sections:[
    {id:'data-controller',title:'1. 责任主体及联系方式',paragraphs:[`服务由 ${COMPANY_NAME} 运营。如有隐私问题、查阅或更正要求、结束账户要求，或担心上传内容包含个人资料，请联系 ${CONTACT_EMAIL}。说明要求时，请勿提供密码或完整付款卡资料。`],contact:true},
    {id:'data-collected',title:'2. 所收集的资料',paragraphs:[
      '账户及身份资料包括姓名、电邮、语言、账户角色及状态、身份验证服务商识别码、时间记录及存储额度。密码注册使用加盐哈希值，不存储明文密码。Google 或 Apple 登录可提供账户识别码、姓名及电邮，包括 Apple 转发电邮；我们不要求 Google 或 Apple 密码、Gmail 邮件、通讯录或 Drive 文件，也不为登录存储其访问或刷新令牌。',
      '内容及活动资料包括上传视频、美术、标题、描述、分类及所声明的语言；公开发布者资料；点赞、片单、观看进度、播放事件、观看时间及相关整体统计。与账户相关或随机访客识别码会经哈希处理作播放统计用途。哈希是一项保护措施，并非资料完全匿名的保证。',
      '交易及支持资料包括付款和购买识别码、金额及货币、钱包和创作者账目、通行证状态、与通行证付款相关的政策及确认版本、接受时间及语言、提现申请、关联支付账户参考、欺诈或付款复核、审核记录及您寄给我们的消息。托管及安全系统可能处理IP地址、请求时间、浏览器／设备资料及诊断记录。应用程序的播放统计记录不存储原始IP地址，但网络传送、安全及速率限制可能处理IP。',
    ]},
    {id:'purposes',title:'3. 使用目的及可选资料',paragraphs:[
      '资料用于身份验证、观看、购买及发布服务、记忆选项、处理和核对付款、计算创作者统计、内容及权利投诉复核、预防滥用、排查故障、回应支持要求，以及履行法律或监管义务。我们只按上述用途或法律允许的直接相关用途使用资料。与原收集目的无直接关系的新用途，将按需要另行通知并取得同意。',
      '注册及账户服务需要准确账户资料；相应付款及发布服务需要相关交易资料。您可免注册浏览及观看标示免费的集数。可选的个人档案资料及上传内容由您自行选择提供。如未提供核实付款、身份或投诉所必需的资料，我们可能无法提供该项服务或完成要求。',
      '建立账户或购买通行证不会被视为同意无关的直接营销。如日后引入直接营销，我们会提供适用法律要求的通知、选择及同意机制。本政策不另外授权将创作者上传内容用于与服务无关的AI训练。',
    ]},
    {id:'cookies',title:'4. Cookie、浏览器存储及地区价格显示',paragraphs:[
      '应用程序以安全、HTTP-only会话Cookie维持登录，并在访客开始播放时使用独立的随机访客Cookie。这些应用程序Cookie目前有效期为30天。短期登录Cookie会将 Google 或 Apple 身份验证尝试与浏览器关联。Cookie到期日并不是相关商业或播放记录的保留期限。',
      '浏览器本地存储记忆界面语言；会话存储可能在注册期间暂存您主动输入的优惠码。浏览器或已安装应用程序也可能存储静态文件。您可通过浏览器清除存储或管理Cookie，但登录、购买、偏好及部分统计或功能可能无法正常使用。',
      'Cloudflare 可能提供概略国家资料，以显示本地货币价格估算；这不需要GPS定位。汇率服务只取得估算所需的货币组合，不会收到您的 LingYing 账户资料。托管、传送及安全供应商也可能使用自身的运营统计及记录；其服务与本政策所述的应用程序播放统计分开说明。',
    ]},
    {id:'providers-transfers',title:'5. 服务供应商、披露及跨境处理',paragraphs:[
      'Cloudflare 提供托管、传送、安全、数据库及对象存储基础设施。Stripe 提供卡资料输入页及处理付款；配置提现服务后，Stripe Connect 可能处理创作者身份及银行验证。我们保留交易记录和参考，不存储完整卡号。如使用 Google 或 Apple 登录，相关供应商按自身隐私条款验证身份。已配置的电邮传送服务（例如 Cloudflare Email Sending 或 Resend）会收到收件人地址及其传送的账户安全消息或链接。',
      '我们可向按所述用途提供服务的供应商、专业顾问、依法有权要求的机关，或为调查欺诈、安全事件、法律申索及权利投诉而必要的相关人士，提供合理所需资料。为让受影响上传者公平回应，可能分享必要投诉详情；在可行情况下，会保留或遮盖不必要的个人资料。我们不出售个人资料。',
      '供应商可能在香港或您居住地以外处理及存储资料。我们会寻求适当的合同及安全安排，以保护供应商的处理及保留，并遵守适用法律。您直接向供应商提供的资料也受其隐私条款规范。我们不保证所有资料只留在某个国家。',
    ]},
    {id:'public-information',title:'6. 公开资料及其他记录的访问',paragraphs:[
      '已发布剧集、封面、描述、公开创作者或发布者名称、声明的内容语言、公开档案日期，以及显示的观看及点赞数字，可能被其他访客及搜索引擎查看。上传前请考虑披露内容。除非具备适当合法依据，并了解他人可能复制，否则不要将私人个人资料放入公开字段。',
      '创作者会取得与自己作品相关的整体观看、观看时间、点赞、付费解锁及不同付费用户人数，包括每日或每集摘要。这些报表不提供个别观众姓名、电邮、密码、付款卡资料或个人观看历史。获授权管理员可按服务管理及复核需要，访问账户、内容、财务、存储、支持及审核记录。',
    ]},
    {id:'retention',title:'7. 保留、内容移除及结束账户',paragraphs:[
      '我们只在达成本政策所述用途合理所需的期间内保留个人资料，包括服务关系、交易及税务记录、争议处理、权利投诉、安全及其他法律义务。我们会检视保留需要，并在不再需要时移除或匿名化资料，但合法保留、运营备份或移除程序可能适用。并非所有记录都适用同一保留期限。',
      '删除剧集可移除公开内容及相关观看、点赞和片单记录，但为正当商业及法律用途所需的有限内容参考、购买／账目记录及审核历史可能保留。媒体移除或备份程序可能需要额外时间。结束账户或删除要求不会自动抹除法律、会计、预防欺诈或未解决争议所需记录。',
    ]},
    {id:'security',title:'8. 资料安全',paragraphs:[
      '我们采取合理的组织及技术措施，包括受控账户访问、密码哈希、受保护的会话机制及私人媒体验证访问，并按服务职责限制权限。任何互联网服务、传送方法或存储系统均不能保证完全安全；这些措施并不保证滥用或泄露绝不发生。',
      '请保管登录凭证，并在怀疑账户被滥用或资料意外披露时及时联系我们。我们会评估安全事件，并按适用法律要求作出通知。请勿在支持消息中提交密码、完整卡资料或不必要的敏感文件。',
    ]},
    {id:'privacy-rights',title:'9. 查阅、更正及其他隐私要求',paragraphs:[
      `如欲查阅或更正个人资料、查询其使用方式、要求结束账户或删除资料，或提出隐私投诉，请联系 ${CONTACT_EMAIL} 并提供账户及要求内容。我们可能要求相称的核实或必要资料，以寻找记录并保护他人隐私。要求由支持人员处理，而非通过自动删除账户或导出工具。`,
      '我们会在适用法定期限内处理要求、解释任何合法拒绝或限制，并在产生法律允许的费用前通知您。香港查阅及更正资料要求一般有40天回应期限，惟须遵守相关法定规定及例外；这并非承诺在40天内删除所有记录。删除及资料可携要求视乎适用于您的法律权利，并非无限权利。香港个人资料问题未获解决时，您可向个人资料私隐专员公署或其他适用主管机关提出。本政策不限制法定投诉或救济。',
    ],contact:true},
    {id:'children',title:'10. 儿童及他人的资料',paragraphs:[
      '本服务并非以儿童为对象。购买、创作者发布及提现受使用条款的资格规定限制。我们不声称核实每位访客年龄。如您认为儿童不适当地提交个人资料，或某项上传违法披露他人资料，请联系我们评估移除及其他适当措施。',
    ],contact:true},
    {id:'privacy-changes',title:'11. 政策更新',paragraphs:[
      '资料处理、服务或法律要求改变时，我们可更新本政策，并以生效日期及版本识别本通知。重大变更会以适当方式通知，并在需要时取得同意。更新政策本身并不授权将过往已收集的个人资料用于不兼容的新用途。',
    ]},
  ]},
};

export const legalPolicyContent:Record<LegalLocale,LegalPolicyCopy>={en,'zh-TW':zhTW,'zh-CN':zhCN};
