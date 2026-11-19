const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 8131;
const OUT = path.join(__dirname, 'shots');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.svg':'image/svg+xml','.woff2':'font/woff2'};
function serve(){return new Promise(res=>{const s=http.createServer((q,p)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(ROOT,u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){p.writeHead(404);p.end();return}p.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(p)});s.listen(PORT,()=>res(s))})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
fs.mkdirSync(OUT,{recursive:true});
const srv=await serve();
const b=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
const errs=[];
async function open(url){const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>errs.push(url+': '+e.message));await p.goto(`http://127.0.0.1:${PORT}${url}`,{waitUntil:'networkidle2',timeout:45000});return p}

// 表单页：morph 按钮特写 + 列表 + 滑动条
{
  const p=await open('/review.html');
  await p.evaluate(()=>{document.getElementById('rvDid').value='今天把子页特效四批都接上了。';document.getElementById('rvSave').click();});
  await sleep(260);
  const btn=await p.$('#rvSave');
  await btn.screenshot({path:OUT+'/5a-morph-btn-loading.png'});
  await sleep(800);
  const btn2=await p.$('#rvSave');
  await btn2.screenshot({path:OUT+'/5b-morph-btn-saved.png'});
  await sleep(1800);
  // 滚到列表
  await p.evaluate(()=>document.getElementById('rvList').scrollIntoView({block:'center',behavior:'instant'}));
  await sleep(300);
  await p.screenshot({path:OUT+'/5c-review-list.png'});
  // 点删除 → 滑动条
  await p.evaluate(()=>document.querySelector('[data-del]').click());
  await sleep(400);
  const list=await p.$('#rvList');
  await list.screenshot({path:OUT+'/5d-slide-bar.png'});
  // 滑到底
  await p.evaluate(async ()=>{
    const knob=document.querySelector('.sx-slide-knob');
    const kr=knob.getBoundingClientRect(), tr=knob.parentElement.getBoundingClientRect();
    const o=(x)=>({bubbles:true,pointerId:1,clientX:x,clientY:kr.top+kr.height/2});
    knob.dispatchEvent(new PointerEvent('pointerdown',o(kr.left+15)));
    knob.dispatchEvent(new PointerEvent('pointermove',o(tr.right-20)));
  });
  await sleep(200);
  const list2=await p.$('#rvList');
  await list2.screenshot({path:OUT+'/5e-slide-mid.png'}).catch(()=>{});
  await p.close();
}
// 简报期号页：归档按钮与图标
{
  const p=await open('/briefing/2026-11-19.html');
  await sleep(600);
  await p.evaluate(()=>window.scrollTo(0,0));
  await sleep(300);
  await p.screenshot({path:OUT+'/6a-issue-top.png'});
  await p.close();
}
console.log('errors:',errs);
await b.close();srv.close();})();
