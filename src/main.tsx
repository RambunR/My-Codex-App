import React,{lazy,Suspense} from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter,Routes,Route } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { AppProvider } from './context';
import { Layout } from './Layout';
import { Home,Browse,Rankings,SeriesDetail,Library } from './pages/Catalog';
import { Watch } from './pages/Watch';
import { Auth,WalletPage,Account,InfoPage } from './pages/Account';
import { Empty,Loading } from './ui';
import './styles.css';
import './mobile.css';
const Studio=lazy(()=>import('./pages/Studio').then(module=>({default:module.Studio})));
const SeriesEditor=lazy(()=>import('./pages/Studio').then(module=>({default:module.SeriesEditor})));
const Admin=lazy(()=>import('./pages/Studio').then(module=>({default:module.Admin})));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();(window as any).aidramioInstallEvent=event;});
window.addEventListener('appinstalled',()=>{(window as any).aidramioInstallEvent=null;});

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><I18nProvider><AppProvider><Routes><Route element={<Layout/>}>
  <Route index element={<Home/>}/><Route path="browse" element={<Browse/>}/><Route path="rankings" element={<Rankings/>}/><Route path="series/:id" element={<SeriesDetail/>}/><Route path="watch/:id/:episodeId" element={<Watch/>}/>
  <Route path="library" element={<Library/>}/><Route path="auth" element={<Auth/>}/><Route path="wallet" element={<WalletPage/>}/><Route path="account" element={<Account/>}/>
  <Route path="studio" element={<Suspense fallback={<Loading/>}><Studio/></Suspense>}/><Route path="studio/new" element={<Suspense fallback={<Loading/>}><SeriesEditor/></Suspense>}/><Route path="studio/series/:id" element={<Suspense fallback={<Loading/>}><SeriesEditor/></Suspense>}/><Route path="admin" element={<Suspense fallback={<Loading/>}><Admin/></Suspense>}/>
  <Route path="help" element={<InfoPage type="help"/>}/><Route path="terms" element={<InfoPage type="terms"/>}/><Route path="privacy" element={<InfoPage type="privacy"/>}/>
  <Route path="*" element={<Empty title="404" action={<a href="/" className="button primary">LingYing →</a>}/>}/>
</Route></Routes></AppProvider></I18nProvider></BrowserRouter></React.StrictMode>);
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
