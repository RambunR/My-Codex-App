import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter,Routes,Route } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { AppProvider } from './context';
import { Layout } from './Layout';
import { Home,Browse,Rankings,SeriesDetail,Library } from './pages/Catalog';
import { Watch } from './pages/Watch';
import { Auth,WalletPage,Account,InfoPage } from './pages/Account';
import { Studio,SeriesEditor,Admin } from './pages/Studio';
import { Empty } from './ui';
import './styles.css';
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();(window as any).aidramioInstallEvent=event;});
window.addEventListener('appinstalled',()=>{(window as any).aidramioInstallEvent=null;});

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><I18nProvider><AppProvider><Routes><Route element={<Layout/>}>
  <Route index element={<Home/>}/><Route path="browse" element={<Browse/>}/><Route path="rankings" element={<Rankings/>}/><Route path="series/:id" element={<SeriesDetail/>}/><Route path="watch/:id/:episodeId" element={<Watch/>}/>
  <Route path="library" element={<Library/>}/><Route path="auth" element={<Auth/>}/><Route path="wallet" element={<WalletPage/>}/><Route path="account" element={<Account/>}/>
  <Route path="studio" element={<Studio/>}/><Route path="studio/new" element={<SeriesEditor/>}/><Route path="studio/series/:id" element={<SeriesEditor/>}/><Route path="admin" element={<Admin/>}/>
  <Route path="help" element={<InfoPage type="help"/>}/><Route path="terms" element={<InfoPage type="terms"/>}/><Route path="privacy" element={<InfoPage type="privacy"/>}/>
  <Route path="*" element={<Empty title="404" action={<a href="/" className="button primary">AIDramio →</a>}/>}/>
</Route></Routes></AppProvider></I18nProvider></BrowserRouter></React.StrictMode>);
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
