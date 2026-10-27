import { useEffect,useRef,useState } from 'react';
import { Link,NavLink,Outlet,useLocation,useNavigate } from 'react-router-dom';
import { Compass,Search,ChartNoAxesCombined,Bookmark,Clapperboard,ArrowUpRight,Globe2,ChevronDown,Plus,Wallet,Bell,Command,Menu,Sparkles,ArrowRight,ShieldCheck } from 'lucide-react';
import { Brand,LanguagePicker,Modal,Avatar } from './ui';
import { useI18n,languageName } from './i18n';
import { useApp } from './context';

export function Layout(){
  const{t,locale}=useI18n();const{user,config}=useApp();const location=useLocation();const navigate=useNavigate();const[language,setLanguage]=useState(false);const[notifications,setNotifications]=useState(false);const[search,setSearch]=useState('');const searchRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant'});},[location.pathname]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();searchRef.current?.focus();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const nav=[{to:'/',icon:Compass,label:'discover'},{to:'/browse',icon:Search,label:'explore'},{to:'/rankings',icon:ChartNoAxesCombined,label:'rankings'},{to:'/library',icon:Bookmark,label:'myList'}] as const;
  return <div className={`app-shell ${location.pathname.startsWith('/watch/')?'watch-layout':''}`}>
    <aside className="sidebar"><Brand/><span className="sidebar-label">{t('discover')}</span><nav>{nav.map(({to,icon:Icon,label})=><NavLink key={to} to={to} end={to==='/'}><Icon size={20}/><span>{t(label)}</span>{label==='discover'&&<span className="nav-dot"/>}</NavLink>)}</nav>
      <div className="sidebar-creator"><div className="creator-orbit"><Clapperboard size={23}/><Sparkles size={11}/></div><h3>{t('creatorTitle')}</h3><p>{t('creatorSubtitle')}</p><Link to="/studio">{t('startCreating')}<ArrowUpRight size={15}/></Link></div>
      <div className="sidebar-bottom"><NavLink to="/wallet"><Wallet size={18}/>{t('wallet')}</NavLink>{user?.role==='admin'&&<NavLink to="/admin"><ShieldCheck size={18}/>{t('admin')}</NavLink>}<button onClick={()=>setLanguage(true)}><Globe2 size={18}/><span>{languageName(locale)}</span><ChevronDown size={14}/></button><span className="sidebar-copyright">© {new Date().getFullYear()} AIDramio</span></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="mobile-brand"><Brand small/></div><form className="top-search" onSubmit={e=>{e.preventDefault();navigate(`/browse?q=${encodeURIComponent(search)}`);}}><Search size={18}/><input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('search')} aria-label={t('search')}/><kbd><Command size={11}/> K</kbd></form><div className="top-actions"><button className="header-language" onClick={()=>setLanguage(true)} aria-label={t('language')}><Globe2 size={17}/><span>{locale==='en'?'EN':locale==='zh-TW'?'繁':locale==='zh-CN'?'简':locale.toUpperCase().slice(0,2)}</span><ChevronDown size={12}/></button><button className="icon-button notification-button" onClick={()=>setNotifications(true)} aria-label={t('notifications')}><Bell size={19}/></button><span className="header-divider"/><Link className="creator-top-link" to="/studio"><Plus size={17}/><span>{t('studio')}</span></Link>{user?<Link className="avatar-link" to="/account" aria-label={t('account')}><Avatar name={user.name} size="small"/></Link>:<Link to="/auth" className="button small primary">{t('signIn')}</Link>}</div></header>
      <main className="main-content" id="main-content"><Outlet/></main>
      <footer className="footer"><div><Brand small/><span>{t('footer')}</span></div><nav><Link to="/help">{t('help')}</Link><Link to="/terms">{t('terms')}</Link><Link to="/privacy">{t('privacy')}</Link><button onClick={()=>setLanguage(true)}><Globe2 size={14}/>{t('language')}</button></nav><small>© {new Date().getFullYear()} AIDramio. {t('rights')}{config.demo&&<> · {t('sampleCatalogue')}</>}</small></footer>
    </div><nav className="mobile-nav">{nav.map(({to,icon:Icon,label})=><NavLink key={to} to={to} end={to==='/'}><Icon size={21}/><span>{t(label)}</span></NavLink>)}<NavLink to="/account"><Menu size={21}/><span>{t('account')}</span></NavLink></nav>
    <LanguagePicker open={language} onClose={()=>setLanguage(false)}/><Modal open={notifications} onClose={()=>setNotifications(false)} title={t('notifications')}><div className="empty-state compact"><Bell size={28}/><h3>{t('noNotifications')}</h3></div></Modal>
  </div>;
}
