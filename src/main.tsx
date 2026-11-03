import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {invokeShare} from './lib/supabase';
import QRCode from 'qrcode';
import {GIFEncoder, quantize, applyPalette} from 'gifenc';
import './style.css';

type Screen='Home'|'Welcome'|'ChooseLayer'|'Camera'|'Preview';
type Filter='Classic'|'Noir'|'Summer'|'Dream';
type Frame='Classic'|'Gold'|'Neon'|'Vietnam 1'|'Vietnam 2'|'Vietnam 3';
const layers=[{name:'Sweet Duo',style:'Soft light',layout:'two'},{name:'Dream Grid',style:'Warm tone',layout:'grid'},{name:'Film Strip',style:'Vintage',layout:'strip'},{name:'Mono Mood',style:'Monochrome',layout:'side'}] as const;
const filters:Filter[]=['Classic','Noir','Summer','Dream'];
const frames:Frame[]=['Classic','Gold','Neon','Vietnam 1','Vietnam 2','Vietnam 3'];
const frameAssets:Partial<Record<Frame,string>>={'Vietnam 1':'/frames/vietnam-1.png','Vietnam 2':'/frames/vietnam-2.png','Vietnam 3':'/frames/vietnam-3.png'};
type FramePhotoRegion={x:number;y:number;width:number;height:number};
const framePhotoRegions:Partial<Record<Frame,FramePhotoRegion[]>>={
  'Vietnam 1':[{x:100,y:168,width:736,height:520},{x:488,y:1039,width:736,height:520}],
  'Vietnam 2':[{x:0,y:151,width:1333,height:903}],
  'Vietnam 3':[{x:208,y:265,width:993,height:529},{x:224,y:1211,width:614,height:437}],
};
const defaultLayout:number=0;
function getPhotoCount(frame:Frame){return framePhotoRegions[frame]?.length??2}
const stickerGroups=[
  {name:'Cute',stickers:[{type:'bow',emoji:'🎀'},{type:'sparkly-heart',emoji:'💖'},{type:'teddy',emoji:'🧸'},{type:'cat',emoji:'🐱'},{type:'bunny',emoji:'🐰'}]},
  {name:'Hearts',stickers:[{type:'heart',emoji:'❤️'},{type:'two-hearts',emoji:'💕'},{type:'pink-heart',emoji:'💗'},{type:'heart-arrow',emoji:'💘'},{type:'heart-ribbon',emoji:'💝'}]},
  {name:'Sparkle',stickers:[{type:'sparkles',emoji:'✨'},{type:'star',emoji:'⭐'},{type:'glowing-star',emoji:'🌟'},{type:'dizzy',emoji:'💫'},{type:'rainbow',emoji:'🌈'}]},
  {name:'Flowers',stickers:[{type:'cherry-blossom',emoji:'🌸'},{type:'hibiscus',emoji:'🌺'},{type:'tulip',emoji:'🌷'},{type:'sunflower',emoji:'🌻'},{type:'bouquet',emoji:'💐'}]},
  {name:'Vietnam',stickers:[{type:'vietnam-flag',emoji:'🇻🇳'},{type:'noodles',emoji:'🍜'},{type:'coffee',emoji:'☕'},{type:'lotus',emoji:'🪷'},{type:'lantern',emoji:'🏮'}]},
  {name:'Fun',stickers:[{type:'party-popper',emoji:'🎉'},{type:'music',emoji:'🎵'},{type:'strawberry',emoji:'🍓'},{type:'cherries',emoji:'🍒'},{type:'crown',emoji:'👑'}]},
] as const;
type StickerType=typeof stickerGroups[number]['stickers'][number]['type'];
type StickerInstance={id:string;type:StickerType;x:number;y:number;scale:number;rotation:number;z:number};
const stickerEmojis=Object.fromEntries(stickerGroups.flatMap(group=>group.stickers.map(item=>[item.type,item.emoji]))) as Record<StickerType,string>;
const cssFilters:Record<Filter,string>={Classic:'none',Noir:'grayscale(1) contrast(1.2)',Summer:'sepia(.2) saturate(1.5) brightness(1.08)',Dream:'saturate(.85) brightness(1.12) contrast(.9) hue-rotate(8deg)'};
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function drawCover(ctx:CanvasRenderingContext2D,img:CanvasImageSource,x:number,y:number,w:number,h:number){const iw=(img as HTMLImageElement).naturalWidth|| (img as HTMLVideoElement).videoWidth;const ih=(img as HTMLImageElement).naturalHeight||(img as HTMLVideoElement).videoHeight;const scale=Math.max(w/iw,h/ih),sw=w/scale,sh=h/scale;ctx.drawImage(img,(iw-sw)/2,(ih-sh)/2,sw,sh,x,y,w,h)}
const frameImageCache=new Map<Frame,Promise<HTMLImageElement>>();
function loadFrameImage(frame:Frame):Promise<HTMLImageElement>{const source=frameAssets[frame];if(!source)return Promise.reject(new Error(`No image asset configured for ${frame}`));const cached=frameImageCache.get(frame);if(cached)return cached;const pending=new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{frameImageCache.delete(frame);reject(new Error(`Could not load frame image: ${source}`))};image.src=source});frameImageCache.set(frame,pending);return pending}
function drawStickers(ctx:CanvasRenderingContext2D,stickers:StickerInstance[],width:number,height:number){ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';const fontFamily='"Segoe UI Emoji","Apple Color Emoji",sans-serif';[...stickers].sort((a,b)=>a.z-b.z).forEach(sticker=>{ctx.save();ctx.translate(sticker.x*width,sticker.y*height);ctx.rotate(sticker.rotation*Math.PI/180);ctx.font=`${width*.07*sticker.scale}px ${fontFamily}`;ctx.fillText(stickerEmojis[sticker.type],0,0);ctx.restore()});ctx.restore()}
type StickerControlIconName='minus'|'plus'|'rotate-counterclockwise'|'rotate-clockwise'|'trash';
function StickerControlIcon({name}:{name:StickerControlIconName}){return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{name==='minus'&&<path d="M5 12h14"/>}{name==='plus'&&<path d="M12 5v14M5 12h14"/>}{name==='rotate-counterclockwise'&&<><path d="M3 11a9 9 0 1 1 2.64 6.36"/><path d="M3 4v7h7"/></>}{name==='rotate-clockwise'&&<><path d="M21 11a9 9 0 1 0-2.64 6.36"/><path d="M21 4v7h-7"/></>}{name==='trash'&&<><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3"/></>}</svg>}
async function renderComposition(images:HTMLImageElement[],layer:number,frame:Frame,stickers:StickerInstance[],filter:Filter):Promise<HTMLCanvasElement>{
  const frameSource=frameAssets[frame];
  if(frameSource){
    if(images.length===0)throw new Error('No photos available for the selected frame');
    const [frameImage,regions]=await Promise.all([loadFrameImage(frame),Promise.resolve(framePhotoRegions[frame])]);
    if(!regions)throw new Error(`No photo regions configured for ${frame}`);
    const c=document.createElement('canvas');
    c.width=800;
    c.height=1200;
    const ctx=c.getContext('2d');
    if(!ctx)throw new Error('Frame canvas unavailable');
    const scaleX=c.width/1333,scaleY=c.height/2000;
    ctx.save();
    ctx.filter=cssFilters[filter];
    regions.forEach((region,index)=>drawCover(ctx,images[index%images.length],region.x*scaleX,region.y*scaleY,region.width*scaleX,region.height*scaleY));
    ctx.restore();
    ctx.drawImage(frameImage,0,0,c.width,c.height);
    drawStickers(ctx,stickers,c.width,c.height);
    return c;
  }
  const c=document.createElement('canvas');
  c.width=900;
  c.height=1200;
  const ctx=c.getContext('2d')!;
  ctx.fillStyle=frame==='Gold'?'#f5e4ba':frame==='Neon'?'#29204e':'#fff1f6';
  ctx.fillRect(0,0,900,1200);
  const positions=layer===1?[[70,125,365,440],[465,125,365,440],[70,595,365,440],[465,595,365,440]]:layer===2?[[165,120,570,445],[165,610,570,445]]:layer===3?[[65,145,370,880],[465,145,370,880]]:[[65,150,770,410],[65,600,770,410]];
  ctx.save();
  ctx.filter=cssFilters[filter];
  positions.forEach((p,i)=>{ctx.save();ctx.beginPath();ctx.roundRect(p[0],p[1],p[2],p[3],18);ctx.clip();drawCover(ctx,images[i%images.length],...p as [number,number,number,number]);ctx.restore()});
  ctx.restore();
  ctx.strokeStyle=frame==='Gold'?'#c89b44':frame==='Neon'?'#ff7ef2':'#ef9fc0';
  ctx.lineWidth=14;
  ctx.strokeRect(20,20,860,1160);
  ctx.fillStyle=frame==='Neon'?'#fff':'#aa5e81';
  ctx.textAlign='center';
  ctx.font='bold 48px Georgia';
  ctx.fillText('PURIKURA STUDIO',450,83);
  drawStickers(ctx,stickers,c.width,c.height);
  ctx.font='25px sans-serif';
  ctx.fillText('made with love ✦',450,1152);
  return c;
}
type ShareResponse={ok?:boolean;retry?:boolean;error?:string;expiresAt?:string;pngUrl?:string;gifUrl?:string};
function isShareResponse(value:unknown):value is ShareResponse{return typeof value==='object'&&value!==null}
function createShareToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function createGifBlob(shots:string[],layer:number,frame:Frame,stickers:StickerInstance[],filter:Filter){const gif=GIFEncoder();for(const shot of shots){const im=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=shot});const canvas=await renderComposition([im],layer,frame,stickers,filter);const width=450,height=Math.round(width*canvas.height/canvas.width);const temp=document.createElement('canvas');temp.width=width;temp.height=height;const ctx=temp.getContext('2d');if(!ctx)throw new Error('GIF canvas unavailable');ctx.drawImage(canvas,0,0,width,height);const rgba=ctx.getImageData(0,0,width,height).data;const palette=quantize(rgba,128);gif.writeFrame(applyPalette(rgba,palette),width,height,{palette,delay:900})}gif.finish();return new Blob([Uint8Array.from(gif.bytes())],{type:'image/gif'})}
function SharePage(){const [response,setResponse]=useState<ShareResponse|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const token=window.location.hash.slice(1);useEffect(()=>{let active=true;if(!/^[A-Za-z0-9_-]{43}$/.test(token)){setError('This share link is invalid.');setLoading(false);return()=>{active=false}}invokeShare(JSON.stringify({action:'lookup',token})).then((result)=>{if(!isShareResponse(result)||!result.ok||typeof result.pngUrl!=='string'||typeof result.gifUrl!=='string')throw new Error(isShareResponse(result)&&typeof result.error==='string'?result.error:'Share link could not be opened');if(active)setResponse(result)}).catch((reason:unknown)=>{if(active)setError(reason instanceof Error?reason.message:'Share link could not be opened')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[token]);return <main className="app"><header><div className="logo">✿ purikura<span>studio</span></div><div className="header-right">✦ your kawaii photo booth ✦</div></header><div className="shell"><section className="share-page"><p className="eyebrow">YOUR PRIVATE GALLERY</p><h1>Your photo <em>memories</em> ♡</h1>{loading&&<p>Loading your gallery…</p>}{error&&<p className="share-error">{error==='share_expired'?'This share link has expired.':'This share link is invalid, expired, or temporarily unavailable.'}</p>}{response?.ok&&<><p>Download your photos below. This link expires in 7 days.</p><a className="primary share-download" href={response.pngUrl} download="purikura-studio.png">↓ Download PNG</a><a className="secondary share-download" href={response.gifUrl} download="purikura-studio.gif">✧ Download GIF</a>{response.expiresAt&&<small>Available until {new Date(response.expiresAt).toLocaleString()}</small>}</>}</section></div></main>}
let pendingShareToken:string|null=null;
let shareCreationLocked=false;
function App(){
const [screen,setScreen]=useState<Screen>('Home');
const layer=defaultLayout;
const setLayer=(_layout:number)=>{};
const hover:number|null=null;
const setHover=(_index:number|null)=>{};
const [filter,setFilter]=useState<Filter>('Classic');
const [countdown,setCountdown]=useState(3);
const [remaining,setRemaining]=useState<number|null>(null);
const [shots,setShots]=useState<string[]>([]);
const [stickerInstances,setStickerInstances]=useState<StickerInstance[]>([]);
const [selectedStickerId,setSelectedStickerId]=useState<string|null>(null);
const [canUndo,setCanUndo]=useState(false);
const [selectedFrame,setSelectedFrame]=useState<Frame>('Classic');
const [error,setError]=useState('');
const [busy,setBusy]=useState(false);
const [qr,setQr]=useState('');
const videoRef=useRef<HTMLVideoElement>(null);
const streamRef=useRef<MediaStream|null>(null);
const timerRef=useRef<number|null>(null);
const cancelled=useRef(false);
const stageRef=useRef<HTMLDivElement>(null);
const stickerHistoryRef=useRef<StickerInstance[][]>([]);
const stickerInstancesRef=useRef(stickerInstances);
stickerInstancesRef.current=stickerInstances;
const stickerIdRef=useRef(0);
const dragRef=useRef<{pointerId:number;stickerId:string;clientX:number;clientY:number;x:number;y:number;snapshot:StickerInstance[];moved:boolean}|null>(null);
const [composite,setComposite]=useState('');
const [cameraStatus,setCameraStatus]=useState<'off'|'opening'|'ready'|'error'>('off');
const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);
const [deviceId,setDeviceId]=useState('');
function recordStickerUndo(snapshot:StickerInstance[]){const history=[...stickerHistoryRef.current,snapshot];if(history.length>50)history.shift();stickerHistoryRef.current=history;setCanUndo(true)}
function commitStickers(next:StickerInstance[]){recordStickerUndo(stickerInstancesRef.current);stickerInstancesRef.current=next;setStickerInstances(next)}
function updateStickers(next:StickerInstance[]){stickerInstancesRef.current=next;setStickerInstances(next)}
function addSticker(type:StickerType){const existing=stickerInstancesRef.current;const offset=existing.length%5;const sticker:StickerInstance={id:`sticker-${++stickerIdRef.current}`,type,x:Math.min(.88,Math.max(.12,.5+(offset-2)*.07)),y:Math.min(.88,Math.max(.12,.5+(offset%3-1)*.07)),scale:1,rotation:0,z:Math.max(0,...existing.map(item=>item.z))+1};commitStickers([...existing,sticker]);setSelectedStickerId(sticker.id)}
function changeSticker(id:string,change:Partial<Pick<StickerInstance,'scale'|'rotation'>>){commitStickers(stickerInstancesRef.current.map(item=>item.id===id?{...item,...change}:item))}
function removeSticker(id:string){commitStickers(stickerInstancesRef.current.filter(item=>item.id!==id));setSelectedStickerId(current=>current===id?null:current)}
function undoStickerChange(){const previous=stickerHistoryRef.current.pop();if(!previous)return;stickerHistoryRef.current=[...stickerHistoryRef.current];updateStickers(previous);setCanUndo(stickerHistoryRef.current.length>0);setSelectedStickerId(current=>previous.some(item=>item.id===current)?current:null)}
function handleStickerPointerDown(event:React.PointerEvent<HTMLDivElement>,sticker:StickerInstance){event.preventDefault();event.stopPropagation();setSelectedStickerId(sticker.id);const stage=stageRef.current;if(!stage)return;stage.setPointerCapture(event.pointerId);dragRef.current={pointerId:event.pointerId,stickerId:sticker.id,clientX:event.clientX,clientY:event.clientY,x:sticker.x,y:sticker.y,snapshot:stickerInstancesRef.current,moved:false}}
function handleStagePointerMove(event:React.PointerEvent<HTMLDivElement>){const drag=dragRef.current;const stage=stageRef.current;if(!drag||drag.pointerId!==event.pointerId||!stage)return;const deltaX=event.clientX-drag.clientX,deltaY=event.clientY-drag.clientY;if(!drag.moved&&Math.hypot(deltaX,deltaY)<3)return;drag.moved=true;const bounds=stage.getBoundingClientRect();const x=Math.min(1,Math.max(0,drag.x+deltaX/bounds.width)),y=Math.min(1,Math.max(0,drag.y+deltaY/bounds.height));updateStickers(stickerInstancesRef.current.map(item=>item.id===drag.stickerId?{...item,x,y}:item))}
function handleStagePointerUp(event:React.PointerEvent<HTMLDivElement>){const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;if(drag.moved)recordStickerUndo(drag.snapshot);dragRef.current=null;if(stageRef.current?.hasPointerCapture(event.pointerId))stageRef.current.releasePointerCapture(event.pointerId)}
function startNewPhotos(){cancelled.current=true;if(timerRef.current!==null){window.clearTimeout(timerRef.current);timerRef.current=null}stopCamera();setShots([]);setCountdown(3);setRemaining(null);setBusy(false);setError('');setQr('');setComposite('');pendingShareToken=null;updateStickers([]);stickerHistoryRef.current=[];setCanUndo(false);setSelectedStickerId(null);dragRef.current=null;setSelectedFrame('Classic');setScreen('ChooseLayer')}
function stopCamera(){streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;if(videoRef.current){videoRef.current.pause();videoRef.current.srcObject=null}setCameraStatus('off')}
function hasCurrentCameraFrame(video:HTMLVideoElement){return video.videoWidth>0&&video.videoHeight>0&&video.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA&&streamRef.current?.getVideoTracks().some(track=>track.readyState==='live')===true}
async function openCamera(id?:string){
  if(!navigator.mediaDevices?.getUserMedia){setError('Camera requires HTTPS or localhost, and a compatible browser.');setCameraStatus('error');return}
  setError('');setCameraStatus('opening');
  streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;
  try{
    const constraints:MediaStreamConstraints={audio:false,video:id?{deviceId:{exact:id}}:{width:{ideal:1280},height:{ideal:960},facingMode:'user'}};
    const stream=await navigator.mediaDevices.getUserMedia(constraints);
    if(screenRef.current!=='Camera'){stream.getTracks().forEach(t=>t.stop());return}
    streamRef.current=stream;
    const video=videoRef.current;
    if(!video){stream.getTracks().forEach(t=>t.stop());return}
    video.srcObject=stream;
    await video.play();
    setCameraStatus('ready');
    // Device labels are generally available after camera permission is granted.
    // Enumeration failure must not turn an already-working camera into an error.
    try{
      const all=await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter(d=>d.kind==='videoinput'));
    }catch{setDevices([])}
    const actual=stream.getVideoTracks()[0]?.getSettings().deviceId;
    if(actual)setDeviceId(actual);
    stream.getVideoTracks()[0]?.addEventListener('ended',()=>{setCameraStatus('off');setError('Camera disconnected. Click Open camera to reconnect.')},{once:true});
  }catch(e){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;if(videoRef.current)videoRef.current.srcObject=null;const name=e instanceof DOMException?e.name:'UnknownError';const messages:Record<string,string>={NotAllowedError:'Camera permission denied. Click the camera icon near the address bar and allow access.',NotFoundError:'No camera detected. Connect a webcam and try again.',NotReadableError:'Camera is busy or unavailable. Close other camera applications.',OverconstrainedError:'Selected camera is unavailable. Choose another camera.',SecurityError:'Camera requires HTTPS or localhost.',AbortError:'Could not start camera. Please retry.'};setError(messages[name]||`Unable to open camera (${name}).`);setCameraStatus('error')}
}
const screenRef=useRef<Screen>('Home');screenRef.current=screen;
useEffect(()=>{if(screen==='Welcome')setScreen('ChooseLayer')},[screen]);
useEffect(()=>{if(screen==='Camera')return;streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;cancelled.current=true;setCameraStatus('off')},[screen]);
useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop())},[]);
useEffect(()=>{if(screen!=='Preview'||shots.length===0)return;let stale=false;Promise.all(shots.map(src=>new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src}))).then(async images=>{const canvas=await renderComposition(images,defaultLayout,selectedFrame,stickerInstances,filter);if(!stale){pendingShareToken=null;setQr('');setComposite(canvas.toDataURL('image/png'))}}).catch(reason=>{console.error('Could not render preview',reason);if(!stale)setError('Could not render preview')});return()=>{stale=true}},[screen,shots,selectedFrame,stickerInstances,filter]);
if(String(screen)==='ChooseLayer')return <main className="app"><header><div className="logo">✿ purikura<span>studio</span></div><div className="header-right">✦ your kawaii photo booth ✦</div></header><div className="shell"><div className="topline"><span>✦ PHOTO MAGIC ✦</span><span>STEP 01 / 03</span></div><section className="content"><p className="eyebrow">01 — PICK YOUR FRAME</p><h2>Choose your <em>frame</em> ✧</h2><p className="sub">Each frame sets up the right number of photos and its own composition.</p><div className="frame-grid" role="group" aria-label="Choose a frame">{frames.map(f=><button type="button" className={'frame-card '+(selectedFrame===f?'active':'')} key={f} onClick={()=>setSelectedFrame(f)} aria-pressed={selectedFrame===f}><span className={'frame-card-preview frame-preview-'+f.toLowerCase().replace(' ','-')}>{frameAssets[f]?<img src={frameAssets[f]} alt="" loading="lazy"/>:<span className="frame-demo-photo"><span>♡</span><span>♡</span></span>}</span><b>{f}</b></button>)}</div><div className="actions"><button className="secondary" onClick={()=>setScreen('Home')}>← Back</button><button className="primary" onClick={()=>setScreen('Camera')}>Start →</button></div></section></div><footer>made with ♡ · purikura studio · your memories, your magic</footer></main>;
function wait(ms:number){return new Promise<void>(resolve=>{timerRef.current=window.setTimeout(resolve,ms)})}
async function capture(){const video=videoRef.current;if(cameraStatus!=='ready'||!video||!hasCurrentCameraFrame(video)){setError('Camera image is not ready yet. Wait for the live preview before taking photos.');return}cancelled.current=false;setBusy(true);setError('');const result:string[]=[];const photoCount=getPhotoCount(selectedFrame);try{for(let shot=0;shot<photoCount;shot++){for(let t=countdown;t>0;t--){if(cancelled.current)return;setRemaining(t);await wait(1000)}if(cancelled.current)return;const v=videoRef.current;if(!v||!hasCurrentCameraFrame(v)){setError('Camera image was interrupted. Reopen the camera and try again.');return}const c=document.createElement('canvas');c.width=900;c.height=675;const ctx=c.getContext('2d')!;ctx.translate(c.width,0);ctx.scale(-1,1);drawCover(ctx,v,0,0,c.width,c.height);result.push(c.toDataURL('image/jpeg',.94));setRemaining(null);await wait(350)}if(cancelled.current)return;setShots(result);setScreen('Preview')}finally{setBusy(false);setRemaining(null)}}
async function renderCurrentComposition(){if(shots.length===0)throw new Error('No photos available to render');const images=await Promise.all(shots.map(src=>new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not load a captured photo'));image.src=src})));return renderComposition(images,defaultLayout,selectedFrame,stickerInstances,filter)}
async function savePng(){if(!shots.length)return;try{const canvas=await renderCurrentComposition();const blob=await(await fetch(canvas.toDataURL('image/png'))).blob();download(blob,'purikura-studio.png')}catch(reason){console.error('Could not render PNG',reason);setError('Could not render PNG')}}
async function makeGif(){if(!shots.length)return;setBusy(true);try{download(await createGifBlob(shots,defaultLayout,selectedFrame,stickerInstances,filter),'purikura-studio.gif')}catch{setError('GIF generation failed.')}finally{setBusy(false)}}
async function makeQr(){if(!shots.length||shareCreationLocked)return;shareCreationLocked=true;setBusy(true);setError('');try{const token=pendingShareToken??createShareToken();pendingShareToken=token;const currentCanvas=await renderCurrentComposition();const png=await(await fetch(currentCanvas.toDataURL('image/png'))).blob();const gif=await createGifBlob(shots,defaultLayout,selectedFrame,stickerInstances,filter);const form=new FormData();form.append('token',token);form.append('png',png,'photo.png');form.append('gif',gif,'photo.gif');const result=await invokeShare(form);if(!isShareResponse(result)||!result.ok)throw new Error(isShareResponse(result)&&typeof result.error==='string'?result.error:'Share creation failed');const shareUrl=new URL('/share/',window.location.origin);shareUrl.hash=token;setQr(await QRCode.toDataURL(shareUrl.toString(),{width:300,margin:2}))}catch(reason){setError(reason instanceof Error?reason.message:'Share creation failed')}finally{shareCreationLocked=false;setBusy(false)}}
const selectedSticker=stickerInstances.find(item=>item.id===selectedStickerId);return <main className="app"><header><div className="logo">✿ purikura<span>studio</span></div><div className="header-right">✦ your kawaii photo booth ✦</div></header><div className="shell"><div className="topline"><span>✦ PHOTO MAGIC ✦</span><span>{screen==='ChooseLayer'?'STEP 01 / 03':screen==='Camera'?'STEP 02 / 03':screen==='Preview'?'STEP 03 / 03':'WELCOME'}</span></div>{screen==='Home'&&<section className="hero"><div className="sparkle">✦ ♡ ✧</div><div className="hero-icon">📸</div><p className="eyebrow">THE CUTEST PHOTO EXPERIENCE</p><h1>Strike a pose,<br/><em>make a memory!</em></h1><p>Filters, frames & a little bit of magic. Your very own Japanese-style photo booth, right in your browser.</p><button className="primary" onClick={()=>setScreen('Welcome')}>Let's get started ✦</button><div className="tiny">♡ smile • snap • decorate • share ♡</div></section>}{screen==='Welcome'&&<section className="hero"><div className="hero-icon">🎀</div><p className="eyebrow">いらっしゃいませ!</p><h1>Welcome to<br/><em>Purikura Studio</em></h1><p>Ready for your mini photoshoot? Pick a layout and frame, then make something adorable.</p><button className="primary" onClick={()=>setScreen('ChooseLayer')}>Choose layout & frame →</button><button className="link" onClick={()=>setScreen('Home')}>← Back</button></section>}{screen==='ChooseLayer'&&<section className="content"><p className="eyebrow">01 — PICK YOUR STYLE</p><h2>Choose your <em>layout</em> ♡</h2><p className="sub">Hover to preview and click to select your favorite.</p><div className="layout-grid">{layers.map((l,i)=><button key={l.name} className={'layout-card '+(layer===i?'active':'')} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)} onClick={()=>setLayer(i)}><div className={'layout-art layout-'+i}>{Array.from({length:i===1?4:2},(_,j)=><span key={j}>♡</span>)}</div><b>{l.name}</b><small>{l.style}</small>{layer===i&&<span className="selected">✓ Selected</span>}{hover===i&&layer!==i&&<span className="selected">Preview</span>}</button>)}</div><h2 className="frame-picker-heading">Choose your <em>frame</em> ✧</h2><p className="sub">Select a frame before starting your photoshoot.</p><div className="frame-grid" role="group" aria-label="Choose a frame">{frames.map(f=><button type="button" className={'frame-card '+(selectedFrame===f?'active':'')} key={f} onClick={()=>setSelectedFrame(f)} aria-pressed={selectedFrame===f}><span className={'frame-card-preview frame-preview-'+f.toLowerCase().replace(' ','-')}>{frameAssets[f]?<img src={frameAssets[f]} alt="" loading="lazy"/>:<span className="frame-demo-photo"><span>♡</span><span>♡</span></span>}</span><b>{f}</b></button>)}</div><div className="actions"><button className="secondary" onClick={()=>setScreen('Welcome')}>← Back</button><button className="primary" onClick={()=>setScreen('Camera')}>Start →</button></div></section>}{screen==='Camera'&&<section className="content"><p className="eyebrow">02 — SAY CHEESE!</p><h2>Camera <em>magic</em> ✦</h2><p className="sub">Choose a filter, set your timer, and capture {layer===1?'four':'two'} photos.</p><div className="camera-grid"><div className="camera-area"><div className="video-wrap"><video ref={videoRef} autoPlay playsInline muted style={{filter:cssFilters[filter]}}/>{cameraStatus!=='ready'&&cameraStatus!=='opening'&&!error&&<div className="camera-prompt">📷<br/>Click Open camera below to enable your webcam</div>}{remaining!==null&&<div className="count-overlay">{remaining}</div>}{error&&<div className="camera-error">{error}</div>}</div><div className="camera-label">● {cameraStatus==='ready'?'LIVE PREVIEW':cameraStatus==='opening'?'CONNECTING CAMERA':'CAMERA OFF'} <span>{filter} filter</span></div><div className="camera-actions"><button className="primary" type="button" disabled={cameraStatus==='opening'||busy} onClick={()=>openCamera(deviceId||undefined)}>{cameraStatus==='opening'?'Opening…':cameraStatus==='ready'?'↻ Restart camera':'📷 Open camera'}</button><button className="secondary" type="button" disabled={cameraStatus!=='ready'||busy} onClick={stopCamera}>Stop camera</button></div>{devices.length>1&&<label className="camera-picker">Camera device<select value={deviceId} disabled={busy||cameraStatus==='opening'} onChange={e=>{const id=e.target.value;setDeviceId(id);void openCamera(id)}}>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label||'Camera '+(devices.indexOf(d)+1)}</option>)}</select></label>}</div><aside className="controls"><h3>✦ Choose a filter</h3><div className="filter-grid">{filters.map(f=><button key={f} className={'filter '+(filter===f?'active':'')} onClick={()=>setFilter(f)}>{f==='Classic'?'🌸':f==='Noir'?'◐':f==='Summer'?'☀️':'☁️'}<span>{f}</span></button>)}</div><h3>⏱ Countdown</h3><div className="counter"><button disabled={busy} onClick={()=>setCountdown(Math.max(1,countdown-1))}>−</button><strong>{countdown}s</strong><button disabled={busy} onClick={()=>setCountdown(Math.min(10,countdown+1))}>+</button></div><p className="hint">{layer===1?'Four':'Two'} photos, each with a {countdown}-second countdown.</p><button className="primary full" disabled={busy||cameraStatus!=='ready'} onClick={capture}>{busy?'Capturing…':'📸 Start photoshoot'}</button><button className="link" disabled={busy} onClick={()=>setScreen('ChooseLayer')}>← Change layout & frame</button></aside></div></section>}{screen==='Preview'&&<section className="content"><p className="eyebrow">03 — MAKE IT YOURS</p><h2>Your photo <em>masterpiece!</em> ♡</h2><p className="sub">Add your finishing touches and save your creation.</p><div className="preview-grid"><div className="result">{composite?<div className="sticker-stage" ref={stageRef} style={{aspectRatio:frameAssets[selectedFrame]?'2 / 3':'3 / 4'}} onPointerMove={handleStagePointerMove} onPointerUp={handleStagePointerUp} onPointerCancel={handleStagePointerUp}><img src={composite} alt="Your decorated Purikura photo"/>{[...stickerInstances].sort((a,b)=>a.z-b.z).map((item,index)=><div key={item.id} className={`sticker-target ${selectedStickerId===item.id?'selected':''}`} role="button" tabIndex={0} aria-label={`Select ${stickerEmojis[item.type]} sticker ${index+1}`} style={{left:`${item.x*100}%`,top:`${item.y*100}%`,width:`${Math.min(18,12*item.scale)}%`,zIndex:item.z,transform:`translate(-50%, -50%) rotate(${item.rotation}deg)`}} onPointerDown={event=>handleStickerPointerDown(event,item)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedStickerId(item.id)}}}/>)}{selectedSticker&&<div className="sticker-toolbar" role="toolbar" aria-label="Selected sticker controls" style={{left:`${selectedSticker.x*100}%`,top:`${selectedSticker.y>0.2?selectedSticker.y*100:Math.min(98,selectedSticker.y*100+10)}%`,transform:selectedSticker.y>0.2?'translate(-50%, calc(-100% - 12px))':'translate(-50%, 12px)'}} onPointerDown={event=>event.stopPropagation()}><button type="button" aria-label="Shrink sticker by 10%" title="Shrink sticker by 10%" onClick={()=>changeSticker(selectedSticker.id,{scale:Math.max(.3,Math.round(selectedSticker.scale*.9*100)/100)})}><StickerControlIcon name="minus"/></button><button type="button" aria-label="Enlarge sticker by 10%" title="Enlarge sticker by 10%" onClick={()=>changeSticker(selectedSticker.id,{scale:Math.min(3,Math.round(selectedSticker.scale*1.1*100)/100)})}><StickerControlIcon name="plus"/></button><button type="button" aria-label="Rotate sticker counterclockwise by 15 degrees" title="Rotate counterclockwise 15 degrees" onClick={()=>changeSticker(selectedSticker.id,{rotation:selectedSticker.rotation-15})}><StickerControlIcon name="rotate-counterclockwise"/></button><button type="button" aria-label="Rotate sticker clockwise by 15 degrees" title="Rotate clockwise 15 degrees" onClick={()=>changeSticker(selectedSticker.id,{rotation:selectedSticker.rotation+15})}><StickerControlIcon name="rotate-clockwise"/></button><button type="button" aria-label="Delete selected sticker" title="Delete selected sticker" onClick={()=>removeSticker(selectedSticker.id)}><StickerControlIcon name="trash"/></button></div>}</div>:<p>Preparing your photo?</p>}</div><aside className="controls"><h3>? Add stickers <span className="sticker-count">{stickerInstances.length}/30+</span></h3><button type="button" className="secondary full" onClick={undoStickerChange} disabled={!canUndo}>? Undo</button><div className="sticker-library">{stickerGroups.map(group=><div className="sticker-group" key={group.name}><h4>{group.name}</h4><div className="sticker-palette">{group.stickers.map(item=><button type="button" className="sticker-option" key={item.type} onClick={()=>addSticker(item.type)} aria-label={`Add ${item.emoji} sticker`} title={`Add ${item.emoji}`}><span>{item.emoji}</span></button>)}</div></div>)}</div><h3>✦ Save & share</h3><button className="primary full" onClick={savePng} disabled={!composite}>↓ Download PNG</button><button className="secondary full" onClick={makeGif} disabled={busy||!composite}>{busy?'Creating GIF…':'✧ Generate GIF'}</button><button className="secondary full" onClick={makeQr} disabled={!composite||busy}>▦ Create private share QR (7 days)</button><button className="link" onClick={startNewPhotos}>? Take new photos</button></aside></div>{qr&&<div className="qr-panel"><h3>Scan to download your Purikura photos</h3><img src={qr} alt="QR code for private gallery downloads"/><p>This private gallery expires after 7 days. Its PNG and GIF links expire automatically.</p><button className="secondary" onClick={()=>setQr('')}>Close</button></div>}</section>}{error&&screen!=='Camera'&&<div className="error">{error}</div>}</div><footer>made with ♡ · purikura studio · your memories, your magic</footer></main>}

createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname==='/share'||window.location.pathname.startsWith('/share/')?<SharePage/>:<App/>}</React.StrictMode>);
