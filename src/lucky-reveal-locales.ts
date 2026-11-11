import type {Locale} from '../shared/config';
export const luckyRevealEnglish={luckyViewNow:'View it now',luckyWatchLater:'Close and watch later',luckySavedHint:'Saved in Your unlocked series. Come back here to watch later.',luckyUploadDate:'Upload date',luckyPublishedOn:'First published',luckyViewDetails:'View prize details',luckyUnlocked:'Unlocked'};
type Copy=Record<keyof typeof luckyRevealEnglish,string>;
const rows:Record<Exclude<Locale,'en'>,string[]>={
 'zh-TW':['立即觀看','關閉，稍後觀看','已儲存在「你已解鎖的劇集」，可稍後回來觀看。','上傳日期','首次發布','查看中獎詳情','已解鎖'],
 'zh-CN':['立即观看','关闭，稍后观看','已保存在“你已解锁的剧集”，可稍后回来观看。','上传日期','首次发布','查看中奖详情','已解锁'],
 ja:['今すぐ見る','閉じて後で見る','獲得したシリーズに保存済みです。後でここから視聴できます。','アップロード日','初回公開日','当選の詳細を見る','獲得済み'],
 ko:['지금 보기','닫고 나중에 보기','잠금 해제한 시리즈에 저장됐어요. 나중에 돌아와 시청하세요.','업로드 날짜','최초 공개일','당첨 정보 보기','잠금 해제됨'],
 hi:['अभी देखें','बंद करें, बाद में देखें','आपकी अनलॉक सीरीज़ में सहेज लिया गया है। बाद में यहाँ आकर देखें।','अपलोड की तारीख','पहली बार प्रकाशित','जीत का विवरण देखें','अनलॉक हुआ'],
 id:['Tonton sekarang','Tutup dan tonton nanti','Tersimpan di serial yang kamu buka. Kembali ke sini untuk menonton nanti.','Tanggal unggah','Pertama diterbitkan','Lihat detail hadiah','Terbuka'],
 'pt-BR':['Assistir agora','Fechar e assistir depois','Salva nas suas séries desbloqueadas. Volte aqui para assistir depois.','Data do envio','Primeira publicação','Ver detalhes do prêmio','Desbloqueada'],
 es:['Ver ahora','Cerrar y ver después','Guardada en tus series desbloqueadas. Vuelve aquí para verla después.','Fecha de subida','Primera publicación','Ver detalles del premio','Desbloqueada'],
 ar:['شاهد الآن','إغلاق والمشاهدة لاحقاً','حُفظ في مسلسلاتك المفتوحة. عد إلى هنا للمشاهدة لاحقاً.','تاريخ الرفع','تاريخ النشر الأول','عرض تفاصيل الجائزة','مفتوح'],
 bn:['এখনই দেখুন','বন্ধ করে পরে দেখুন','আপনার খোলা সিরিজে রাখা হয়েছে। পরে এখানে ফিরে দেখুন।','আপলোডের তারিখ','প্রথম প্রকাশ','পুরস্কারের বিবরণ দেখুন','খোলা হয়েছে'],
 ur:['ابھی دیکھیں','بند کریں اور بعد میں دیکھیں','آپ کی کھلی سیریز میں محفوظ ہے۔ بعد میں یہاں واپس آ کر دیکھیں۔','اپ لوڈ کی تاریخ','پہلی اشاعت','انعام کی تفصیل دیکھیں','کھول دیا گیا'],
 vi:['Xem ngay','Đóng và xem sau','Đã lưu trong phim bạn mở khóa. Quay lại đây để xem sau.','Ngày tải lên','Công bố lần đầu','Xem chi tiết phần thưởng','Đã mở khóa'],
 th:['ดูเลย','ปิดและดูภายหลัง','บันทึกไว้ในซีรีส์ที่คุณปลดล็อกแล้ว กลับมาดูที่นี่ภายหลังได้','วันที่อัปโหลด','เผยแพร่ครั้งแรก','ดูรายละเอียดรางวัล','ปลดล็อกแล้ว'],
 fil:['Panoorin ngayon','Isara at panoorin mamaya','Naka-save sa mga seryeng na-unlock mo. Bumalik dito para manood mamaya.','Petsa ng upload','Unang inilathala','Tingnan ang detalye ng premyo','Na-unlock'],
 tr:['Şimdi izle','Kapat ve sonra izle','Açtığın dizilere kaydedildi. Daha sonra buradan izleyebilirsin.','Yükleme tarihi','İlk yayın tarihi','Ödül ayrıntılarını gör','Açıldı'],
 ru:['Смотреть сейчас','Закрыть и посмотреть позже','Сохранено в открытых сериалах. Вернитесь сюда, чтобы посмотреть позже.','Дата загрузки','Первая публикация','Подробнее о призе','Открыто'],
 fr:['Regarder maintenant','Fermer et regarder plus tard','Enregistrée dans vos séries débloquées. Revenez ici pour la regarder plus tard.','Date de mise en ligne','Première publication','Voir le détail du prix','Débloquée'],
 de:['Jetzt ansehen','Schließen und später ansehen','Unter deinen freigeschalteten Serien gespeichert. Schau später hier vorbei.','Upload-Datum','Erstmals veröffentlicht','Gewinndetails ansehen','Freigeschaltet'],
 ms:['Tonton sekarang','Tutup dan tonton kemudian','Disimpan dalam siri yang anda buka. Kembali ke sini untuk menonton kemudian.','Tarikh muat naik','Terbitan pertama','Lihat butiran hadiah','Dibuka'],
 ta:['இப்போதே பார்க்கவும்','மூடி பின்னர் பார்க்கவும்','நீங்கள் திறந்த தொடர்களில் சேமிக்கப்பட்டது. பின்னர் இங்கே வந்து பார்க்கலாம்.','பதிவேற்றிய தேதி','முதலில் வெளியானது','பரிசு விவரங்களைப் பார்க்கவும்','திறக்கப்பட்டது'],
};
const keys=Object.keys(luckyRevealEnglish) as Array<keyof Copy>;
export const luckyRevealMessages=Object.fromEntries(Object.entries(rows).map(([locale,row])=>[locale,Object.fromEntries(keys.map((key,index)=>[key,row[index]]))])) as Record<Exclude<Locale,'en'>,Copy>;
