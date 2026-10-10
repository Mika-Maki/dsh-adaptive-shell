/**
 * Which rules compete with this plugin's definitions, per element and per property.
 *
 * Written because more than one round was spent changing a rule that was losing the cascade —
 * or, in the worst case, computing to nothing — while the stylesheet itself looked correct.
 * This prints the computed value, then for each property the matching rules that set it with a
 * rough specificity and whether the rule is this plugin's or the shell's, so the winner is
 * visible instead of inferred. Grouping rules (@media, @layer, @supports) are walked.
 *
 * The thinking title row is the worked example: this plugin wins `background-color` there (it
 * must, or the title reads as a different surface from the card), while the shell keeps its own
 * `overflow:hidden` — and that one is deliberately not contested.
 *
 * Usage: node tools/inspect.mjs <web token>   (the token `dsh web` prints in its URL)
 */
const { spawn } = require('child_process');
/** Find a headless browser: `DSH_INSPECT_BROWSER`, a playwright cache, or one on PATH. */
function findBrowser() {
  if (process.env.DSH_INSPECT_BROWSER) return process.env.DSH_INSPECT_BROWSER;
  const { readdirSync, existsSync } = require('node:fs');
  const { join } = require('node:path');
  const { homedir } = require('node:os');
  const roots = [join(homedir(), '.cache/ms-playwright'), join(homedir(), 'Library/Caches/ms-playwright')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      for (const name of ['chrome-headless-shell', 'chrome']) {
        for (const candidate of [
          join(root, entry, 'chrome-headless-shell-linux-arm64', name),
          join(root, entry, 'chrome-headless-shell-linux64', name),
          join(root, entry, 'chrome-linux', name),
          join(root, entry, 'chrome-mac', name),
        ]) if (existsSync(candidate)) return candidate;
      }
    }
  }
  const { execFileSync } = require('node:child_process');
  for (const name of ['chrome-headless-shell', 'chromium', 'google-chrome', 'chrome']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch (error) {
      /* try the next name */
    }
  }
  return 'chromium';
}
const CH = findBrowser();
const TOKEN = process.argv[2] || process.env.DSH_WEB_TOKEN || '';
const URL = 'http://127.0.0.1:3080/' + (TOKEN ? '?token=' + TOKEN : '');
const port = Number(process.env.DSH_INSPECT_PORT || 9344);
const p=spawn(CH,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=390,844','--remote-debugging-port='+port,'--user-data-dir=/tmp/cdH',URL],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let page=null;
  for(let i=0;i<30&&!page;i++){try{const t=await(await fetch(`http://127.0.0.1:${port}/json`)).json();page=t.find(x=>x.type==='page');}catch(e){} if(!page)await sleep(1000);}
  const ws=new WebSocket(page.webSocketDebuggerUrl); let id=0; const pend=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  const val=async x=>{const r=await new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:'Runtime.evaluate',params:{expression:x,returnByValue:true,awaitPromise:true}}));});return r.result&&r.result.result?r.result.result.value:null;};
  await sleep(14000);
  await val(`(()=>{const b=document.querySelector('[data-dsh-adaptive-nav]'); if(b)b.click(); return 1;})()`);
  const open=`(()=>{const hit=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/加载设计/.test(e.textContent||''));if(!hit)return 'no-hit';let t=hit;for(let i=0;i<8&&t;i++){if(t.className&&/sessionRow/.test(t.className)){t.click();return 'ok';}t=t.parentElement;}return 'no-clk';})()`;
  for(let i=0;i<5;i++){ await sleep(2500); if(await val(`document.querySelectorAll('[data-variant="think"]').length`)>0) break; await val(open); }
  console.log(await val(`(()=>{
    const spec=sel=>{let a=0,b=0,c=0; const s=sel.replace(/:has\\(([^()]*(?:\\([^()]*\\))?[^()]*)\\)/g,(m,g)=>{const t=g;const r=/\\[[^\\]]+\\]/.test(t);return r?'[x]':'';});
      for(const part of s.split(/(?=[.#\\[:])/)){ if(!part) continue; if(part[0]==='#')a++; else if(part[0]==='.')b++; else if(part[0]==='[')b++; else if(part[0]===':')c++; }
      return a*10000+b*100+c;};
    const targets=[['思考卡片','[data-variant="think"]'],['思考标题行','[data-variant="think"] [data-disclosure-row]'],['命令卡片',':has(> [data-sample="bash"])'],['工具行','[data-tool]'],['过程组','[data-chat-flow-kind="turn-process"]']];
    const props=['background-color','border-top-width','border-top-left-radius','overflow'];
    const out=[];
    const collect=(rules,into,media)=>{ for(const r of rules){ if(r.cssRules&&!r.selectorText){ collect(r.cssRules,into,r.conditionText||r.name||'group'); continue;} if(!r.selectorText) continue; into.push({sel:r.selectorText,css:r.style&&r.style.cssText||'',media}); } };
    const all=[]; for(const sh of document.styleSheets){ try{ collect(sh.cssRules,all,'') }catch(e){} }
    for(const [name,sel] of targets){ let el=null; try{ el=document.querySelector(sel) }catch(e){} if(!el){ out.push(name+': 未找到'); continue; }
      const cs=getComputedStyle(el);
      const lines=[name+' → '+props.map(pr=>pr+'='+cs.getPropertyValue(pr)).join(' | ')];
      const inlineH=el.style.height, inlineOv=el.style.overflow;
      for(const pr of props){ const hits=[]; for(const r of all){ if(!r.css.includes(pr)) continue; let m=false; try{m=el.matches(r.sel)}catch(e){} if(!m) continue; hits.push({sel:r.sel.slice(0,86),s:spec(r.sel),media:r.media}); }
        hits.sort((x,y)=>x.s-y.s); const top=hits.slice(-3);
        if(top.length) lines.push('   '+pr+' 竞争者: '+top.map(h=>h.s+' '+(/dshas|dsh-adaptive/.test(h.sel)?'[我]':'[壳]')+' '+h.sel).join('  ||  '));
      }
      if(inlineH) lines.push('   inline height='+inlineH);
      if(inlineOv) lines.push('   inline overflow='+inlineOv);
      out.push(lines.join('\\n'));
    }
    return out.join('\\n');
  })()`));
  p.kill();
})();
