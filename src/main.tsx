import {LuckyDrawPage} from './pages/LuckyDraw';
import React,{lazy,Suspense} from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter,createRoutesFromElements,RouterProvider,Route } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { AppProvider } from './context';
import { Layout } from './Layout';
import { Home,Browse,Rankings,SeriesDetail,Library } from './pages/Catalog';
import { Watch } from './pages/Watch';
import { Publisher } from './pages/Publisher';
import { Auth,WalletPage,Account,InfoPage } from './pages/Account';
import { Empty,Loading } from './ui';
import './styles.css';
import './mobile.css';
import './dropdowns.css';
import {installPageLoadRecovery,loadPageModule} from './page-load-recovery';
import {PageRecovery} from './components/PageRecovery';
installPageLoadRecovery();
const Studio=lazy(()=>loadPageModule(()=>import('./pages/Studio')).then(module=>({default:module.Studio})));
const SeriesEditor=lazy(()=>loadPageModule(()=>import('./pages/Studio')).then(module=>({default:module.SeriesEditor})));
const Admin=lazy(()=>loadPageModule(()=>import('./pages/Studio')).then(module=>({default:module.Admin})));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();(window as any).aidramioInstallEvent=event;});
window.addEventListener('appinstalled',()=>{(window as any).aidramioInstallEvent=null;});

const router=createBrowserRouter(createRoutesFromElements(<Route element={<I18nProvider><AppProvider><Layout/></AppProvider></I18nProvider>} errorElement={<I18nProvider><PageRecovery standalone/></I18nProvider>}>
  <Route index element={<Home/>}/><Route path="browse" element={<Browse/>}/><Route path="rankings" element={<Rankings/>}/><Route path="series/:id" element={<SeriesDetail/>}/><Route path="watch/:id/:episodeId" element={<Watch/>}/><Route path="publishers/:id" element={<Publisher/>}/>
  <Route path="lucky-draw" element={<LuckyDrawPage/>}/><Route path="library" element={<Library/>}/><Route path="auth" element={<Auth/>}/><Route path="wallet" element={<WalletPage/>}/><Route path="account" element={<Account/>}/>
  <Route path="studio" errorElement={<PageRecovery/>} element={<Suspense fallback={<Loading/>}><Studio/></Suspense>}/><Route path="studio/new" errorElement={<PageRecovery/>} element={<Suspense fallback={<Loading/>}><SeriesEditor/></Suspense>}/><Route path="studio/series/:id" errorElement={<PageRecovery/>} element={<Suspense fallback={<Loading/>}><SeriesEditor/></Suspense>}/><Route path="admin" errorElement={<PageRecovery/>} element={<Suspense fallback={<Loading/>}><Admin/></Suspense>}/>
  <Route path="help" element={<InfoPage type="help"/>}/><Route path="terms" element={<InfoPage type="terms"/>}/><Route path="privacy" element={<InfoPage type="privacy"/>}/>
  <Route path="*" element={<Empty title="404" action={<a href="/" className="button primary">LingYing →</a>}/>}/>
</Route>));
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router}/></React.StrictMode>);
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
