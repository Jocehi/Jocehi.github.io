/* 截图验收：node test/shots.js */
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 8121;
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

// 1) 长文页：滚动到图，抓汇聚中间帧 + 完成帧
{
  const p=await open('/papers/dreamerv2.html');
  await p.evaluate(()=>document.querySelector('figure').scrollIntoView({block:'center',behavior:'instant'}));
  await sleep(900); await p.screenshot({path:OUT+'/1a-image-gather-mid.png'});
  await sleep(3000); await p.screenshot({path:OUT+'/1b-image-done.png'});
  // 展开答案抓逐行显现
  await p.evaluate(()=>{const d=document.querySelector('details.qa');d.open=true;d.dispatchEvent(new Event('toggle'));d.scrollIntoView({block:'center',behavior:'instant'});});
  await sleep(500); await p.screenshot({path:OUT+'/1c-print-mid.png'});
  await sleep(2200); await p.screenshot({path:OUT+'/1d-print-done.png'});
  await p.close();
}
// 2) 列表页汇聚
for (const [url,name] of [['/papers.html','2a-papers'],['/rl.html','2b-rl']]) {
  const p=await open(url);
  await sleep(350); await p.screenshot({path:OUT+'/'+name+'-mid.png'});
  await sleep(2800); await p.screenshot({path:OUT+'/'+name+'-done.png'});
  await p.close();
}
// 3) 简报页：点卡片爆裂 + toast + 归档图标
{
  const p=await open('/briefing.html');
  await sleep(2600);
  await p.evaluate(()=>{const c=document.querySelector('.card.latest');const r=c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+40,clientY:r.top+30}));});
  await sleep(350); await p.screenshot({path:OUT+'/3a-snap-mid.png'});
  await sleep(1600); await p.screenshot({path:OUT+'/3b-snap-toast.png'});
  await p.evaluate(()=>{const u=document.querySelector('.sx-toast-undo');if(u)u.click();});
  await sleep(600);
  await p.evaluate(()=>{const li=document.querySelector('.archive li');li.querySelector('.sx-archive-btn').click();});
  await sleep(600); await p.screenshot({path:OUT+'/3c-stream-mid.png'});
  await sleep(1600); await p.screenshot({path:OUT+'/3d-stream-done.png'});
  await p.close();
}
// 4) 表单页：morph 按钮 + 滑动条
{
  const p=await open('/review.html');
  await p.evaluate(()=>{document.getElementById('rvDid').value='今天把子页特效四批都接上了：长文页的配图汇聚出现与折叠答案逐行打出、列表页新卡片汇聚、简报页的点击消除与归档飞向图标、表单页的保存按钮 morph 与滑动确认删除。';document.getElementById('rvSave').click();});
  await sleep(260); await p.screenshot({path:OUT+'/4a-morph-loading.png'});
  await sleep(800); await p.screenshot({path:OUT+'/4b-morph-saved.png'});
  await sleep(1600);
  await p.evaluate(()=>document.querySelector('[data-del]').click());
  await sleep(400); await p.screenshot({path:OUT+'/4c-slide.png'});
  await p.close();
}
console.log('errors:', errs);
await b.close();srv.close();})();
