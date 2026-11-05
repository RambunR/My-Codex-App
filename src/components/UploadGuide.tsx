import {useState} from 'react';
import {ArrowDown,ArrowRight,Check,CheckCheck,FileVideo,FolderOpen,FolderUp,Info,Pencil,Timer,HardDrive} from 'lucide-react';
import {MAX_EPISODE_BYTES,MAX_EPISODE_SECONDS} from '../../shared/config';
import {useI18n} from '../i18n';
import {Modal} from '../ui';
import '../upload-guide.css';

/** A localized diagram: filenames and instructions stay readable at any screen size. */
export function UploadGuide(){
  const[open,setOpen]=useState(false);const{t}=useI18n();
  const close=()=>setOpen(false);
  const filenames=['My_Series_1.mp4','My_Series_2.mp4','My_Series_10.mp4'];
  const steps=[
    {title:t('uploadGuidePrepareTitle'),body:t('uploadGuidePrepareBody'),art:<div className="upload-guide-folder"><FolderOpen size={30}/><div dir="ltr">{filenames.map(name=><span key={name}><FileVideo size={12}/><code>{name}</code></span>)}</div></div>},
    {title:t('uploadGuideNameTitle'),body:t('uploadGuideNameBody'),art:<div className="upload-guide-order" dir="ltr"><span>_1</span><ArrowRight size={15}/><span>_2</span><ArrowRight size={15}/><span>_10</span></div>},
    {title:t('uploadGuideUploadTitle'),body:t('uploadGuideUploadBody'),art:<div className="upload-guide-transfer"><FolderUp size={34}/><span>{t('uploadFolder')}</span><div className="upload-guide-progress"><i/></div></div>},
    {title:t('uploadGuideReviewTitle'),body:t('uploadGuideReviewBody'),art:<div className="upload-guide-rename"><span><CheckCheck size={16}/>{t('episodeSelectAll')}</span><ArrowDown size={14}/><span><Pencil size={15}/>{t('episodeBatchRename')}</span></div>},
  ];
  return <><button type="button" className="icon-button upload-guide-trigger" aria-label={t('uploadGuideOpen')} title={t('uploadGuideOpen')} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><Info size={18} aria-hidden="true"/></button>
    <Modal open={open} onClose={close} title={t('uploadGuideTitle')} wide>
      <div className="upload-guide">
        <p className="upload-guide-intro">{t('uploadGuideIntro')}</p>
        <div className="upload-guide-limits"><span><Timer size={17} aria-hidden="true"/>{t('uploadGuideDuration').replace('{minutes}',String(MAX_EPISODE_SECONDS/60))}</span><span><HardDrive size={17} aria-hidden="true"/>{t('uploadGuideSize').replace('{size}',String(MAX_EPISODE_BYTES/1024/1024))}</span></div>
        <ol className="upload-guide-diagram" aria-label={t('uploadGuideTitle')}>{steps.map((step,index)=><li key={index}>
          <h3><span className="upload-guide-step" aria-hidden="true">{index+1}</span>{step.title}</h3>
          <div className="upload-guide-art" aria-hidden="true">{step.art}</div><p>{step.body}</p>
          {index<steps.length-1&&<ArrowRight className="upload-guide-connector" size={20} aria-hidden="true"/>}
        </li>)}</ol>
        <p className="upload-guide-retry"><Info size={17} aria-hidden="true"/>{t('uploadGuideRetry')}</p>
        <button type="button" className="button primary upload-guide-done" onClick={close}><Check size={16} aria-hidden="true"/>{t('done')}</button>
      </div>
    </Modal>
  </>;
}
