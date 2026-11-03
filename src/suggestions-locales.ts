import type {Locale} from '../shared/config';

export const suggestionsEnglish={
  "suggestedByLingYing": "Suggested by LingYing",
  "suggestOnHome": "Suggest on homepage",
  "removeSuggestion": "Remove suggestion",
  "suggestionSaved": "Homepage suggestion updated.",
  "suggestionUnavailable": "Only published, available series with episodes can be suggested.",
  "carouselPause": "Pause slideshow",
  "carouselResume": "Resume slideshow",
  "suggestionSaveFailed": "Could not update the suggestion. Please try again."
} as const;
export type SuggestionsKey=keyof typeof suggestionsEnglish;
type SuggestionsCopy=Record<SuggestionsKey,string>;

export const suggestionsMessages:Record<Locale,SuggestionsCopy>={
  "en": {
    "suggestedByLingYing": "Suggested by LingYing",
    "suggestOnHome": "Suggest on homepage",
    "removeSuggestion": "Remove suggestion",
    "suggestionSaved": "Homepage suggestion updated.",
    "suggestionUnavailable": "Only published, available series with episodes can be suggested.",
    "carouselPause": "Pause slideshow",
    "carouselResume": "Resume slideshow",
    "suggestionSaveFailed": "Could not update the suggestion. Please try again."
  },
  "zh-TW": {
    "suggestedByLingYing": "靈映推薦",
    "suggestOnHome": "設為首頁推薦",
    "removeSuggestion": "取消推薦",
    "suggestionSaved": "首頁推薦已更新。",
    "suggestionUnavailable": "只有已發佈、可公開觀看且至少有一集的劇集才能設為推薦。",
    "carouselPause": "暫停輪播",
    "carouselResume": "繼續輪播",
    "suggestionSaveFailed": "無法更新推薦，請再試一次。"
  },
  "zh-CN": {
    "suggestedByLingYing": "灵映推荐",
    "suggestOnHome": "设为首页推荐",
    "removeSuggestion": "取消推荐",
    "suggestionSaved": "首页推荐已更新。",
    "suggestionUnavailable": "只有已发布、可公开观看且至少有一集的剧集才能设为推荐。",
    "carouselPause": "暂停轮播",
    "carouselResume": "继续轮播",
    "suggestionSaveFailed": "无法更新推荐，请重试。"
  },
  "ja": {
    "suggestedByLingYing": "LingYingのおすすめ",
    "suggestOnHome": "ホームのおすすめに追加",
    "removeSuggestion": "おすすめから削除",
    "suggestionSaved": "ホームのおすすめを更新しました。",
    "suggestionUnavailable": "公開済みで視聴可能、かつ1話以上ある作品のみ、おすすめに設定できます。",
    "carouselPause": "スライドショーを一時停止",
    "carouselResume": "スライドショーを再開",
    "suggestionSaveFailed": "おすすめを更新できませんでした。もう一度お試しください。"
  },
  "ko": {
    "suggestedByLingYing": "LingYing 추천",
    "suggestOnHome": "홈 추천에 추가",
    "removeSuggestion": "추천 해제",
    "suggestionSaved": "홈 추천을 업데이트했습니다.",
    "suggestionUnavailable": "게시되어 시청 가능하고 에피소드가 있는 작품만 추천할 수 있습니다.",
    "carouselPause": "슬라이드쇼 일시 정지",
    "carouselResume": "슬라이드쇼 다시 시작",
    "suggestionSaveFailed": "추천을 업데이트하지 못했습니다. 다시 시도해 주세요."
  },
  "hi": {
    "suggestedByLingYing": "LingYing की पसंद",
    "suggestOnHome": "मुखपृष्ठ पर सुझाएँ",
    "removeSuggestion": "सुझाव हटाएँ",
    "suggestionSaved": "मुखपृष्ठ का सुझाव अपडेट हो गया।",
    "suggestionUnavailable": "केवल प्रकाशित, उपलब्ध और एपिसोड वाली सीरीज़ का सुझाव दिया जा सकता है।",
    "carouselPause": "स्लाइडशो रोकें",
    "carouselResume": "स्लाइडशो फिर चलाएँ",
    "suggestionSaveFailed": "सुझाव अपडेट नहीं हो सका। कृपया फिर कोशिश करें।"
  },
  "id": {
    "suggestedByLingYing": "Rekomendasi LingYing",
    "suggestOnHome": "Rekomendasikan di beranda",
    "removeSuggestion": "Hapus rekomendasi",
    "suggestionSaved": "Rekomendasi beranda diperbarui.",
    "suggestionUnavailable": "Hanya serial yang sudah diterbitkan, tersedia untuk ditonton, dan memiliki episode yang dapat direkomendasikan.",
    "carouselPause": "Jeda tayangan slide",
    "carouselResume": "Lanjutkan tayangan slide",
    "suggestionSaveFailed": "Tidak dapat memperbarui rekomendasi. Silakan coba lagi."
  },
  "pt-BR": {
    "suggestedByLingYing": "Recomendado por LingYing",
    "suggestOnHome": "Recomendar na página inicial",
    "removeSuggestion": "Remover recomendação",
    "suggestionSaved": "Recomendação da página inicial atualizada.",
    "suggestionUnavailable": "Somente séries publicadas, disponíveis e com episódios podem ser recomendadas.",
    "carouselPause": "Pausar apresentação",
    "carouselResume": "Retomar apresentação",
    "suggestionSaveFailed": "Não foi possível atualizar a recomendação. Tente novamente."
  },
  "es": {
    "suggestedByLingYing": "Recomendado por LingYing",
    "suggestOnHome": "Recomendar en el inicio",
    "removeSuggestion": "Quitar recomendación",
    "suggestionSaved": "Recomendación de inicio actualizada.",
    "suggestionUnavailable": "Solo se pueden recomendar series publicadas, disponibles y con episodios.",
    "carouselPause": "Pausar presentación",
    "carouselResume": "Reanudar presentación",
    "suggestionSaveFailed": "No se pudo actualizar la recomendación. Inténtalo de nuevo."
  },
  "ar": {
    "suggestedByLingYing": "ترشيحات LingYing",
    "suggestOnHome": "ترشيح في الصفحة الرئيسية",
    "removeSuggestion": "إزالة الترشيح",
    "suggestionSaved": "تم تحديث ترشيح الصفحة الرئيسية.",
    "suggestionUnavailable": "لا يمكن ترشيح إلا المسلسلات المنشورة والمتاحة التي تحتوي على حلقات.",
    "carouselPause": "إيقاف العرض مؤقتًا",
    "carouselResume": "استئناف العرض",
    "suggestionSaveFailed": "تعذّر تحديث الترشيح. يُرجى المحاولة مجددًا."
  },
  "bn": {
    "suggestedByLingYing": "LingYing-এর সুপারিশ",
    "suggestOnHome": "হোমপেজে সুপারিশ করুন",
    "removeSuggestion": "সুপারিশ সরান",
    "suggestionSaved": "হোমপেজের সুপারিশ আপডেট হয়েছে।",
    "suggestionUnavailable": "শুধু প্রকাশিত, উপলব্ধ এবং পর্ব রয়েছে এমন সিরিজ সুপারিশ করা যাবে।",
    "carouselPause": "স্লাইডশো থামান",
    "carouselResume": "স্লাইডশো আবার চালান",
    "suggestionSaveFailed": "সুপারিশ আপডেট করা যায়নি। আবার চেষ্টা করুন।"
  },
  "ur": {
    "suggestedByLingYing": "LingYing کی تجویز",
    "suggestOnHome": "ہوم پیج پر تجویز کریں",
    "removeSuggestion": "تجویز ہٹائیں",
    "suggestionSaved": "ہوم پیج کی تجویز اپ ڈیٹ ہو گئی۔",
    "suggestionUnavailable": "صرف شائع شدہ، دستیاب اور اقساط والی سیریز تجویز کی جا سکتی ہے۔",
    "carouselPause": "سلائیڈ شو روکیں",
    "carouselResume": "سلائیڈ شو دوبارہ چلائیں",
    "suggestionSaveFailed": "تجویز اپ ڈیٹ نہیں ہو سکی۔ براہ کرم دوبارہ کوشش کریں۔"
  },
  "vi": {
    "suggestedByLingYing": "LingYing đề xuất",
    "suggestOnHome": "Đề xuất trên trang chủ",
    "removeSuggestion": "Bỏ đề xuất",
    "suggestionSaved": "Đã cập nhật đề xuất trên trang chủ.",
    "suggestionUnavailable": "Chỉ có thể đề xuất các bộ phim đã xuất bản, đang khả dụng và có tập phim.",
    "carouselPause": "Tạm dừng trình chiếu",
    "carouselResume": "Tiếp tục trình chiếu",
    "suggestionSaveFailed": "Không thể cập nhật đề xuất. Vui lòng thử lại."
  },
  "th": {
    "suggestedByLingYing": "LingYing แนะนำ",
    "suggestOnHome": "แนะนำบนหน้าแรก",
    "removeSuggestion": "ยกเลิกการแนะนำ",
    "suggestionSaved": "อัปเดตการแนะนำบนหน้าแรกแล้ว",
    "suggestionUnavailable": "แนะนำได้เฉพาะซีรีส์ที่เผยแพร่แล้ว เปิดให้รับชม และมีตอนแล้ว",
    "carouselPause": "หยุดสไลด์ชั่วคราว",
    "carouselResume": "เล่นสไลด์ต่อ",
    "suggestionSaveFailed": "อัปเดตการแนะนำไม่สำเร็จ โปรดลองอีกครั้ง"
  },
  "fil": {
    "suggestedByLingYing": "Mga rekomendasyon ng LingYing",
    "suggestOnHome": "Irekomenda sa homepage",
    "removeSuggestion": "Alisin ang rekomendasyon",
    "suggestionSaved": "Na-update ang rekomendasyon sa homepage.",
    "suggestionUnavailable": "Mga serye lang na nailathala, napapanood, at may mga episode ang maaaring irekomenda.",
    "carouselPause": "I-pause ang slideshow",
    "carouselResume": "Ipagpatuloy ang slideshow",
    "suggestionSaveFailed": "Hindi ma-update ang rekomendasyon. Pakisubukan ulit."
  },
  "tr": {
    "suggestedByLingYing": "LingYing önerisi",
    "suggestOnHome": "Ana sayfada öner",
    "removeSuggestion": "Öneriyi kaldır",
    "suggestionSaved": "Ana sayfa önerisi güncellendi.",
    "suggestionUnavailable": "Yalnızca yayımlanmış, erişilebilir ve bölümleri olan diziler önerilebilir.",
    "carouselPause": "Slayt gösterisini duraklat",
    "carouselResume": "Slayt gösterisini sürdür",
    "suggestionSaveFailed": "Öneri güncellenemedi. Lütfen tekrar deneyin."
  },
  "ru": {
    "suggestedByLingYing": "Рекомендует LingYing",
    "suggestOnHome": "Рекомендовать на главной",
    "removeSuggestion": "Убрать рекомендацию",
    "suggestionSaved": "Рекомендация на главной обновлена.",
    "suggestionUnavailable": "Рекомендовать можно только доступные опубликованные сериалы, в которых есть хотя бы одна серия.",
    "carouselPause": "Приостановить слайд-шоу",
    "carouselResume": "Продолжить слайд-шоу",
    "suggestionSaveFailed": "Не удалось обновить рекомендацию. Попробуйте ещё раз."
  },
  "fr": {
    "suggestedByLingYing": "Recommandé par LingYing",
    "suggestOnHome": "Recommander sur l’accueil",
    "removeSuggestion": "Retirer la recommandation",
    "suggestionSaved": "Recommandation de l’accueil mise à jour.",
    "suggestionUnavailable": "Seules les séries publiées, disponibles et comportant des épisodes peuvent être recommandées.",
    "carouselPause": "Mettre le diaporama en pause",
    "carouselResume": "Reprendre le diaporama",
    "suggestionSaveFailed": "Impossible de mettre à jour la recommandation. Réessayez."
  },
  "de": {
    "suggestedByLingYing": "Von LingYing empfohlen",
    "suggestOnHome": "Auf der Startseite empfehlen",
    "removeSuggestion": "Empfehlung entfernen",
    "suggestionSaved": "Empfehlung auf der Startseite aktualisiert.",
    "suggestionUnavailable": "Nur veröffentlichte und verfügbare Serien mit Folgen können empfohlen werden.",
    "carouselPause": "Diashow pausieren",
    "carouselResume": "Diashow fortsetzen",
    "suggestionSaveFailed": "Die Empfehlung konnte nicht aktualisiert werden. Bitte versuche es erneut."
  },
  "ms": {
    "suggestedByLingYing": "Cadangan LingYing",
    "suggestOnHome": "Cadangkan di halaman utama",
    "removeSuggestion": "Buang cadangan",
    "suggestionSaved": "Cadangan halaman utama dikemas kini.",
    "suggestionUnavailable": "Hanya siri yang telah diterbitkan, tersedia untuk ditonton dan mempunyai episod boleh dicadangkan.",
    "carouselPause": "Jeda tayangan slaid",
    "carouselResume": "Sambung tayangan slaid",
    "suggestionSaveFailed": "Cadangan tidak dapat dikemas kini. Sila cuba lagi."
  },
  "ta": {
    "suggestedByLingYing": "LingYing பரிந்துரை",
    "suggestOnHome": "முகப்பில் பரிந்துரை செய்",
    "removeSuggestion": "பரிந்துரையை நீக்கு",
    "suggestionSaved": "முகப்புப் பரிந்துரை புதுப்பிக்கப்பட்டது.",
    "suggestionUnavailable": "வெளியிடப்பட்டு, பார்க்கக் கிடைக்கும், அத்தியாயங்கள் உள்ள தொடர்களை மட்டுமே பரிந்துரைக்க முடியும்.",
    "carouselPause": "ஸ்லைடு காட்சியை இடைநிறுத்து",
    "carouselResume": "ஸ்லைடு காட்சியைத் தொடர்க",
    "suggestionSaveFailed": "பரிந்துரையைப் புதுப்பிக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்."
  }
};
