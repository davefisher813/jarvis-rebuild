// Proves the increased-contrast block does what it claims: same screens,
// same measurement, once with the OS setting off and once with it on.
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const SAMPLES = [".voice-hint", ".tab", ".conn-meta", ".bp-sub", ".sched-cat"];
for (const theme of ["light","dark"]) {
  for (const contrast of ["no-preference","more"]) {
    const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, contrast });
    await ctx.addInitScript(()=>{const f=new Date();f.setHours(11,30,0,0);const t=f.getTime()-Date.now();const R=Date;
      class F extends R{constructor(...a){if(!a.length)super(R.now()+t);else super(...a);}static now(){return R.now()+t;}}window.Date=F;});
    const page = await ctx.newPage();
    await page.goto("http://localhost:4173/",{waitUntil:"networkidle"});
    try{await page.click('text="Skip for now"',{timeout:6000});}catch{}
    await page.waitForTimeout(1600);
    await page.evaluate((t)=>document.documentElement.setAttribute("data-theme",t), theme);
    await page.waitForTimeout(300);
    const r = await page.evaluate((SEL)=>{
      const lin=c=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
      const lum=a=>0.2126*lin(a[0])+0.7152*lin(a[1])+0.0722*lin(a[2]);
      const P=s=>{const m=(s||"").match(/[\d.]+/g);return m?m.map(Number):null};
      const bgOf=el=>{let p=el;while(p){const c=P(getComputedStyle(p).backgroundColor);if(c&&(c[3]===undefined||c[3]>0.6))return c;p=p.parentElement}return[0,0,0]};
      const out={};
      for(const sel of SEL){
        const el=document.querySelector(sel); if(!el) continue;
        const st=getComputedStyle(el); const fg=P(st.color); if(!fg) continue;
        const bg=bgOf(el); const a=fg.length>3?fg[3]:1;
        const eff=fg.slice(0,3).map((c,i)=>c*a+bg[i]*(1-a));
        const l1=lum(eff),l2=lum(bg.slice(0,3));
        out[sel]=+(((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05))).toFixed(2);
      }
      return out;
    }, SAMPLES);
    console.log(`${theme.padEnd(6)} contrast:${contrast.padEnd(14)}`, JSON.stringify(r));
    await ctx.close();
  }
}
await b.close();
