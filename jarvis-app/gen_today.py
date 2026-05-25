import os
os.chdir("/home/claude/app/src/styles")
ds=open("jarvis-design-system.css").read(); uni=open("uniformity.css").read(); comp=open("components.css").read()
SB='<div class="statusbar"><span>9:41</span><span class="sb-right"><svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2" width="3" height="10" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="17" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><path d="M12 20h.01"/></svg><svg width="26" height="13" viewBox="0 0 26 13"><rect x="0.5" y="0.5" width="21" height="12" rx="3" fill="none" stroke="currentColor" stroke-opacity="0.5"/><rect x="2" y="2" width="16" height="9" rx="1.5" fill="currentColor"/><rect x="23" y="4" width="2" height="5" rx="1" fill="currentColor" opacity="0.5"/></svg></span></div>'
def ic(d,c="ic"): return f'<svg class="{c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{d}</svg>'
CHEV=ic('<polyline points="9 18 15 12 9 6"/>','chev')
MIC=ic('<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3M9 21h6"/>')
I_SUG=ic('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>')
I_CAL=ic('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>')
I_CHK=ic('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>')
I_SUN=ic('<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.2" y1="10.2" x2="5.6" y2="11.6"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.4" y1="11.6" x2="19.8" y2="10.2"/><polyline points="8 6 12 2 16 6"/><line x1="3" y1="22" x2="21" y2="22"/>')
I_PROJ=ic('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>')
I_HEART=ic('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>')
I_MSG=ic('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>')
I_BRAIN=ic('<path d="M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>')
T_HOME=ic('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>')
T_TASKS=ic('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>')
T_MORE=ic('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>')
def sechead(icon,icocls,title,action,live):
    badge='' if live else '<span class="soon">soon</span>'
    return f'<div class="sec-head"><div class="sec-left"><div class="sec-ico {icocls}">{icon}</div><div class="sec-title">{title}</div>{badge}</div><button class="see-all">{action}</button></div>'
def card(inner): return f'<div class="pad-x"><div class="card">{inner}</div></div>'
def sugrow(cat,title,tag,cls): return f'<div class="suggestion-row"><span class="cat-dot cat-bg-{cat}"></span><div class="sug-title">{title}</div><span class="sug-urgency urgency-{cls}">{tag}</span></div>'
def srow(t,ap,title,cat,loc,past=False): return f'<div class="sched-row{" past" if past else ""}"><div class="sched-time">{t}<span class="ampm">{ap}</span></div><div class="sched-body"><div class="sched-title">{title}</div><div class="sched-cat"><span class="cat-dot cat-bg-{cat}"></span>{loc}</div></div></div>'
PAUSE='<svg class="icon-pause" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
PLAY='<svg class="icon-play" viewBox="0 0 24 24"><polygon points="7,5 19,12 7,19"/></svg>'
NOWLINE='<div class="now-line"><span class="now-label">Now 1:13</span><span class="now-rule"></span></div>'
TOGGLE_JS="(function(b){var t=b.closest('.yourday').querySelector('.sched-ticker');t.classList.toggle('paused');b.classList.toggle('paused');})(this)"
def dayset():
    return (srow("11:00","AM","Morning Standup","bffsa","BFFSA Board",True)+srow("12:30","PM","Lunch With Jose","family","Cafe Rio",True)+NOWLINE+srow("2:00","PM","Goldman Partner Call","tucci","9th Ave Office")+srow("4:30","PM","Tucci Weekly Sync","tucci","Zoom")+srow("6:00","PM","Long Run, 8 Miles","health","Riverside Park"))
def yourday():
    head=('<div class="sec-head"><div class="sec-left"><div class="sec-ico ico-blue">'+I_CAL+'</div><div class="sec-title">Your Day</div>'
      f'<button class="ticker-toggle" onclick="{TOGGLE_JS}">{PAUSE}{PLAY}</button></div><button class="see-all">Schedule</button></div>')
    ticker=f'<div class="pad-x"><div class="card sched-ticker"><div class="ticker-track">{dayset()}{dayset()}</div></div></div>'
    return f'<div class="yourday">{head}{ticker}</div>'
def trow(cat,title,tag,cls): return f'<div class="task-row"><div class="task-check cat-bd-{cat}"></div><div class="task-title">{title}</div><span class="urgency urgency-{cls}">{tag}</span></div>'
def trow_done(title): return f'<div class="task-row completed"><div class="task-check done"></div><div class="task-title">{title}</div></div>'
def prow(letter,cat,tag,title): return f'<div class="proj-row"><div class="proj-icon cat-bg-{cat}">{letter}</div><div class="proj-meta"><div class="proj-tag">{tag}</div><div class="proj-title">{title}</div></div>{CHEV}</div>'
def lmrow(cat,name,status,scls,pct): return f'<div class="lifemap-row"><div class="lifemap-head"><span class="cat-dot cat-bg-{cat}"></span><div class="lifemap-name">{name}</div><div class="lifemap-status {scls}">{status}</div></div><div class="lifemap-bar"><div class="lifemap-fill cat-bg-{cat}" style="width:{pct}%"></div></div></div>'
def mrow(letter,cat,name,time,prev): return f'<div class="msg-row"><div class="av av-40 cat-bg-{cat}">{letter}</div><div class="msg-body"><div class="msg-head"><div class="msg-name">{name}</div><div class="msg-time">{time}</div></div><div class="msg-preview">{prev}</div></div></div>'
def brow(title,meta): return f'<div class="row"><span class="cat-dot cat-bg-brain"></span><div class="row-stack"><div class="conn-name truncate">{title}</div><div class="conn-meta">{meta}</div></div></div>'
header=('<div class="today-bar"><div class="av av-32 cat-bg-tucci">DF</div></div>'
 '<div class="today-hero"><div class="eyebrow">Wednesday, May 20</div>'
 '<div class="today-title">Good Morning, Dave</div>'
 '<div class="today-summary">3 events &middot; 2 tasks due &middot; <span class="fg-red">1 overdue</span></div></div>')
s1=sechead(I_SUG,"ico-accent","JARVIS Suggests","See All",False)+card(sugrow("tucci","Confirm Goldman Agenda","Urgent","red")+sugrow("money","Review Q3 Budget","Soon","warn")+sugrow("friends","Reply To Henry About Coffee","Low","muted"))
s2=yourday()
s3=sechead(I_CHK,"ico-good","Today\u2019s Tasks","See All",True)+card(trow("tucci","Send Intro To Mike Chen","Overdue","red")+trow("money","Approve Vendor Invoice","EOD","muted")+trow_done("Sign Client Agreement"))
s4=sechead(I_SUN,"ico-blue","Tomorrow","Thu, May 21",True)+card(srow("9:00","AM","Dentist","health","Dr. Patel")+srow("3:00","PM","Call With Henry","friends","Phone"))
s5=sechead(I_PROJ,"cat-bg-elite","Active Projects","See All",False)+card(prow("T","tucci","Tucci","Q3 Financial Review")+prow("B","bffsa","BFFSA Board","Annual Gala Planning")+prow("E","elite","Elite","Partner Onboarding"))
s6=sechead(I_HEART,"cat-bg-family","Life Map","See All",False)+card(lmrow("family","Family","Drifting","drifting",45)+lmrow("friends","Friends","Slipping","slipping",28)+lmrow("health","Health","On Track","active",78))
s7=sechead(I_MSG,"cat-bg-tucci","Recent Messages","See All",False)+card(mrow("W","tucci","Wei Chang","11:48 AM","Can we move the partner call to Thursday?")+mrow("H","friends","Henry Tolentino","11:55 AM","Coffee next week? I\u2019m around Tuesday.")+mrow("M","family","Mom","1:12 PM","Don\u2019t forget lunch on Saturday!"))
s8=sechead(I_BRAIN,"cat-bg-brain","From Your Brain","View",False)+card(brow("Goldman Pitch Deck Notes","Saved 2 days ago")+brow("Q3 Budget Assumptions","Saved last week"))
content=header+s1+s2+s3+s4+s5+s6+s7+s8
tabs=''.join(f'<div class="tab{" active" if k=="Today" else ""}">{i}{k}</div>' for k,i in [("Today",T_HOME),("Tasks",T_TASKS),("Schedule",I_CAL),("Brain",I_BRAIN),("More",T_MORE)])
voice=f'<div class="pad-x voice-dock"><div class="voice-bar"><div class="voice-mic">{MIC}</div><div class="voice-name">JARVIS</div><div class="voice-hint">Tap to speak</div></div></div>'
EXTRA='.soon{font-size:var(--t-eyebrow);text-transform:uppercase;letter-spacing:var(--track-caps);color:var(--tx-3);background:var(--surface-3);padding:2px 6px;border-radius:var(--r-xs);font-weight:var(--w-semi);}'
FS=""".app{--safe-top:0px;--safe-bottom:0px;display:flex;flex-direction:column;height:100dvh;background:var(--bg);color:var(--tx-1);overflow:hidden;}.app .scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.statusbar{display:flex;align-items:center;justify-content:space-between;padding:0 var(--s-6);height:50px;flex-shrink:0;font-size:var(--t-body);font-weight:var(--w-semi);}.statusbar .sb-right{display:flex;align-items:center;gap:var(--s-1h);}.statusbar svg{display:block;}
.home-indicator{height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}.hi-bar{width:134px;height:5px;border-radius:3px;background:var(--tx-1);opacity:.85;}
.dock{flex-shrink:0;background:var(--bg);}.voice-dock{padding-bottom:var(--s-3);}
.theme-toggle{position:fixed;top:calc(env(safe-area-inset-top,12px) + 8px);left:12px;z-index:99;background:var(--surface-3);color:var(--tx-1);border:0.5px solid var(--divider);border-radius:var(--r-pill);padding:6px 12px;font:600 12px -apple-system,system-ui,sans-serif;}"""
HI='<div class="home-indicator"><div class="hi-bar"></div></div>'
dock=f'<div class="dock">{voice}<div class="tab-bar">{tabs}</div>{HI}</div>'
fs=f'''<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Today</title><style>{ds}\n{uni}\n{comp}\n{FS}\n{EXTRA}</style></head><body><button class="theme-toggle" onclick="var h=document.documentElement;h.dataset.theme=h.dataset.theme==='dark'?'light':'dark';this.textContent=h.dataset.theme==='dark'?'Light':'Dark';">Light</button><div class="app">{SB}<div class="scroll">{content}</div>{dock}</div></body></html>'''
open("/tmp/todayfs.html","w").write(fs)
DCSS=""".pv-wrap{display:flex;flex-direction:column;gap:32px;align-items:center;}.pv-col{display:flex;flex-direction:column;align-items:center;gap:10px;}.pv-label{color:#fff;font-size:13px;font-weight:700;}body{margin:0;background:#2c2c30;font-family:-apple-system,system-ui,sans-serif;padding:24px 12px;}
.device{--safe-top:0px;--safe-bottom:0px;position:relative;width:360px;height:880px;margin:0 auto;background:var(--bg);color:var(--tx-1);border-radius:44px;overflow:hidden;box-shadow:0 0 0 1px var(--divider);display:flex;flex-direction:column;}.device .scroll{flex:1;overflow-y:auto;}.statusbar{display:flex;align-items:center;justify-content:space-between;padding:0 var(--s-6);height:50px;flex-shrink:0;font-size:var(--t-body);font-weight:var(--w-semi);color:var(--tx-1);}.statusbar .sb-right{display:flex;align-items:center;gap:var(--s-1h);}.statusbar svg{display:block;}.home-indicator{height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}.dock{flex-shrink:0;background:var(--bg);}.voice-dock{padding-bottom:var(--s-3);}"""
HI2='<div class="home-indicator"><div style="width:134px;height:5px;border-radius:3px;background:var(--tx-1);opacity:.85"></div></div>'
dock2=f'<div class="dock">{voice}<div class="tab-bar">{tabs}</div></div>'
dev=lambda t,l:f'<div class="pv-col"><div class="pv-label">{l}</div><div class="device" data-theme="{t}">{SB}<div class="scroll">{content}</div>{dock2}{HI2}</div></div>'
dv=f'<!doctype html><html lang="en"><head><meta charset="utf-8"><style>{ds}\n{uni}\n{comp}\n{DCSS}\n{EXTRA}</style></head><body><div class="pv-wrap">{dev("dark","DARK")}{dev("light","LIGHT")}</div></body></html>'
open("/tmp/todaydv.html","w").write(dv)
print("em-dashes:", fs.count("\u2014")+dv.count("\u2014"))
