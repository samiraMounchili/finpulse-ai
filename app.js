const API = '/api/v1';
const API2 = '/api/v2';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let lastSourceTitle = '';
let lastSourceDescription = '';

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
    lastSourceTitle = data.sourceTitle || '';
    lastSourceDescription = data.sourceDescription || '';
    const source = data.sourceTitle ? ` · ${data.sourceTitle}` : '';
    setStatus(`✅ I heard the video${source}. Check the words below, then run Money Check.`, 'success');
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
      body: JSON.stringify({ claimText, claimUrl, sourceTitle: lastSourceTitle, sourceDescription: lastSourceDescription })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Check failed');
    renderScamResult(data);
    progress.scans += 1;
    markDaily('scan');
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
  card.classList.add(`risk-${String(data.level || 'MEDIUM').toLowerCase()}`);

  const riskMap = {
    HIGH: ['🚨','SERIOUS SCAM-STYLE SIGNALS'],
    MEDIUM: ['⚠️','SOME WARNING SIGNALS'],
    LOW: ['🧠','FINANCIAL CONTENT ANALYSIS']
  };
  const [icon,label] = riskMap[data.level] || riskMap.MEDIUM;
  $('risk-icon').textContent = icon;
  $('risk-label').textContent = label;
  $('risk-title').textContent = 'FinPulse take';
  $('risk-summary').textContent = data.assessment?.verdict || data.summary || '';

  $('offer-type').textContent = data.context?.topic || '💡 General money / financial content';
  $('who-benefits').textContent = `${data.context?.contentType || 'Financial discussion'} · ${data.context?.whoMayBenefit || ''}`;

  const claim = data.mainClaim || {};
  $('claim-list').innerHTML = `
    <article class="flag-card insight-card">
      <header><span>🧠</span><strong>${escapeHtml(claim.type || 'Main claim')}</strong></header>
      <p class="claim-main">${escapeHtml(claim.text || 'No main claim identified.')}</p>
      <div class="analysis-line"><b>How FinPulse reads it:</b> ${escapeHtml(claim.nature || 'Financial claim')}</div>
      <div class="flag-evidence">${escapeHtml(claim.interpretation || '')}</div>
    </article>
    ${claim.calculation ? `<article class="flag-card number-card"><header><span>🧮</span><strong>Put the claim into numbers</strong></header><h4>${escapeHtml(claim.calculation.title)}</h4><p>${escapeHtml(claim.calculation.headline)}</p><div class="flag-evidence">${escapeHtml(claim.calculation.detail)}</div></article>` : ''}
    ${(claim.evidenceShown || []).length ? `<article class="flag-card"><header><span>🔎</span><strong>What evidence the video actually shows</strong></header>${claim.evidenceShown.map(x=>`<p>• ${escapeHtml(x)}</p>`).join('')}</article>` : ''}
  `;

  const a = data.assessment || {};
  $('assessment-box').innerHTML = `
    <div class="assessment-grid">
      <div><span>Financial risk</span><strong>${escapeHtml(a.financialRisk || '—')}</strong></div>
      <div><span>Scam-style signals</span><strong>${escapeHtml(a.scamRisk || '—')}</strong></div>
      <div><span>Evidence quality</span><strong>${escapeHtml(a.evidenceQuality || '—')}</strong></div>
    </div>
    <article class="flag-card"><header><span>🎬</span><strong>How the content is framed</strong></header><p>${escapeHtml(a.framing || '')}</p></article>
    ${(a.missing || []).length ? `<article class="flag-card"><header><span>🧩</span><strong>What is missing</strong></header>${a.missing.map(x=>`<p>• ${escapeHtml(x)}</p>`).join('')}</article>` : ''}
  `;

  $('scenario-box').innerHTML = `
    <article class="scenario good"><header><span>↗️</span><strong>What could go right</strong></header><p>${escapeHtml(data.scenarios?.up || '')}</p></article>
    <article class="scenario bad"><header><span>↘️</span><strong>What could go wrong</strong></header><p>${escapeHtml(data.scenarios?.down || '')}</p></article>
  `;

  const conceptBox = $('concept-list');
  conceptBox.innerHTML = (data.concepts || []).map(c => `<article class="flag-card"><header><span>💡</span><strong>${escapeHtml(c.term)}</strong></header><p>${escapeHtml(c.plain)}</p></article>`).join('');

  const list = $('flag-list');
  list.innerHTML = data.flags?.length ? data.flags.map(flag => `<article class="flag-card"><header><span>${flag.icon}</span><strong>${escapeHtml(flag.title)}</strong></header><p>${escapeHtml(flag.why)}</p>${flag.evidence?`<div class="flag-evidence">“${escapeHtml(flag.evidence)}”</div>`:''}</article>`).join('') : `<article class="flag-card"><header><span>ℹ️</span><strong>No strong scam-style signal identified</strong></header><p>This is separate from investment risk. Risky or incomplete financial content can still deserve caution without being a scam.</p></article>`;

  $('verify-list').innerHTML = (data.verify || []).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  $('next-step-title').textContent = data.nextStep?.title || 'Check before acting';
  $('next-step-text').textContent = data.nextStep?.text || '';
  $('scam-result-card').scrollIntoView({ behavior:'smooth', block:'start' });
}

$('use-in-lab-btn').addEventListener('click', () => {
  const amountMatch = $('claim-input').value.match(/£\s?([0-9][0-9,]*)/);
  if (amountMatch) $('lab-start').value = Number(amountMatch[1].replace(/,/g,'')) || 500;
  showTab('money-lab');
});

// ---------- Money Lab ----------
const ASSETS = {
  fund:{icon:'🌍',name:'Funds & ETFs',what:'Your money buys units in a fund that can hold many investments at once.',example:'UK example: a FTSE 100 tracker follows large UK-listed companies. UK investors can also choose broader global funds.',visual:'£ → fund → many companies',risk:'Medium',lesson:'Diversification spreads your exposure. It reduces reliance on one company, but it does not remove market risk.'},
  share:{icon:'🏢',name:'Company Shares',what:'You buy a small ownership stake in one company. Your result depends much more on that business.',example:'UK examples could include companies listed on the London Stock Exchange. FinPulse does not recommend a particular share.',visual:'£ → one company',risk:'Medium–high',lesson:'Concentration risk means one company can have a large effect on your money.'},
  gilt:{icon:'🏛️',name:'UK Gilts',what:'You lend money to the UK Government. Gilts normally pay interest and repay principal at maturity, subject to their terms.',example:'Gilts are UK Government bonds. Their market price can still rise or fall before maturity.',visual:'£ → UK Government → interest + repayment terms',risk:'Lower–medium',lesson:'Bond prices and interest rates move in opposite directions. Inflation can also reduce the real value of fixed payments.'},
  corp:{icon:'💼',name:'Corporate Bonds',what:'You lend money to a company rather than owning part of it.',example:'The company promises interest and repayment under the bond terms, but companies can run into financial trouble.',visual:'£ → company debt → interest + credit risk',risk:'Medium',lesson:'Credit risk is the chance that the company cannot make promised payments.'},
  reit:{icon:'🏠',name:'Property / REITs',what:'You buy exposure to property businesses or portfolios without buying an entire building yourself.',example:'UK REITs can own assets such as warehouses, offices, shops or housing-related property.',visual:'£ → property portfolio → rent + property values',risk:'Medium',lesson:'Property investments can earn income, but values, rents, borrowing costs and occupancy can change.'},
  crypto:{icon:'🪙',name:'Cryptoassets',what:'You buy a digital asset whose market price can move very sharply.',example:'Crypto is not the same as cash savings or a diversified fund. UK regulators describe crypto as high risk.',visual:'£ → cryptoasset → highly volatile market price',risk:'Very high',lesson:'Large gains are possible, but so are very large losses. A 50% fall needs a 100% gain just to recover.'}
};
let labChecks={emergency:true,debt:false};
function selectAsset(key){
  const a=ASSETS[key]; if(!a)return;
  $('lab-asset').value=key;
  document.querySelectorAll('.asset-choice').forEach(b=>{
    const selected=b.dataset.asset===key;
    b.classList.toggle('selected',selected);
    b.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  $('asset-explainer').innerHTML=`
    <div class="asset-explainer-top">
      <span class="asset-big-icon">${a.icon}</span>
      <div>
        <span class="step-pill">UNDERSTAND IT</span>
        <div class="explainer-kicker">What are you actually investing in?</div>
        <h2>${escapeHtml(a.name)}</h2>
        <p>${escapeHtml(a.what)}</p>
      </div>
    </div>
    <div class="asset-flow">${escapeHtml(a.visual)}</div>
    <div class="asset-facts">
      <div><span>UK example</span><p>${escapeHtml(a.example)}</p></div>
      <div class="risk-fact"><span>Risk level</span><strong>${escapeHtml(a.risk)}</strong></div>
    </div>
    <div class="explainer-action">Next: enter your own amount below to see possible outcomes.</div>`;
}
document.querySelectorAll('.asset-choice').forEach(b=>b.addEventListener('click',()=>selectAsset(b.dataset.asset)));
selectAsset('fund');

document.querySelectorAll('.quick-check').forEach(b=>b.addEventListener('click',()=>{ const k=b.dataset.check; labChecks[k]=!labChecks[k]; b.classList.toggle('active',labChecks[k]); }));
['stress','readiness','learn'].forEach(k=>$(k+'-toggle').addEventListener('click',()=>$(k+'-panel').classList.toggle('hidden')));

$('simulate-btn').addEventListener('click', async () => {
  const payload={assetType:$('lab-asset').value,startAmount:Number($('lab-start').value),monthlyContribution:Number($('lab-monthly').value),years:Number($('lab-years').value),purpose:$('lab-purpose').value,hasEmergencyFund:labChecks.emergency,hasHighInterestDebt:labChecks.debt};
  const btn=$('simulate-btn'); btn.disabled=true; btn.textContent='Building your money story…';
  try{const response=await fetch(`${API2}/money-lab`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Simulation failed');renderMoneyLab(data);progress.points+=5; progress.labs=(progress.labs||0)+1; markDaily('lab'); saveProgress();}catch(e){alert(e.message||'Could not run Money Lab.');}finally{btn.disabled=false;btn.textContent='📊 Show me the possibilities';}
});
function renderMoneyLab(data){
  $('lab-empty').classList.add('hidden');$('lab-output').classList.remove('hidden');
  $('lab-asset-result').innerHTML=`<strong>${data.asset.icon} ${escapeHtml(data.asset.name)}</strong><span>${escapeHtml(data.asset.resultNote)}</span>`;
  $('lab-contributed').textContent=money(data.totalContributed);$('lab-downside').textContent=money(data.summary.downsideFinal);$('lab-steady').textContent=money(data.summary.steadyFinal);$('lab-strong').textContent=money(data.summary.strongFinal);
  renderMoneyGrowthBars(data);
  const a=data.assumptions||{};
  $('lab-calculation-explanation').innerHTML=`<p>FinPulse starts with your <strong>${money(data.totalContributed)}</strong> total contributions and applies different illustrative return paths to the investment you selected.</p><div class="calculation-grid"><span><strong>Tough</strong>${Number(a.toughAnnualPct||0).toFixed(1)}%/yr + ${a.stressFallPct||0}% stress fall</span><span><strong>Middle</strong>${Number(a.middleAnnualPct||0).toFixed(1)}%/yr</span><span><strong>Stronger</strong>${Number(a.strongAnnualPct||0).toFixed(1)}%/yr</span></div><p class="calculation-note">Monthly contributions are added throughout the period and returns compound monthly. Fees and inflation are <strong>not included</strong> in these headline bars. These assumptions are learning scenarios, not forecasts of future market returns.</p>`;
  $('lab-personal-meaning').textContent=data.guidance?.meaning||'';
  $('lab-considerations').innerHTML=(data.guidance?.considerations||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  $('shock-start').textContent=money(data.shock.start);$('shock-rate').textContent=`−${data.shock.fallPct}%`;$('shock-after').textContent=money(data.shock.after);$('shock-shortfall').textContent=`${money(data.shock.loss)} less`;$('recovery-needed').textContent=`+${data.shock.recoveryNeededPct}%`;$('shock-recover-target').textContent=money(data.shock.start);$('shock-copy').textContent=data.shock.text;
  const r=$('readiness-card');r.className=`readiness-card ${data.readiness.tone}`;r.innerHTML=`<strong>${escapeHtml(data.readiness.title)}</strong><span>${escapeHtml(data.readiness.text)}</span>`;$('timing-copy').textContent=data.timing;
  $('readiness-checklist').innerHTML=(data.checklist||[]).map(i=>`<div class="check-item ${i.ok?'ok':'warn'}"><span>${i.ok?'✓':'!'}</span><div><strong>${escapeHtml(i.label)}</strong><small>${escapeHtml(i.note)}</small></div></div>`).join('');
  $('asset-lessons').innerHTML=(data.lessons||[]).map(x=>`<div class="lesson-chip"><strong>${escapeHtml(x.title)}</strong><p>${escapeHtml(x.text)}</p></div>`).join('');
  drawMoneyChart(data.trajectories);$('lab-output').scrollIntoView({behavior:'smooth',block:'start'});
}

function renderMoneyGrowthBars(data){
  const rows=[
    {label:'You contributed',value:data.totalContributed,kind:'contributed',note:'Your own money'},
    {label:'Tough scenario',value:data.summary.downsideFinal,kind:'tough',note:'Includes a stress fall'},
    {label:'Middle scenario',value:data.summary.steadyFinal,kind:'middle',note:'Smoother illustration'},
    {label:'Stronger scenario',value:data.summary.strongFinal,kind:'strong',note:'Stronger illustration'}
  ];
  const max=Math.max(...rows.map(x=>x.value),1);
  $('money-growth-bars').innerHTML=rows.map(r=>{
    const pct=Math.max(6,Math.round((r.value/max)*100));
    const diff=r.value-data.totalContributed;
    const delta=r.kind==='contributed'?'':`${diff>=0?'+':'−'}${money(Math.abs(diff))} vs contributions`;
    return `<div class="money-bar-row"><div class="money-bar-label"><strong>${escapeHtml(r.label)}</strong><span>${escapeHtml(r.note)}</span></div><div class="money-bar-track"><div class="money-bar-fill ${r.kind}" style="width:${pct}%"></div></div><div class="money-bar-value"><strong>${money(r.value)}</strong><small>${escapeHtml(delta)}</small></div></div>`;
  }).join('');
}
function drawMoneyChart(t){
 const c=$('money-chart'),ctx=c.getContext('2d'),dpr=window.devicePixelRatio||1,w=c.clientWidth||760,h=330;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const all=[...t.contributed,...t.downside,...t.steady,...t.strong],max=Math.max(...all.map(p=>p.value),1),maxY=Math.max(...all.map(p=>p.year),1),pad=34;ctx.strokeStyle='#d9dfec';ctx.lineWidth=1;for(let i=0;i<5;i++){let y=pad+(h-pad*2)*i/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();}const sets=[t.contributed,t.downside,t.steady,t.strong];sets.forEach((s,si)=>{ctx.lineWidth=si===0?2:3;ctx.setLineDash(si===0?[5,5]:[]);ctx.strokeStyle=['#6b7280','#dc5964','#2f8f72','#6557c7'][si];ctx.beginPath();s.forEach((p,i)=>{let x=pad+(w-pad*2)*(p.year/maxY),y=h-pad-(h-pad*2)*(p.value/max);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();});ctx.setLineDash([]);
}

// ---------- Money Battles: Money Sense ----------
// A mixed-difficulty question bank. Five questions are sampled each battle and
// answer positions are shuffled, so repeat plays test judgement rather than memory.
const moneySenseBank = [
  {category:'Everyday money',skill:'Protecting essential money',difficulty:'Easy',prompt:'You have £800 saved and your rent is due in two weeks. A video says a cryptoasset could “explode” this month. What makes the most sense?',answers:[['Protect the rent money before considering a high-risk investment',true],['Put all £800 in before the price rises',false],['Borrow for rent and invest the savings',false],['Invest half so you do not miss out',false]],lesson:'Money needed soon for essentials should not depend on a highly volatile investment. Protecting the rent comes before chasing a possible return.'},
  {category:'Everyday money',skill:'Emergency savings',difficulty:'Easy',prompt:'Your washing machine breaks and you have £600 in emergency savings. A friend says you should invest the whole £600 instead because “cash is wasted”. What makes the most sense?',answers:[['Keep enough accessible for the emergency before thinking about investing',true],['Invest it all because markets always recover quickly',false],['Use a credit card for the repair and invest the cash',false],['Choose the riskiest asset to replace the repair cost',false]],lesson:'Emergency savings are there to handle unexpected costs without forcing you to borrow or sell an investment at a bad time.'},
  {category:'Everyday money',skill:'Borrowing & interest',difficulty:'Medium',prompt:'You owe £1,500 on a high-interest credit card and also want to start investing £100 a month. What should you think about first?',answers:[['Compare the debt cost with the uncertain investment return and prioritise expensive debt',true],['Ignore the card because investment returns are guaranteed',false],['Borrow more so you can invest a larger amount',false],['Only make the minimum payment forever',false]],lesson:'High-interest debt creates a known cost. Investment returns are uncertain, so expensive debt can undermine progress even while an investment grows.'},
  {category:'Everyday money',skill:'BNPL & affordability',difficulty:'Medium',prompt:'You use Buy Now Pay Later for several purchases. Each payment looks small, but three instalments fall due just before payday. What is the key risk?',answers:[['Several small commitments can combine into a cash-flow problem',true],['BNPL never counts as borrowing',false],['Small instalments cannot affect a budget',false],['The only risk is missing reward points',false]],lesson:'Affordability is about the total commitments and when they fall due, not whether each individual payment looks small.'},
  {category:'Everyday money',skill:'Savings & inflation',difficulty:'Hard',prompt:'Your savings account pays 3% for a year while prices rise by 4%. Your balance grows. What happened to its buying power, approximately?',answers:[['It fell slightly in real terms',true],['It definitely rose by 7%',false],['It stayed exactly the same',false],['Inflation only affects investments, not cash',false]],lesson:'If prices rise faster than your savings rate, the cash balance can increase while its real buying power falls.'},
  {category:'Investing',skill:'Diversification',difficulty:'Easy',prompt:'A friend made a large gain on one UK company share and tells you to put all your savings into the same company. What risk matters most?',answers:[['Concentration risk — one company could have an outsized effect on your money',true],['Diversification risk — owning one company is too diversified',false],['There is no risk if the company is listed in the UK',false],['The share cannot fall after a strong year',false]],lesson:'Putting everything into one company concentrates your outcome on that business. Diversification spreads exposure but does not remove market risk.'},
  {category:'Investing',skill:'Loss & recovery',difficulty:'Hard',prompt:'An investment falls 50%, from £1,000 to £500. Roughly what gain is needed from £500 to get back to £1,000?',answers:[['100%',true],['50%',false],['25%',false],['75%',false]],lesson:'After a 50% fall, the remaining £500 must double to return to £1,000. Losses and recovery percentages are not symmetrical.'},
  {category:'Investing',skill:'Time horizon',difficulty:'Medium',prompt:'You plan to use £10,000 for a house deposit in 12 months. Which consideration matters most before putting it into volatile shares?',answers:[['You may need the money before there is time to recover from a market fall',true],['Shares cannot fall over a 12-month period',false],['A house deposit automatically makes investing tax-free',false],['The number of companies in the FTSE is the only thing that matters',false]],lesson:'A short time horizon can make market volatility more consequential because you may have to withdraw during a downturn.'},
  {category:'Investing',skill:'Fees',difficulty:'Hard',prompt:'Two funds follow similar markets, but one charges materially higher ongoing fees. Why should the fee matter over a long period?',answers:[['Fees reduce the amount left to compound over time',true],['Fees only matter in the first month',false],['A higher fee guarantees a higher return',false],['Fund fees are refunded whenever markets fall',false]],lesson:'Ongoing fees reduce returns year after year and also reduce the amount that can compound. Cost is one factor to compare alongside risk and what the fund actually holds.'},
  {category:'Investing',skill:'Gilts & interest-rate risk',difficulty:'Hard',prompt:'You buy a long-dated UK gilt, then market interest rates rise sharply. What can happen to the gilt’s market price before maturity?',answers:[['It can fall because newer bonds may offer more attractive yields',true],['It must rise by the same amount as interest rates',false],['Gilts can never change price',false],['The UK government automatically cancels the bond',false]],lesson:'Gilts have lower credit risk than many investments, but their market prices can still move. Longer-dated bonds can be sensitive to changing interest rates.'},
  {category:'Investing',skill:'Crypto volatility',difficulty:'Medium',prompt:'A cryptoasset rises 40% in a week and someone says that proves it is now “safe”. What is the better interpretation?',answers:[['A recent rise does not remove volatility or the possibility of a large loss',true],['A 40% rise guarantees another 40% next week',false],['Price increases eliminate investment risk',false],['Crypto becomes protected from losses after a strong week',false]],lesson:'A strong recent return describes what already happened. It does not tell you what will happen next or remove the possibility of a sharp fall.'},
  {category:'Social media & scams',skill:'Checking claims',difficulty:'Easy',prompt:'A creator says “guaranteed 25% return in 30 days”, shows profit screenshots and asks you to DM immediately. What deserves the most scrutiny?',answers:[['The guaranteed return, urgency and whether the offer can be independently verified',true],['Only the creator’s follower count',false],['Whether the video has good editing',false],['Whether friends have liked the post',false]],lesson:'Guaranteed high returns and pressure to act are serious warning signs. Screenshots and follower counts are not independent proof.'},
  {category:'Social media & scams',skill:'Safe-account scams',difficulty:'Medium',prompt:'Someone claiming to be from your bank says your account is compromised and tells you to move money to a “safe account”. What should you do?',answers:[['Stop and contact your bank independently using a trusted number or app',true],['Transfer first and verify later',false],['Send them your PIN so they can protect the account',false],['Keep chatting until they prove they know your balance',false]],lesson:'A request to move money to a “safe account” is a major scam warning sign. End the contact and reach your bank through a channel you trust.'},
  {category:'Everyday money + investing',skill:'Loss behaviour',difficulty:'Hard',prompt:'Your £1,000 investment falls to £700. You feel angry and want to put another £1,000 into a much riskier trade purely to win the loss back quickly. What is the danger?',answers:[['Loss chasing can push you into taking more risk for emotional reasons',true],['A larger risk guarantees a faster recovery',false],['Previous losses make the next trade more likely to win',false],['The safest response is always to double the position immediately',false]],lesson:'Trying to “win back” a loss can lead to escalating risk without improving the underlying decision. Reassess the investment and your goals rather than reacting to the loss.'},
  {category:'Everyday money + investing',skill:'Goal matching',difficulty:'Medium',prompt:'You have emergency savings, no expensive debt and money you will not need for at least 10 years. Which question is still important before investing?',answers:[['Whether the investment’s risk, diversification, fees and purpose fit your goal',true],['Nothing else — a long timeframe guarantees profit',false],['Only whether it went up last month',false],['Only whether a social-media creator owns it',false]],lesson:'A stronger financial foundation can make investing easier to consider, but you still need to understand what you own, its risks, costs and how it fits your goal.'},
  {category:'Everyday money',skill:'Budget resilience',difficulty:'Medium',prompt:'After bills and essentials you normally have £120 left each month. A new investment plan requires a fixed £150 monthly contribution. What should you notice?',answers:[['The contribution may not be affordable without squeezing essentials or creating debt',true],['Investing automatically creates the missing £30',false],['Essential bills should be skipped when markets are rising',false],['A fixed contribution can never be changed',false]],lesson:'A plan has to fit real cash flow. Investing should not depend on repeatedly borrowing or missing essential costs.'}
];

let activeBattle=[], battleIndex=0, battleScore=0, battleAnswered=false, battleResults=[];
startBattle();

function shuffleCopy(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function makeBattle(){
  // Aim for a genuine mix: at least two everyday-led and two investing-led scenarios.
  const everyday=shuffleCopy(moneySenseBank.filter(q=>q.category.includes('Everyday'))).slice(0,2);
  const investing=shuffleCopy(moneySenseBank.filter(q=>q.category==='Investing')).slice(0,2);
  const used=new Set([...everyday,...investing]);
  const fifth=shuffleCopy(moneySenseBank.filter(q=>!used.has(q)))[0];
  return shuffleCopy([...everyday,...investing,fifth]);
}
function startBattle(){
  activeBattle=makeBattle(); battleIndex=0; battleScore=0; battleAnswered=false; battleResults=[];
  $('battle-finish').classList.add('hidden'); $('battle-content').classList.remove('hidden'); $('share-status').textContent=''; renderBattle();
}
function renderBattle(){
  const q=activeBattle[battleIndex]; battleAnswered=false;
  $('battle-round').textContent=`QUESTION ${battleIndex+1} / 5 · ${q.difficulty.toUpperCase()}`; $('battle-score').textContent=battleScore;
  $('battle-platform').textContent=q.category.toUpperCase(); $('battle-claim').textContent=q.prompt;
  $('battle-feedback').classList.add('hidden'); $('battle-next').classList.add('hidden');
  const shuffled=shuffleCopy(q.answers.map(([text,correct])=>({text,correct})));
  const wrap=$('battle-options'); wrap.innerHTML='';
  shuffled.forEach(ans=>{ const b=document.createElement('button'); b.className='battle-option'; b.textContent=ans.text; b.onclick=()=>answerBattle(ans,b); wrap.appendChild(b); });
}
function answerBattle(ans,btn){
  if(battleAnswered)return; battleAnswered=true; const q=activeBattle[battleIndex]; const correct=ans.correct;
  $$('.battle-option').forEach(b=>{ b.disabled=true; });
  btn.classList.add(correct?'battle-correct':'battle-wrong');
  if(correct){ battleScore+=100; progress.points+=100; }
  battleResults.push({skill:q.skill,correct}); $('battle-score').textContent=battleScore;
  const f=$('battle-feedback'); f.classList.remove('hidden');
  f.innerHTML=`<strong>${correct?'🎉 Good money sense · +100 FinPoints':'💡 Not this time — here is the reasoning.'}</strong><p>${escapeHtml(q.lesson)}</p><span class="battle-principle">Principle: ${escapeHtml(q.skill)}</span>`;
  $('battle-next').textContent=battleIndex===4?'See my Money Sense result →':'Next question →'; $('battle-next').classList.remove('hidden'); saveProgress();
}
$('battle-next').onclick=()=>{ battleIndex++; if(battleIndex>=5) finishBattle(); else renderBattle(); };
function finishBattle(){
  $('battle-content').classList.add('hidden'); $('battle-finish').classList.remove('hidden');
  progress.battles+=1; markDaily('battle'); progress.bestBattle=Math.max(progress.bestBattle,battleScore); saveProgress();
  const correct=battleResults.filter(r=>r.correct), missed=battleResults.filter(r=>!r.correct);
  const label=battleScore===500?'Money Sense master 🏆':battleScore>=400?'Strong Money Sense 🔥':battleScore>=300?'Good foundation 👍':'Keep building your Money Sense 🌱';
  $('battle-finish-title').textContent=`${battleScore}/500 · ${label}`;
  $('battle-finish-copy').textContent=`You got ${correct.length} of 5 decisions right and earned ${battleScore} FinPoints in this battle.`;
  const strengths=correct.length?correct.slice(0,3).map(r=>`<span>🟢 ${escapeHtml(r.skill)}</span>`).join(''):'<span>🟠 This round was tough — use the explanations and try a fresh set.</span>';
  const practise=missed.length?`<div class="battle-practise"><strong>Keep practising</strong><span>🟠 ${escapeHtml(missed[0].skill)}</span></div>`:'<div class="battle-practise"><strong>Excellent round</strong><span>⭐ You handled all five scenarios well.</span></div>';
  $('battle-strengths').innerHTML=`<div><strong>Your strengths</strong>${strengths}</div>${practise}`;
}
$('battle-restart').onclick=startBattle;
$('battle-share').onclick=async()=>{ const url=new URL(window.location.href); url.searchParams.set('battle','money-sense'); url.searchParams.set('beat',String(battleScore)); try{await navigator.clipboard.writeText(url.toString());$('share-status').textContent='✅ Money Sense challenge link copied.';}catch{$('share-status').textContent=`Challenge score: ${battleScore}/500`;} };

// ---------- Progress ----------
function loadProgress(){
  const base={points:0,scans:0,battles:0,labs:0,bestBattle:0,streak:1,lastVisit:'',dailyDate:'',daily:{scan:false,lab:false,battle:false},lastLevel:1};
  try{return {...base,...JSON.parse(localStorage.getItem('finpulseProgress')||'{}')}}catch{return base}
}
function todayKey(){ return new Date().toISOString().slice(0,10); }
function ensureDaily(){ if(progress.dailyDate!==todayKey()){progress.dailyDate=todayKey();progress.daily={scan:false,lab:false,battle:false};} }
function markDaily(kind){ ensureDaily(); progress.daily[kind]=true; }
function currentLevel(){ return Math.max(1,Math.floor((progress.points||0)/500)+1); }
function saveProgress(){
  const old=progress.lastLevel||1, now=currentLevel(); progress.lastLevel=now;
  localStorage.setItem('finpulseProgress',JSON.stringify(progress)); renderProgress();
  if(now>old) showLevelUp(now);
}
function touchStreak(){ const today=todayKey(); if(progress.lastVisit===today){ensureDaily();return;} if(progress.lastVisit){ const gap=Math.round((new Date(today)-new Date(progress.lastVisit))/86400000); progress.streak=gap===1?(progress.streak||1)+1:1; } else progress.streak=1; progress.lastVisit=today; ensureDaily(); saveProgress(); }
function renderProgress(){
  ensureDaily();
  $('header-streak').textContent=progress.streak||1; $('header-points').textContent=progress.points||0;
  const level=currentLevel(); $('progress-streak').textContent=progress.streak||1; $('progress-points').textContent=progress.points||0; $('progress-level').textContent=level; $('progress-level-label').textContent=`Level ${level}`;
  const done=Object.values(progress.daily||{}).filter(Boolean).length; $('daily-goal-count').textContent=`${done} / 3`; $('daily-goal-bar').style.width=`${done/3*100}%`;
  const quests=[['🛡️','Check one financial claim','scan',50,'Money Check'],['💰','Explore one Money Lab scenario','lab',50,'Money Lab'],['🎮','Complete one Money Sense Battle','battle',100,'Money Battles']];
  $('daily-quests').innerHTML=quests.map(([icon,label,key,xp,go])=>`<div class="quest ${progress.daily[key]?'done':''}"><strong>${progress.daily[key]?'✅':icon} ${label}</strong><small>${progress.daily[key]?'Completed today':`+${xp} FinPoints · ${go}`}</small></div>`).join('');
  const skills=[
    ['🛡️ Scam Spotter',Math.min(100,(progress.scans||0)*25)],
    ['💷 Money Basics',Math.min(100,((progress.battles||0)*18)+(progress.labs||0)*8)],
    ['📈 Investment Basics',Math.min(100,(progress.labs||0)*25)],
    ['📉 Risk Reader',Math.min(100,((progress.labs||0)*15)+Math.min(40,(progress.bestBattle||0)/10))],
    ['🧠 Money Sense',Math.min(100,(progress.battles||0)*22)]
  ];
  $('skill-journey').innerHTML=skills.map(([name,pct],i)=>`${i?'<div class="journey-link"></div>':''}<div class="journey-node ${pct>=100?'mastered':pct>0?'unlocked':''}"><strong>${name}</strong><small>${pct>=100?'★★★ Mastered':pct>=60?'★★☆ Growing':pct>0?'★☆☆ Started':'🔒 Start exploring'}</small></div>`).join('');
  $('money-brain').innerHTML=skills.map(([name,pct])=>`<div class="brain-skill"><div class="brain-row"><strong>${name}</strong><span>${pct>=80?'Strong':pct>=40?'Growing':'Keep practising'}</span></div><div class="brain-track"><span style="width:${pct}%"></span></div></div>`).join('');
  const weakest=[...skills].sort((a,b)=>a[1]-b[1])[0]; $('next-practice').innerHTML=`<strong>✨ FinPulse recommends</strong><p>Your next skill to grow is <strong>${weakest[0]}</strong>. A little practice here will balance your Money Brain.</p>`;
  const badges=[
    ['🛡️ Scam Spotter',(progress.scans||0)>=1,'Check your first financial claim'],
    ['🧠 Money Smart',(progress.battles||0)>=1,'Finish a Money Sense battle'],
    ['📉 Bounce Back',(progress.labs||0)>=1,'Run your first Money Lab simulation'],
    ['🌍 Explorer',(progress.labs||0)>=3,'Explore 3 Money Lab scenarios'],
    ['🔥 On Fire',(progress.streak||0)>=7,`${Math.min(7,progress.streak||0)}/7 day streak`],
    ['🏆 FinPulse Pro',level>=5,'Reach Money Sense Level 5']
  ];
  $('achievement-list').innerHTML=badges.map(([name,on,how])=>`<span style="opacity:${on?1:.48}">${on?'🏅':'🔒'} <strong>${name}</strong><br><small>${on?'Unlocked':how}</small></span>`).join('');
}
function showLevelUp(level){ const box=$('level-celebration'); if(!box)return; $('level-celebration-copy').textContent=`Money Sense Level ${level} unlocked. Keep building your money brain!`; box.classList.remove('hidden'); }
if($('close-celebration')) $('close-celebration').onclick=()=> $('level-celebration').classList.add('hidden');

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
