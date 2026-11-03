import type {Locale} from '../shared/config';

export const videoBrandEnglish={
  videoEnterFullscreen:'Enter fullscreen',
  videoExitFullscreen:'Exit fullscreen',
} as const;
type VideoBrandCopy=Record<keyof typeof videoBrandEnglish,string>;
export const videoBrandMessages:Record<Locale,VideoBrandCopy>={
  en:videoBrandEnglish,
  'zh-TW':{videoEnterFullscreen:'進入全螢幕',videoExitFullscreen:'離開全螢幕'},
  'zh-CN':{videoEnterFullscreen:'进入全屏',videoExitFullscreen:'退出全屏'},
  ja:{videoEnterFullscreen:'全画面表示にする',videoExitFullscreen:'全画面表示を終了'},
  ko:{videoEnterFullscreen:'전체 화면으로 보기',videoExitFullscreen:'전체 화면 종료'},
  hi:{videoEnterFullscreen:'पूर्ण स्क्रीन खोलें',videoExitFullscreen:'पूर्ण स्क्रीन से बाहर निकलें'},
  id:{videoEnterFullscreen:'Masuk layar penuh',videoExitFullscreen:'Keluar layar penuh'},
  'pt-BR':{videoEnterFullscreen:'Entrar em tela cheia',videoExitFullscreen:'Sair da tela cheia'},
  es:{videoEnterFullscreen:'Entrar en pantalla completa',videoExitFullscreen:'Salir de pantalla completa'},
  ar:{videoEnterFullscreen:'الدخول إلى ملء الشاشة',videoExitFullscreen:'الخروج من ملء الشاشة'},
  bn:{videoEnterFullscreen:'পূর্ণ পর্দায় দেখুন',videoExitFullscreen:'পূর্ণ পর্দা থেকে বের হন'},
  ur:{videoEnterFullscreen:'پوری اسکرین کھولیں',videoExitFullscreen:'پوری اسکرین سے باہر نکلیں'},
  vi:{videoEnterFullscreen:'Vào chế độ toàn màn hình',videoExitFullscreen:'Thoát chế độ toàn màn hình'},
  th:{videoEnterFullscreen:'เข้าสู่โหมดเต็มหน้าจอ',videoExitFullscreen:'ออกจากโหมดเต็มหน้าจอ'},
  fil:{videoEnterFullscreen:'Pumasok sa fullscreen',videoExitFullscreen:'Lumabas sa fullscreen'},
  tr:{videoEnterFullscreen:'Tam ekrana geç',videoExitFullscreen:'Tam ekrandan çık'},
  ru:{videoEnterFullscreen:'На весь экран',videoExitFullscreen:'Выйти из полноэкранного режима'},
  fr:{videoEnterFullscreen:'Passer en plein écran',videoExitFullscreen:'Quitter le plein écran'},
  de:{videoEnterFullscreen:'Vollbild öffnen',videoExitFullscreen:'Vollbild beenden'},
  ms:{videoEnterFullscreen:'Masuk skrin penuh',videoExitFullscreen:'Keluar skrin penuh'},
  ta:{videoEnterFullscreen:'முழுத் திரையில் திற',videoExitFullscreen:'முழுத் திரையிலிருந்து வெளியேறு'},
};
