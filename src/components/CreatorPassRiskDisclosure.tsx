import {Info} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useI18n} from '../i18n';
import {creatorPassRiskEnglish,creatorPassRiskMessages} from '../creator-pass-risk-locales';
import '../creator-pass-risk.css';

export function CreatorPassRiskDisclosure(){
  const{t,locale}=useI18n();
  const body=creatorPassRiskMessages[locale]?.creatorPassRiskBody||creatorPassRiskEnglish.creatorPassRiskBody;
  return <div className="creator-pass-risk-disclosure" role="note">
    <Info size={18} aria-hidden="true"/>
    <div><p>{body}</p><div className="creator-pass-risk-links"><Link to="/terms#creator-pass">{t('terms')}</Link><Link to="/privacy">{t('privacy')}</Link></div></div>
  </div>;
}
