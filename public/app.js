const API = '/api/v1';
const API2 = '/api/v2';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const progress = loadProgress();
touchStreak();
renderProgress();

// ---------- Navigation ----------
$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
$$('[data-go="home"]').forEach(btn => btn.addEventListener('click', () => showTab('scam-check')));

function showTab(id) {
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === id));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'progress') renderProgress();
}

// ---------- Demo content ----------
const demos = {
  forex: 'Quit your 9-5! Use 50x leverage with my forex signals. Guaranteed £5,000 a week with zero risk. DM me today for the private group.',
  crypto: 'This meme coin is the next 100x gem. Presale closes tonight. Everyone in my group is buying. Use my link now before you miss out.',
  safe: 'Investments can rise and fall. Returns are not guaranteed. Take time to understand the fees, risks and whether the investment fits your goals.'
};
$$('.demo-chip').forEach(btn => btn.addEventListener('click', () => {
  $('claim-input').value = demos[btn.dataset.demo] || '';
  $('source-link').value = '';
  $('claim-input').focus();
}));

// ---------- Automatic transcription ----------
async function transcribeLink() {
  const link = $('source-link').value.trim();
  if (!link) return setStatus('Paste a public video link first.', 'error');

  setStatus('🎧 Listening to the video… this can take a little while.');
  $('transcribe-btn').disabled = true;
  $('transcribe-btn').textContent = 'Listening…';

  try {
    const response = await fetch(`${API}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: link })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not read this video.');
    $('claim-input').value = data.transcript || '';
    const source = data.sourceTitle ? ` · ${data.sourceTitle}` : '';
    setStatus(`✅ I heard the video${source}. Check the words below, then run Scam Check.`, 'success');
    $('claim-input').focus();
  } catch (error) {
    setStatus('I could not read this public video automatically. You can still paste the caption or words below.', 'error');
  } finally {
    $('transcribe-btn').disabled = false;
    $('transcribe-btn').textContent = '🎧 Get words';
  }
}

$('transcribe-btn').addEventListener('click', transcribeLink);
$('source-link').addEventListener('paste', () => {
  // Make "paste link" feel automatic: once the pasted value reaches the field,
  // start listening. The button remains available if the user wants to retry.
  setTimeout(() => {
    const value = $('source-link').value.trim();
    if (/^https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com)\//i.test(value)) {
      transcribeLink();
    }
  }, 80);
});

function setStatus(text, type = '') {
  const el = $('transcribe-status');
  el.textContent = text;
  el.className = `status-line ${type}`.trim();
}

// ---------- Scam check ----------
$('scan-btn').addEventListener('click', async () => {
  const claimText = $('claim-input').value.trim();
  const claimUrl = $('source-link').value.trim();
  if (claimText.length < 3) {
    setStatus('Add the words from the post first, or use “Get words” from a public video.', 'error');
    return;
  }

  const btn = $('scan-btn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const response = await fetch(`${API2}/scam-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimText, claimUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Check failed');
    renderScamResult(data);
    progress.scans += 1;
    progress.points += data.flags.length ? 5 : 2;
    saveProgress();
  } catch (error) {
    setStatus(error.message || 'FinPulse could not check this claim right now.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🛡️ Check for warning signs';
  }
});

function renderScamResult(data) {
  $('scam-empty').classList.add('hidden');
  $('scam-results').classList.remove('hidden');
  const card = $('scam-result-card');
  card.classList.remove('risk-high','risk-medium','risk-low');
  card.classList.add(`risk-${data.level.toLowerCase()}`);

  const map = {
    HIGH: ['🚨','HIGH CONCERN','We found serious warning signs'],
    MEDIUM: ['⚠️','BE CAREFUL','We found things worth checking'],
    LOW: ['🟢','FEWER WARNING SIGNS','We found fewer obvious warning signs']
  };
  const [icon,label,title] = map[data.level] || map.MEDIUM;
  $('risk-icon').textContent = icon;
  $('risk-label').textContent = label;
  $('risk-title').textContent = title;
  $('risk-summary').textContent = data.summary;
  $('checked-text').textContent = data.checkedText;
  $('offer-type').textContent = data.context?.offerType || 'Money or investment promotion';
  $('who-benefits').textContent = data.context?.whoMayBenefit || 'Not clear from the words provided.';
  $('next-step-title').textContent = data.nextStep.title;
  $('next-step-text').textContent = data.nextStep.text;

  const list = $('flag-list');
  list.innerHTML = '';
  data.flags.forEach(flag => {
    const el = document.createElement('article');
    el.className = 'flag-card';
    el.innerHTML = `
      <header><span>${flag.icon}</span><strong>${escapeHtml(flag.title)}</strong></header>
      <p>${escapeHtml(flag.why)}</p>
      ${flag.evidence ? `<div class="flag-evidence">“${escapeHtml(flag.evidence)}”</div>` : ''}
    `;
    list.appendChild(el);
  });

  if (!data.flags.length) {
    list.innerHTML = `<article class="flag-card"><header><span>ℹ️</span><strong>No common scam phrase jumped out</strong></header><p>That does not prove the offer is safe. Check who is behind it, the risks, fees and any authorisation claims independently.</p></article>`;
  }
  $('scam-result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('use-in-lab-btn').addEventListener('click', () => {
  const amountMatch = $('claim-input').value.match(/£\s?([0-9][0-9,]*)/);
  if (amountMatch) $('lab-start').value = Number(amountMatch[1].replace(/,/g,'')) || 500;
  showTab('money-lab');
});

// ---------- Money Lab ----------
$('simulate-btn').addEventListener('click', async () => {
  const payload = {
    startAmount: Number($('lab-start').value),
    monthlyContribution: Number($('lab-monthly').value),
    years: Number($('lab-years').value),
    purpose: $('lab-purpose').value,
    hasEmergencyFund: document.querySelector('input[name="emergency"]:checked').value === 'yes',
    hasHighInterestDebt: document.querySelector('input[name="debt"]:checked').value === 'yes'
  };
  const btn = $('simulate-btn');
  btn.disabled = true;
  btn.textContent = 'Building your money story…';
  try {
    const response = await fetch(`${API2}/money-lab`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Simulation failed');
    renderMoneyLab(data);
    progress.points += 5;
    saveProgress();
  } catch (error) {
    alert(error.message || 'Could not run the Money Lab right now.');
  } finally {
    btn.disabled = false;
    btn.textContent = '📊 Show me the possibilities';
  }
});

function renderMoneyLab(data) {
  $('lab-empty').classList.add('hidden');
  $('lab-output').classList.remove('hidden');
  const r = $('readiness-card');
  r.className = `readiness-card ${data.readiness.tone}`;
  r.innerHTML = `<strong>${escapeHtml(data.readiness.title)}</strong><span>${escapeHtml(data.readiness.text)}</span>`;
  $('lab-contributed').textContent = money(data.totalContributed);
  $('lab-downside').textContent = money(data.summary.downsideFinal);
  $('lab-steady').textContent = money(data.summary.steadyFinal);
  $('shock-loss').textContent = `-${money(data.shock.loss)}`;
  $('shock-copy').textContent = data.shock.text;
  $('timing-copy').textContent = data.timing;
  $('shock-start').textContent = money(data.shock.start);
  $('shock-after').textContent = money(data.shock.after);
  $('shock-shortfall').textContent = `${money(data.shock.loss)} less`;
  $('recovery-needed').textContent = `+${data.shock.recoveryNeededPct}%`;
  $('shock-recover-target').textContent = money(data.shock.start);
  $('readiness-checklist').innerHTML = (data.checklist || []).map(item => `
    <div class="check-item ${item.ok ? 'ok' : 'warn'}">
      <span>${item.ok ? '✓' : '!'}</span>
      <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.note)}</small></div>
    </div>`).join('');
  drawMoneyChart(data.trajectories);
  $('lab-output').scrollIntoView({ behavior:'smooth', block:'start' });
}

function drawMoneyChart(trajectories) {
  const canvas = $('money-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 760;
  const cssHeight = Math.max(260, cssWidth * .42);
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssWidth,cssHeight);

  const pad = {l:50,r:18,t:18,b:34};
  const w = cssWidth-pad.l-pad.r, h=cssHeight-pad.t-pad.b;
  const all = [...trajectories.contributed,...trajectories.downside,...trajectories.steady];
  const max = Math.max(...all.map(x=>x.value),1) * 1.08;
  const count = trajectories.steady.length;

  ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=1;
  for(let i=0;i<5;i++){ const y=pad.t+h*(i/4); ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke(); }
  ctx.fillStyle='rgba(210,220,235,.65)';ctx.font='12px system-ui';
  ctx.fillText('£0',8,pad.t+h+4); ctx.fillText(moneyShort(max),8,pad.t+5);

  const draw = (series, color, dash=[]) => {
    ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=3; ctx.setLineDash(dash);
    series.forEach((p,i)=>{ const x=pad.l+(i/(count-1||1))*w; const y=pad.t+h-(p.value/max)*h; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.stroke(); ctx.setLineDash([]);
  };
  draw(trajectories.contributed,'#8b96aa',[6,5]);
  draw(trajectories.downside,'#fb7185');
  draw(trajectories.steady,'#2dd4a8');
  ctx.fillStyle='rgba(210,220,235,.65)';
  ctx.fillText('Today',pad.l,pad.t+h+24); ctx.fillText(`${trajectories.steady[count-1].year}y`,pad.l+w-18,pad.t+h+24);
}

// ---------- Money Battles ----------
const battleDeck = [
  {platform:'TikTok', claim:'Guaranteed 30% profit. Send £200 tonight — only 10 places left!', options:['Send a small amount first','Slow down and check the offer','Trust it if the creator has lots of followers'], correct:1, lesson:'Guaranteed returns plus pressure to act are serious warning signs. Followers do not make an investment safe.'},
  {platform:'Instagram', claim:'I am paid when you use my link. Investments can fall as well as rise. Read the fees before deciding.', options:['The paid link must mean it is a scam','The disclosure and risk warning are useful, but I should still check the product','Any influencer investment is automatically safe'], correct:1, lesson:'A clear disclosure is better than a hidden incentive, but you still need to understand and verify the investment.'},
  {platform:'WhatsApp', claim:'Your bank account is at risk. Move your savings to this “safe account” now.', options:['Move it quickly','Call the bank using a number I find independently','Reply and ask for proof'], correct:1, lesson:'A “safe account” request is a classic warning sign. Contact your bank independently, not through the message.'},
  {platform:'YouTube', claim:'50× leverage can make small market moves much bigger. You can lose money quickly.', options:['Leverage only increases profit','Leverage magnifies gains and losses','Leverage removes market risk'], correct:1, lesson:'Leverage makes both gains and losses larger. That is why risk needs to be understood before using it.'},
  {platform:'X', claim:'This token is going 100×. Everyone is buying. DM me for the private presale wallet.', options:['The social proof makes it safer','The huge return claim and private wallet are warning signs','A private sale is always regulated'], correct:1, lesson:'Huge return claims, social pressure and private payment routes are all reasons to slow down and verify.'}
];
let battleIndex=0, battleScore=0, battleAnswered=false;
startBattle();

function startBattle(){ battleIndex=0; battleScore=0; battleAnswered=false; $('battle-finish').classList.add('hidden'); $('battle-content').classList.remove('hidden'); renderBattle(); }
function renderBattle(){
  const q=battleDeck[battleIndex]; battleAnswered=false;
  $('battle-round').textContent=`ROUND ${battleIndex+1} / ${battleDeck.length}`; $('battle-score').textContent=battleScore;
  $('battle-platform').textContent=q.platform; $('battle-claim').textContent=q.claim; $('battle-feedback').classList.add('hidden'); $('battle-next').classList.add('hidden');
  const wrap=$('battle-options'); wrap.innerHTML='';
  q.options.forEach((opt,i)=>{ const b=document.createElement('button'); b.className='battle-option'; b.textContent=opt; b.onclick=()=>answerBattle(i,b); wrap.appendChild(b); });
}
function answerBattle(i,btn){ if(battleAnswered)return; battleAnswered=true; const q=battleDeck[battleIndex]; $$('.battle-option').forEach((b,idx)=>{ b.disabled=true; if(idx===q.correct)b.style.borderColor='#2dd4a8'; });
  const correct=i===q.correct; if(correct){battleScore+=20; progress.points+=10;} $('battle-score').textContent=battleScore;
  const f=$('battle-feedback'); f.classList.remove('hidden'); f.innerHTML=`<strong>${correct?'🎉 Nice — you spotted it!':'💡 Good try — here is the key point.'}</strong><p>${escapeHtml(q.lesson)}</p>${correct?'<span>+10 FinPoints</span>':''}`;
  $('battle-next').classList.remove('hidden'); saveProgress();
}
$('battle-next').onclick=()=>{ battleIndex++; if(battleIndex>=battleDeck.length) finishBattle(); else renderBattle(); };
function finishBattle(){ $('battle-content').classList.add('hidden'); $('battle-finish').classList.remove('hidden'); progress.battles+=1; progress.bestBattle=Math.max(progress.bestBattle,battleScore); progress.points+=Math.round(battleScore/10); saveProgress(); $('battle-finish-title').textContent=`${battleScore}/100 — ${battleScore>=80?'Scam Spotter!':'Battle complete!'}`; $('battle-finish-copy').textContent=`You earned ${Math.round(battleScore/10)} bonus FinPoints. Challenge someone to beat ${battleScore}.`; }
$('battle-restart').onclick=startBattle;
$('battle-share').onclick=async()=>{ const url=new URL(window.location.href); url.searchParams.set('battle','starter'); url.searchParams.set('beat',String(battleScore)); try{await navigator.clipboard.writeText(url.toString());$('share-status').textContent='✅ Challenge link copied.';}catch{$('share-status').textContent=`Challenge score: ${battleScore}/100`;} };

// ---------- Progress ----------
function loadProgress(){ try{return {...{points:0,scans:0,battles:0,bestBattle:0,streak:1,lastVisit:''},...JSON.parse(localStorage.getItem('finpulseProgress')||'{}')}}catch{return {points:0,scans:0,battles:0,bestBattle:0,streak:1,lastVisit:''}} }
function saveProgress(){ localStorage.setItem('finpulseProgress',JSON.stringify(progress)); renderProgress(); }
function touchStreak(){ const today=new Date().toISOString().slice(0,10); if(progress.lastVisit===today)return; if(progress.lastVisit){ const gap=Math.round((new Date(today)-new Date(progress.lastVisit))/86400000); progress.streak=gap===1?(progress.streak||1)+1:1; } else progress.streak=1; progress.lastVisit=today; saveProgress(); }
function renderProgress(){ $('header-streak').textContent=progress.streak||1; $('header-points').textContent=progress.points||0; $('progress-streak').textContent=progress.streak||1; $('progress-points').textContent=progress.points||0; $('progress-scans').textContent=progress.scans||0; $('progress-battles').textContent=progress.battles||0;
  const badges=[['🛡️ Scam Spotter',progress.scans>=3,'Check 3 claims'],['🧠 Risk Reader',progress.points>=40,'Earn 40 FinPoints'],['🎮 Battle Ready',progress.battles>=1,'Finish a Money Battle'],['🔥 Streak Starter',progress.streak>=2,'Come back on another day']];
  $('achievement-list').innerHTML=badges.map(([name,on,how])=>`<span style="opacity:${on?1:.45}">${on?'✅':'🔒'} <strong>${name}</strong><br><small>${on?'Unlocked':how}</small></span>`).join('');
}

function money(n){ return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(Math.round(n||0)); }
function moneyShort(n){ if(n>=1000000)return `£${(n/1000000).toFixed(1)}m`; if(n>=1000)return `£${Math.round(n/1000)}k`; return `£${Math.round(n)}`; }
function escapeHtml(value){ return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

// Deep-link a shared Money Battle.
const params=new URLSearchParams(location.search);
if(params.get('battle')) {
  showTab('money-battles');
  const target = Number(params.get('beat'));
  if (Number.isFinite(target) && target > 0) {
    $('challenge-banner').classList.remove('hidden');
    $('challenge-banner').innerHTML = `🔥 <strong>A friend challenged you.</strong> Can you beat <strong>${Math.min(100, Math.max(0, target))}/100</strong>?`;
  }
}

// Keep the app shell available offline after the first successful visit.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
