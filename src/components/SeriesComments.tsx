import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {Heart,LogIn,Trash2} from 'lucide-react';
import {isSeriesCommentBodyValid,SERIES_COMMENT_MAX_LENGTH,type SeriesComment,type SeriesCommentLike,type SeriesCommentsPage} from '../../shared/series-comments-schema';
import {api,ApiError} from '../api';
import {useApp} from '../context';
import {useI18n,type Key} from '../i18n';
import {Button,Modal} from '../ui';
import '../series-comments.css';

function commentError(error:unknown,fallback:Key):Key {
  if(error instanceof ApiError){
    if(error.status===429)return 'commentRateLimited';
    if(error.code==='VALIDATION'&&fallback==='commentPostError')return 'commentInvalid';
  }
  return fallback;
}

export function SeriesComments({seriesId}:{seriesId:string}) {
  const {t}=useI18n();
  const {ready,user}=useApp();
  const {hash,pathname,search}=useLocation();
  const section=useRef<HTMLElement>(null);
  const signIn=`/auth?${new URLSearchParams({next:pathname+search+'#series-comments'})}`;

  useEffect(()=>{
    if(hash!=='#series-comments')return;
    const frame=requestAnimationFrame(()=>section.current?.scrollIntoView({block:'start'}));
    return ()=>cancelAnimationFrame(frame);
  },[hash,seriesId]);

  return <section ref={section} id="series-comments" className="series-about" aria-labelledby="series-about-heading">
    <div className="section-heading"><div><h2 id="series-about-heading">{t('aboutSeries')}</h2></div></div>
    <div className="series-discussion">
      <h3>{t('commentsTitle')}</h3>
      {ready?<Discussion key={JSON.stringify([seriesId,user?.id??null])} seriesId={seriesId} signedIn={!!user} signIn={signIn}/>:<p className="muted" role="status">{t('loading')}</p>}
    </div>
  </section>;
}

function Discussion({seriesId,signedIn,signIn}:{seriesId:string;signedIn:boolean;signIn:string}) {
  const {t,locale}=useI18n();
  const {refreshUser}=useApp();
  const endpoint=`/api/series/${encodeURIComponent(seriesId)}/comments`;
  const [page,setPage]=useState<SeriesCommentsPage|null>(null);
  const [listStatus,setListStatus]=useState<'loading'|'ready'|'error'>('loading');
  const [draft,setDraft]=useState('');
  const [posting,setPosting]=useState(false);
  const [postError,setPostError]=useState<Key|null>(null);
  const [notice,setNotice]=useState<Key|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<SeriesComment|null>(null);
  const [rowStatuses,setRowStatuses]=useState<Partial<Record<number,Key|'pending'>>>({});
  const scope=useRef<AbortController|null>(null);
  const loadingPage=useRef(false);
  const postingComment=useRef(false);
  const pendingComments=useRef(new Set<number>());
  const composer=useRef<HTMLTextAreaElement>(null);
  const deleteCancel=useRef<HTMLButtonElement>(null);
  const number=new Intl.NumberFormat(locale);
  const date=new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'});
  const draftBody=draft.trim();
  const draftLength=[...draftBody].length;
  const draftValid=isSeriesCommentBodyValid(draftBody);
  const invalidDraft=draftLength>SERIES_COMMENT_MAX_LENGTH?t('commentTooLong').replace('{max}',number.format(SERIES_COMMENT_MAX_LENGTH)):
    draftBody&&!draftValid?t('commentInvalid'):null;

  const loadPage=useCallback(async(before?:number)=>{
    const signal=scope.current?.signal;
    if(!signal||loadingPage.current)return;
    loadingPage.current=true;
    setListStatus('loading');
    try{
      const data=await api<SeriesCommentsPage>(before===undefined?endpoint:`${endpoint}?before=${before}`,{signal});
      if(signal.aborted)return;
      setPage(current=>({
        comments:before===undefined||!current?data.comments:[...current.comments,...data.comments],
        nextBefore:data.nextBefore,
      }));
      setListStatus('ready');
    }catch{
      if(!signal.aborted)setListStatus('error');
    }finally{
      if(!signal.aborted)loadingPage.current=false;
    }
  },[endpoint]);

  useEffect(()=>{
    const controller=new AbortController();
    scope.current=controller;
    void loadPage();
    return ()=>{
      controller.abort();
      scope.current=null;
      loadingPage.current=false;
    };
  },[loadPage]);

  function refreshExpiredSession(error:unknown) {
    if(error instanceof ApiError&&error.status===401)void refreshUser().catch(()=>{});
  }

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signal=scope.current?.signal;
    if(!signal||!signedIn||!page||!draftValid||postingComment.current)return;
    postingComment.current=true;
    setPosting(true);
    setPostError(null);
    setNotice(null);
    try{
      const {comment}=await api<{comment:SeriesComment}>(endpoint,{method:'POST',body:JSON.stringify({body:draftBody}),signal});
      if(signal.aborted)return;
      setPage(current=>current&&{...current,comments:[comment,...current.comments]});
      setDraft('');
      setNotice('commentPosted');
      composer.current?.focus();
    }catch(error){
      if(signal.aborted)return;
      setPostError(commentError(error,'commentPostError'));
      refreshExpiredSession(error);
    }finally{
      if(!signal.aborted){
        postingComment.current=false;
        setPosting(false);
      }
    }
  }

  async function updateComment(comment:SeriesComment,action:'like'|'delete') {
    const signal=scope.current?.signal;
    if(!signal||!signedIn||pendingComments.current.has(comment.id))return;
    pendingComments.current.add(comment.id);
    setRowStatuses(current=>({...current,[comment.id]:'pending'}));
    setNotice(null);
    const path=`${endpoint}/${comment.id}`;
    const removing=action==='delete';
    let state:Key|undefined;
    let changes:SeriesCommentLike|null|undefined;
    try{
      if(removing){
        await api<void>(path,{method:'DELETE',signal});
        changes=null;
      }else{
        changes=await api<SeriesCommentLike>(path+'/like',{method:'PUT',body:JSON.stringify({liked:!comment.likedByViewer}),signal});
      }
    }catch(error){
      if(signal.aborted)return;
      if(error instanceof ApiError&&error.status===404){
        changes=null;
        setNotice('commentUnavailable');
      }else{
        state=commentError(error,removing?'commentDeleteError':'commentLikeError');
        refreshExpiredSession(error);
      }
    }
    if(signal.aborted)return;
    pendingComments.current.delete(comment.id);
    setRowStatuses(current=>({...current,[comment.id]:state}));
    if(changes===null){
      setPage(current=>current&&{...current,comments:current.comments.filter(item=>item.id!==comment.id)});
      if(removing){
        setDeleteTarget(null);
        setNotice(current=>current??'commentDeleted');
        requestAnimationFrame(()=>{if(!signal.aborted)composer.current?.focus();});
      }
    }else if(changes){
      setPage(current=>current&&{...current,comments:current.comments.map(item=>item.id===comment.id?{...item,...changes}:item)});
    }
  }

  const deleteStatus=deleteTarget?rowStatuses[deleteTarget.id]:undefined;
  const openDelete=(comment:SeriesComment)=>{
    setRowStatuses(current=>({...current,[comment.id]:undefined}));
    setDeleteTarget(comment);
  };
  const closeDelete=()=>{if(deleteStatus!=='pending')setDeleteTarget(null);};

  return <>
    {signedIn?<form className="series-comment-form" onSubmit={submit} aria-busy={posting}>
      <label htmlFor="series-comment-draft">{t('commentLabel')}</label>
      <p id="series-comment-notice" className="muted">{t('commentsPublicNotice')}</p>
      <textarea ref={composer} id="series-comment-draft" rows={3} dir="auto" value={draft} readOnly={posting}
        onChange={event=>{setDraft(event.target.value);setPostError(null);setNotice(null);}}
        aria-invalid={!!invalidDraft} aria-describedby={`series-comment-notice series-comment-count${invalidDraft?' series-comment-invalid':''}`}/>
      <div className="series-comment-form-actions">
        <bdi id="series-comment-count" className="series-comment-count">{number.format(draftLength)} / {number.format(SERIES_COMMENT_MAX_LENGTH)}</bdi>
        <Button className="button primary" type="submit" busy={posting} disabled={!page||!draftValid}>{t('commentPost')}</Button>
      </div>
      {invalidDraft&&<p id="series-comment-invalid" className="form-error" role="status">{invalidDraft}</p>}
      {postError&&<p className="form-error" role="alert">{t(postError)}</p>}
    </form>:<Link className="button secondary series-comment-sign-in" to={signIn}><LogIn size={16} aria-hidden="true"/>{t('commentsSignIn')}</Link>}

    {listStatus==='loading'&&!page&&<p className="muted" role="status">{t('loading')}</p>}
    {page&&!page.comments.length&&<p className="muted">{t('commentsEmpty')}</p>}
    {!!page?.comments.length&&<ul className="series-comments-list" role="list">
      {page.comments.map(comment=>{
        const status=rowStatuses[comment.id];
        const count=<><Heart size={16} fill={comment.likedByViewer?'currentColor':'none'} aria-hidden="true"/><bdi>{number.format(comment.likeCount)}</bdi><span className="sr-only"> {t('likes')}</span></>;
        return <li key={comment.id}><article className="series-comment">
          <header><strong><bdi>{comment.authorName}</bdi></strong><time dateTime={new Date(comment.createdAt).toISOString()}>{date.format(comment.createdAt)}</time></header>
          <p className="series-comment-body" dir="auto">{comment.body}</p>
          <div className="series-comment-actions">
            {comment.isOwn?<span className="series-comment-likes">{count}</span>:signedIn?
              <button type="button" className="series-comment-likes series-comment-action" aria-label={t('commentLike')} aria-pressed={comment.likedByViewer}
                title={t(comment.likedByViewer?'commentLiked':'commentLike')} aria-describedby={`series-comment-likes-${comment.id}`} disabled={status==='pending'} onClick={()=>void updateComment(comment,'like')}>
                <span id={`series-comment-likes-${comment.id}`}>{count}</span>
              </button>:
              <Link className="series-comment-likes series-comment-action" to={signIn} aria-label={t('commentSignInLike')} aria-describedby={`series-comment-likes-${comment.id}`} title={t('commentSignInLike')}>
                <span id={`series-comment-likes-${comment.id}`}>{count}</span>
              </Link>}
            {comment.isOwn&&<button type="button" className="series-comment-action series-comment-delete" title={t('commentDelete')} onClick={()=>openDelete(comment)} disabled={status==='pending'} aria-label={t('commentDelete')}><Trash2 size={16} aria-hidden="true"/></button>}
          </div>
          {!comment.isOwn&&status&&status!=='pending'&&<p className="form-error" role="alert">{t(status)}</p>}
        </article></li>;
      })}
    </ul>}
    {listStatus==='error'&&<p className="form-error" role="alert">{t('commentsLoadError')}</p>}
    {(page?.nextBefore!=null||listStatus==='error')&&<Button className="button secondary series-comment-load-more" type="button" busy={listStatus==='loading'} onClick={()=>void loadPage(page?.nextBefore??undefined)}>
      {t(listStatus==='error'?'retry':'commentsLoadMore')}
    </Button>}
    <p className={notice==='commentUnavailable'?'muted':'sr-only'} role="status">{notice&&t(notice)}</p>

    <Modal open={!!deleteTarget} onClose={closeDelete} title={t('commentDelete')} initialFocusRef={deleteCancel}>
      <p className="muted">{t('commentDeleteConfirm')}</p>
      {deleteStatus&&deleteStatus!=='pending'&&<p className="form-error" role="alert">{t(deleteStatus)}</p>}
      <div className="series-comment-dialog-actions">
        <button ref={deleteCancel} className="button secondary" type="button" onClick={closeDelete} disabled={deleteStatus==='pending'}>{t('cancel')}</button>
        <Button className="button secondary danger-text" type="button" busy={deleteStatus==='pending'} onClick={()=>deleteTarget&&void updateComment(deleteTarget,'delete')}>{t('commentDelete')}</Button>
      </div>
    </Modal>
  </>;
}
