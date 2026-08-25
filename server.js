const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const ocrParser = require('./ocrParser');

const app = express();
const PORT = process.env.PORT || 3000;

const path = require('path');
const { execFile } = require('child_process');

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

const publicFiles = new Set(['app.js', 'style.css', 'sw.js', 'manifest.json', 'animated_architecture.svg', 'pure_readme_transparent_architecture.svg']);
const requireAdmin = (req, res, next) => {
    const expected = process.env.ADMIN_API_TOKEN;
    const supplied = req.get('authorization');
    if (!expected || supplied !== `Bearer ${expected}`) return res.status(404).json({ error: 'Not found' });
    return next();
};
const numberInRange = (value, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

// Health Check Endpoint
app.get('/api/v1/health', (req, res) => {
    res.json({
        status: "ONLINE",
        service: "FinPulse AI educational demo API",
        version: "1.1.0",
        mode: "educational-demo",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});
// Automatic Social Video Transcription
app.post('/api/v1/transcribe', async (req, res) => {
    const videoUrl = String(req.body.videoUrl || '').trim();

    if (!videoUrl) {
        return res.status(400).json({
            success: false,
            error: 'Paste a video link first.'
        });
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(videoUrl);
    } catch {
        return res.status(400).json({
            success: false,
            error: 'That does not look like a valid link.'
        });
    }

    const allowedHosts = new Set([
        'youtube.com',
        'www.youtube.com',
        'youtu.be',
        'tiktok.com',
        'www.tiktok.com',
        'instagram.com',
        'www.instagram.com',
        'x.com',
        'www.x.com',
        'twitter.com',
        'www.twitter.com'
    ]);

    if (
        parsedUrl.protocol !== 'https:' ||
        !allowedHosts.has(parsedUrl.hostname.toLowerCase())
    ) {
        return res.status(400).json({
            success: false,
            error: 'Use a public YouTube, TikTok, Instagram or X link.'
        });
    }
    // Try Supadata first for public social-video transcripts
    const supadataKey = process.env.SUPADATA_API_KEY;

    if (supadataKey) {
        try {
            const supadataUrl =
                `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}`;

            const supadataResponse = await fetch(supadataUrl, {
                method: 'GET',
                headers: {
                    'x-api-key': supadataKey
                }
            });

            if (supadataResponse.ok) {
                const data = await supadataResponse.json();

                let transcript = '';

                if (Array.isArray(data.content)) {
                    transcript = data.content
                        .map(part => part.text || '')
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                } else if (typeof data.content === 'string') {
                    transcript = data.content.trim();
                }

                if (transcript) {
                    console.log('Transcript source: Supadata');

                    return res.json({
                        success: true,
                        transcript,
                        language: data.lang || 'unknown',
                        source: 'supadata'
                    });
                }
            } else {
                const apiError = await supadataResponse.text();

                console.error(
                    'Supadata failed:',
                    supadataResponse.status,
                    apiError
                );
            }
        } catch (error) {
            console.error(
                'Supadata request failed:',
                error.message
            );
        }
    }

    console.log(
        'Supadata unavailable — trying local transcription fallback.'
    );
    const pythonExe =
    process.platform === 'win32'
        ? path.join(
            __dirname,
            '.venv-transcribe',
            'Scripts',
            'python.exe'
        )
        : 'python3';

    const scriptPath = path.join(
        __dirname,
        'transcribe_video.py'
    );

    execFile(
    pythonExe,
    [scriptPath, videoUrl],
    {
        cwd: __dirname,
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 1024 * 1024
    },
    (error, stdout, stderr) => {

        console.log('Python stdout:', stdout);
        console.log('Python stderr:', stderr);

        if (!stdout || !stdout.trim()) {
            return res.status(500).json({
                success: false,
                error: 'FinPulse could not read this video automatically.'
            });
        }

        try {
            const jsonStart = stdout.lastIndexOf('{"success"');
            const jsonEnd = stdout.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
                throw new Error('No transcription result was returned.');
            }
            const result = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.json(result);

        } catch (parseError) {
            console.error(
                'Could not read Python result:',
                parseError.message
            );

            return res.status(500).json({
                success: false,
                error: 'FinPulse could not understand the video result.'
            });
        }
    }
);
});
// Social Video OCR & Transcript Audit Endpoint
app.post('/api/v1/scan/ocr', (req, res) => {
    const { videoUrl, imageBase64, rawCaption, platform } = req.body;
    const ocrResult = ocrParser.parseSocialVideoText({ videoUrl, imageBase64, rawCaption });
    
    if (!ocrResult.extractedText) return res.status(400).json({ error: 'rawCaption is required; image/video OCR is not enabled.' });
    const textToScan = ocrResult.extractedText.toLowerCase();
    const fcaMatch = db.checkFcaWarning(textToScan);
    
    let scamScore = 30;
    let riskLevel = "GREEN";
    let flags = [];
    
    ocrResult.detectedKeywords.forEach(k => {
        flags.push(`OCR Detected Keyword: ${k.keyword} (${k.severity} severity)`);
        scamScore += k.severity === "HIGH" ? 35 : 20;
    });

    if (fcaMatch) {
        scamScore = 98;
        flags.push(`MATCHED UK FCA WARNING LIST: ${fcaMatch.name}`);
    }

    scamScore = Math.min(100, Math.max(0, scamScore));
    if (scamScore >= 70) riskLevel = "RED";
    else if (scamScore >= 40) riskLevel = "AMBER";

    const auditLog = db.saveAuditLog({
        event: "OCR_VIDEO_AUDIT",
        platform: platform || "TikTok",
        scamScore,
        riskLevel,
        ocrConfidence: ocrResult.confidenceScore
    });

    return res.json({
        success: true,
        auditId: auditLog.id,
        ocrExtractedText: ocrResult.extractedText,
        confidenceScore: ocrResult.confidenceScore,
        source: ocrResult.source,
        notice: ocrResult.notice,
        scorecard: {
            scamScore,
            riskLevel,
            flags,
            fcaStatus: fcaMatch ? "WARNING_UNAUTHORISED_FIRM" : "NOT_CHECKED_USE_OFFICIAL_FCA_WARNING_LIST",
            fcaWarningListUrl: "https://www.fca.org.uk/consumers/warning-list-unauthorised-firms"
        }
    });
});

// 1. AI FINFLUENCER AUDIT API
app.post('/api/v1/scan', (req, res) => {
    const { platform, claimUrl, claimText } = req.body;
    const textToScan = (claimText || claimUrl || "").toLowerCase();
    if (textToScan.trim().length < 3 || textToScan.length > 5000) return res.status(400).json({ error: 'Provide claim text between 3 and 5,000 characters.' });

    // Check FCA Warning Database
    const fcaMatch = db.checkFcaWarning(textToScan);

    let scamScore = 20;
    let riskLevel = "GREEN";
    let flags = [];
    let mathReality = "No high-risk leverage or extreme yield claims detected in this transcript.";

    // Rule-Based AI Scorer & NLP Classifier
    if (textToScan.includes("50x") || textToScan.includes("leverage") || textToScan.includes("forex")) {
        scamScore += 45;
        flags.push("High Leverage (50x+) Forex Trading Scheme");
        mathReality = "50x leverage means a tiny 2% market swing against your trade wipes out 100% of your account balance.";
    }

    if (textToScan.includes("guaranteed") || textToScan.includes("1000x") || textToScan.includes("moonshot") || textToScan.includes("presale")) {
        scamScore += 30;
        flags.push("Unrealistic Guaranteed Return / Meme Coin Presale");
        mathReality = "No legitimate financial asset can guarantee fixed high returns. 98% of social presale meme coins lose all liquidity within 30 days.";
    }

    if (textToScan.includes("klarna") || textToScan.includes("stack") || textToScan.includes("clearpay") || textToScan.includes("bnpl")) {
        scamScore += 25;
        flags.push("BNPL Stacking & Debt Accumulation Risk");
        mathReality = "Stacking multiple Buy-Now-Pay-Later accounts triggers missed payment fees and damages your credit score for up to 6 years.";
    }

    if (fcaMatch) {
        scamScore = Math.max(scamScore, 95);
        flags.push(`MATCHED UK FCA WARNING LIST: ${fcaMatch.name} (${fcaMatch.category})`);
    }

    scamScore = Math.min(100, Math.max(0, scamScore));

    if (scamScore >= 70) {
        riskLevel = "RED";
    } else if (scamScore >= 40) {
        riskLevel = "AMBER";
    }

    // Record Anonymized FCA Compliance Audit Log
    const auditLog = db.saveAuditLog({
        event: "FINFLUENCER_AUDIT",
        platform: platform || "Multi-Platform",
        scamScore,
        riskLevel,
        flagsCount: flags.length,
        fcaMatch: fcaMatch ? fcaMatch.name : null
    });

    return res.json({
        success: true,
        auditId: auditLog.id,
        timestamp: auditLog.timestamp,
        scorecard: {
            scamScore,
            riskLevel,
            flags,
            mathReality,
            fcaStatus: fcaMatch ? "WARNING_UNAUTHORISED_FIRM" : "NOT_CHECKED_USE_OFFICIAL_FCA_WARNING_LIST",
            fcaWarningListUrl: "https://www.fca.org.uk/consumers/warning-list-unauthorised-firms",
            fcaDetails: fcaMatch || null
        }
    });
});


// ---------------------------------------------------------------------------
// FinPulse v2 — clear-language scam check + investment learning lab
// These endpoints power the simplified hackathon experience. They educate,
// simulate and signpost; they do not recommend specific investments.
// ---------------------------------------------------------------------------
const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const firstEvidence = (text, regex) => {
    const source = cleanText(text);
    const sentences = source.split(/(?<=[.!?])\s+/).filter(Boolean);
    const hit = sentences.find(sentence => regex.test(sentence));
    regex.lastIndex = 0;
    if (!hit) return '';
    return hit.length > 180 ? `${hit.slice(0, 177)}...` : hit;
};

function analyseFinancialContent({ claimText, sourceTitle = '', sourceDescription = '' }) {
    const transcript = cleanText(claimText);
    const title = cleanText(sourceTitle);
    const description = cleanText(sourceDescription);
    const combined = cleanText([title, description, transcript].filter(Boolean).join('. '));
    const lower = combined.toLowerCase();

    const TOPICS = [
        { id:'investing', label:'Investing & markets', icon:'📈', re:/\b(invest|investing|investment|stock|share|equity|portfolio|market|dividend|capital gain|broker|asset allocation|diversif)/i },
        { id:'funds', label:'Funds, ETFs & index investing', icon:'🧺', re:/\b(etf|index fund|mutual fund|tracker fund|s&p\s*500|ftse|nasdaq|fund expense ratio|fund fee)/i },
        { id:'crypto', label:'Crypto & digital assets', icon:'🪙', re:/\b(crypto|bitcoin|ethereum|token|blockchain|wallet|stablecoin|meme\s*coin|nft|airdrop|defi|staking)/i },
        { id:'trading', label:'Trading, forex & leverage', icon:'📊', re:/\b(forex|fx\b|day trad|swing trad|copy trad|leverage|margin|cfd|options?|futures?|technical analysis|signal group|short sell)/i },
        { id:'saving', label:'Saving & interest', icon:'💰', re:/\b(sav(?:e|ing|ings)|interest rate|aer\b|apy\b|cash isa|fixed rate|compound interest|emergency fund)/i },
        { id:'pension', label:'Pensions & retirement', icon:'🧓', re:/\b(pension|retirement|workplace pension|auto[- ]enrol|sipp|annuity|drawdown)/i },
        { id:'credit', label:'Credit, loans & debt', icon:'💳', re:/\b(credit card|credit score|loan|debt|apr\b|overdraft|interest charge|minimum payment|borrow|repay|repayment)/i },
        { id:'bnpl', label:'Buy Now Pay Later', icon:'🛍️', re:/\b(bnpl|buy now pay later|klarna|clearpay|afterpay)/i },
        { id:'mortgage', label:'Mortgages & property', icon:'🏠', re:/\b(mortgage|house deposit|property|home buyer|ltv\b|loan to value|fixed mortgage|tracker mortgage|rent vs buy)/i },
        { id:'budgeting', label:'Budgeting & everyday money', icon:'🧾', re:/\b(budget|budgeting|50\/30\/20|expenses?|spending|income|payday|bills?|cash flow|money management)/i },
        { id:'tax', label:'Tax & payslips', icon:'🧮', re:/\b(tax|income tax|national insurance|paye|tax code|capital gains tax|cgt\b|allowance|payslip|gross pay|net pay)/i },
        { id:'insurance', label:'Insurance & protection', icon:'☂️', re:/\b(insurance|premium|excess|life cover|income protection|policy|insured|claim)/i },
        { id:'banking', label:'Banking & payments', icon:'🏦', re:/\b(bank account|current account|direct debit|standing order|payment|transfer|sort code|open banking|overdraft)/i },
        { id:'economy', label:'Economy, inflation & rates', icon:'🌍', re:/\b(inflation|bank of england|base rate|interest rates?|recession|gdp\b|cost of living|monetary policy|economy|economic)/i },
        { id:'income', label:'Income, work & side hustles', icon:'💼', re:/\b(side hustle|passive income|salary|wage|freelanc|business income|make money online|dropshipping|affiliate marketing)/i },
        { id:'fraud', label:'Scams, fraud & suspicious payments', icon:'🛡️', re:/\b(scam|fraud|phishing|impersonat|safe account|recovery fee|authorised push payment|app fraud|money mule)/i }
    ];

    const matchedTopics = TOPICS.filter(t => t.re.test(lower));
    const primaryTopic = matchedTopics[0] || { id:'general', label:'General money / financial content', icon:'💡' };
    const sentences = combined.split(/(?<=[.!?])\s+/).map(cleanText).filter(Boolean);

    const promotionSignals = /\b(buy|join|sign up|use my link|use my code|dm me|message me|limited spots|presale|subscribe|deposit now|open an account|trade with|my course|my group)\b/i.test(lower);
    const educationalSignals = /\b(explain|means|how does|what is|education|learn|example|for beginners|understand|pros and cons|risk|fees?)\b/i.test(lower);
    const predictionSignals = /\b(will (?:hit|reach|rise|fall|go to)|going to (?:hit|reach|rise|fall)|price target|forecast|prediction)\b/i.test(lower);
    const challengeSignals = /\b(challenge|trying to|attempt(?:ing)? to|going to turn|my goal|target is|see if i can)\b/i.test(lower);
    const reportedSignals = /\b(went (?:up|down)|grew|doubled|tripled|lost|made|returned|rose|fell|increased|decreased)\b/i.test(lower);
    const adviceSignals = /\b(you should|you need to|you must|buy this|sell this|invest in|copy (?:his|her|their) trades?|follow my trades?)\b/i.test(lower);
    let contentType = 'Financial discussion';
    if (promotionSignals) contentType = 'Promotion / call to action';
    else if (challengeSignals) contentType = 'Personal challenge / experiment';
    else if (adviceSignals) contentType = 'Advice-style content';
    else if (educationalSignals) contentType = 'Educational / explanatory';
    else if (predictionSignals) contentType = 'Forecast / opinion';

    const normaliseClaim = (s) => cleanText(s).toLowerCase().replace(/[^a-z0-9£$€% ]/g,'').replace(/\b(i|im|i'm|this|the|a|an|in|video|episode|ep)\b/g,' ').replace(/\s+/g,' ').trim();
    const tokenSet = (s) => new Set(normaliseClaim(s).split(' ').filter(x => x.length > 2));
    const similarity = (a,b) => {
        const A=tokenSet(a), B=tokenSet(b); if(!A.size || !B.size) return 0;
        let inter=0; A.forEach(x=>{if(B.has(x)) inter++;});
        return inter / Math.min(A.size,B.size);
    };

    const candidateClaims = [];
    const addCandidate = (type, sentence, priority=1) => {
        const s=cleanText(sentence); if(!s) return;
        if(candidateClaims.some(c => similarity(c.text,s) >= .72)) return;
        candidateClaims.push({type,text:s.length>220?`${s.slice(0,217)}...`:s,priority});
    };
    if (title) addCandidate(challengeSignals ? 'Target / challenge' : 'Headline claim', title, 8);
    sentences.forEach(sentence => {
        const low=sentence.toLowerCase();
        if (/£\s?\d|\$\s?\d|€\s?\d|\b\d+(?:\.\d+)?%\b|\b\d+(?:\.\d+)?x\b/i.test(sentence)) addCandidate('Money / return claim', sentence, 7);
        else if (/\b(guarantee|always|never|best investment|double your money|easy money|risk[- ]?free|zero risk)\b/i.test(low)) addCandidate('Strong financial claim', sentence, 6);
        else if (/\b(should|must|need to|buy|sell|invest|borrow|repay|switch)\b/i.test(low)) addCandidate('Action / advice-style claim', sentence, 4);
        else if (predictionSignals && /\b(will|going to|forecast|prediction|target)\b/i.test(low)) addCandidate('Forecast / opinion', sentence, 5);
    });
    candidateClaims.sort((a,b)=>b.priority-a.priority);
    const primaryClaim = candidateClaims[0] || { type:'Main message', text:title || sentences[0] || combined };
    const supportingClaims = candidateClaims.slice(1,3);

    const moneyValues = [...combined.matchAll(/([£$€])\s?([0-9][0-9,]*(?:\.\d+)?)/g)].map(m => ({symbol:m[1],value:Number(m[2].replace(/,/g,'')),raw:m[0]}));
    let calculation = null;
    for(let i=0;i<moneyValues.length;i++) {
        for(let j=i+1;j<moneyValues.length;j++) {
            const a=moneyValues[i], b=moneyValues[j];
            if(a.symbol===b.symbol && a.value>0 && b.value>a.value*1.5) {
                const multiple=b.value/a.value;
                const gainPct=(multiple-1)*100;
                calculation={
                    title:`${a.raw} → ${b.raw}`,
                    headline:`That is about ${multiple.toFixed(multiple>=100?0:1)}× the starting money`,
                    detail:`To grow ${a.raw} into ${b.raw}, the money would need to increase by about ${gainPct.toLocaleString('en-GB',{maximumFractionDigits:1})}%. That describes the scale of the claim — not the probability of achieving it.`
                };
                i=moneyValues.length; break;
            }
        }
    }

    const flags=[]; let scamPoints=0;
    const addFlag = ({ id, regex, points, icon, title, why }) => {
        regex.lastIndex=0; if(!regex.test(lower)) return; regex.lastIndex=0;
        flags.push({ id, icon, title, why, evidence:firstEvidence(combined,regex) }); scamPoints+=points;
    };
    addFlag({id:'certainty',regex:/\b(guaranteed|zero\s+risk|risk[- ]?free|cannot\s+lose|can['’]?t\s+lose|100%\s+safe)\b/i,points:30,icon:'🎯',title:'The outcome is presented as certain',why:'Financial outcomes are uncertain, so certainty language is a financial risk signal that needs especially strong evidence and independent checking.'});
    addFlag({id:'urgency',regex:/\b(today only|act now|limited spots?|before it['’]?s too late|last chance|ends tonight|closes tonight|hurry|don['’]?t miss out)\b/i,points:20,icon:'⏰',title:'Pressure to act quickly',why:'Time pressure can reduce the chance to verify a financial decision independently.'});
    addFlag({id:'extreme-return',regex:/\b(100x|50x|20x|10x|double your money|triple your money|turn(?:ing)?\s+[£$€]?\s?\d+[\d,]*\s+(?:in)?to\s+[£$€]?\s?\d+[\d,]*)\b/i,points:18,icon:'🚀',title:'Very large return framing',why:'Large gains can occur, but presenting exceptional outcomes without showing the full loss distribution can distort risk.'});
    addFlag({id:'private-contact',regex:/\b(dm me|message me|private group|telegram|whatsapp me|send to this wallet|wallet address)\b/i,points:20,icon:'📩',title:'The money conversation moves to a private channel',why:'Private payment or contact routes can make independent checks harder.'});
    addFlag({id:'copy-trading',regex:/\b(copy(?:ing)? (?:his|her|their|someone(?:'s)?) trades?|copy trade|signal group)\b/i,points:10,icon:'👥',title:'The strategy relies on another trader',why:'Copying another person does not remove market risk, selection bias or the possibility that their future trades perform differently.'});
    addFlag({id:'leverage',regex:/\b(leverage|margin|\d+x\s+leverage)\b/i,points:15,icon:'⚡',title:'Leverage can magnify losses',why:'Leverage increases exposure, so relatively small market moves can create much larger gains or losses.'});
    addFlag({id:'incentive',regex:/\b(affiliate|referral|use my link|use my code|commission|sponsored|paid partnership)\b/i,points:8,icon:'💸',title:'The creator may benefit if viewers act',why:'A financial incentive does not automatically make content wrong, but it matters when judging objectivity.'});
    addFlag({id:'safe-account',regex:/\b(safe account|move your money to.*safe|protective account)\b/i,points:40,icon:'🚨',title:'“Safe account” language is a serious fraud warning sign',why:'Banks do not normally ask customers to move money to a new “safe account” to protect it.'});

    const fcaMatch=db.checkFcaWarning(lower);
    if(fcaMatch){flags.unshift({id:'fca-match',icon:'🏛️',title:'A name matched the local FCA warning dataset',why:'Verify the firm independently on the official FCA Firm Checker or Warning List before taking action.',evidence:fcaMatch.name||''});scamPoints=Math.max(scamPoints,75);}
    let scamLevel='LOW'; if(scamPoints>=55) scamLevel='HIGH'; else if(scamPoints>=18) scamLevel='MEDIUM';

    const highRiskTopic = ['crypto','trading'].includes(primaryTopic.id);
    const riskSignals = [highRiskTopic, /\b(leverage|margin|options?|futures?|meme coin|copy trad|day trad)\b/i.test(lower), calculation && /challenge|turn|target|goal/i.test(lower), /\blost\s+[£$€]?\s?\d/i.test(lower)].filter(Boolean).length;
    const financialRisk = riskSignals>=2 ? 'HIGH' : riskSignals===1 ? 'MEDIUM' : ['investing','funds','mortgage','credit','pension'].includes(primaryTopic.id) ? 'MEDIUM' : 'LOW';

    let evidenceQuality='LIMITED';
    const hasSource=/\b(source|according to|data from|fca|bank of england|ons|annual report|prospectus|official|research)\b/i.test(lower);
    const hasBalance=/\b(risk|can lose|could lose|not guaranteed|fees?|downside|volatil|depends|may fall)\b/i.test(lower);
    if(hasSource && hasBalance) evidenceQuality='STRONGER'; else if(hasSource || hasBalance) evidenceQuality='MIXED';

    let claimNature='Statement / discussion';
    if(challengeSignals) claimNature='Target or personal challenge';
    else if(reportedSignals && !predictionSignals) claimNature='Reported / historical result';
    else if(predictionSignals) claimNature='Forecast or opinion';
    else if(/\b(guaranteed|always|never|will definitely|certain)\b/i.test(lower)) claimNature='Certainty / promise-style claim';
    else if(adviceSignals) claimNature='Advice-style statement';
    else if(educationalSignals) claimNature='Educational explanation';

    const reportedEvidence = sentences.filter(s => /\b(went (?:up|down)|grew|doubled|tripled|lost|made|returned|rose|fell|increased|decreased)\b/i.test(s)).slice(0,2);
    const missing=[];
    if(['investing','funds','crypto','trading'].includes(primaryTopic.id)) {
        if(!/\b(fee|spread|commission|cost)\b/i.test(lower)) missing.push('fees and trading costs');
        if(!/\b(loss|downside|risk|volatil|fall|fell|lost)\b/i.test(lower)) missing.push('what losses could look like');
        if(!/\b(time|day|week|month|year|horizon)\b/i.test(lower)) missing.push('the time period');
        if(!/\b(full history|track record|all trades|win rate|drawdown|verified)\b/i.test(lower)) missing.push('a complete, independently verified performance record');
    }
    if(primaryTopic.id==='credit' && !/\b(apr|interest|total repay|fee|term)\b/i.test(lower)) missing.push('APR, fees and total repayment cost');
    if(primaryTopic.id==='mortgage' && !/\b(rate|fee|ltv|monthly|term|fixed)\b/i.test(lower)) missing.push('rate, fees, monthly cost and loan term');
    if(primaryTopic.id==='saving' && !/\b(aer|rate|withdraw|fixed|variable|protection)\b/i.test(lower)) missing.push('rate conditions, access rules and protection');
    if(!hasSource) missing.push('an independent source for the key claim');

    const topicPrinciples={
        investing:['Returns are uncertain','Diversification, fees and time horizon matter','Past results do not guarantee future results'],
        funds:['A fund can diversify risk but cannot remove market risk','Fees compound over time','The index and holdings determine what you actually own'],
        crypto:['Crypto prices can move sharply in either direction','Custody and liquidity matter as well as price','A successful trade is not evidence that a strategy is repeatable'],
        trading:['Short-term trading can produce fast gains and fast losses','Copying a trader does not copy their future success','Fees, spreads, leverage and losing trades all affect the real result'],
        credit:['APR and total repayable matter more than the headline monthly payment','Minimum payments can keep debt outstanding much longer','Missed payments can have further consequences'],
        mortgage:['The monthly payment is only part of the cost','Rate changes and deal expiry can change affordability','Fees and loan term affect total cost'],
        saving:['Headline rates can have conditions','Access rules matter if you may need the money','Inflation affects the real buying power of savings'],
        pension:['Pensions are long-term and access rules matter','Fees and investment choices affect outcomes','Tax treatment depends on circumstances and rules'],
        budgeting:['A budget rule is a starting point, not a universal answer','Essential costs and debt change what is realistic','Small repeatable actions can matter more than perfect ratios'],
        economy:['Economic claims need a date and source','A national statistic does not affect every household the same way','Forecasts are not facts'],
        general:['Separate facts, forecasts and personal opinions','Check the source and date','Ask what information would change the conclusion']
    };
    const learn=(topicPrinciples[primaryTopic.id]||topicPrinciples.general).map((plain,i)=>({term:i===0?'Core idea':i===1?'What else matters':'Remember',plain}));

    const upsideDownside={
        investing:{up:'If the underlying investments grow over time, the value can rise and compounding can help.',down:'Markets can fall, sometimes for years, and you may need to wait for recovery or accept a loss.'},
        funds:{up:'Broad funds can spread exposure across many holdings and make diversification easier.',down:'The whole market or index can fall, and fees reduce returns even when performance is positive.'},
        crypto:{up:'A token can rise rapidly if demand increases and liquidity remains available.',down:'Prices can fall just as rapidly; liquidity, custody, hacks and speculation can add risks beyond ordinary market moves.'},
        trading:{up:'A trade can profit if the market moves in the expected direction before costs overwhelm the gain.',down:'The market can move the other way; repeated losses, leverage, spreads and fees can quickly reduce capital.'},
        credit:{up:'Borrowing can spread a necessary cost or provide short-term flexibility when repayments are affordable.',down:'Interest and fees can make the purchase much more expensive, and missed payments can worsen the position.'},
        mortgage:{up:'A mortgage can spread the cost of a home over many years and build equity as the loan is repaid.',down:'Rates, fees, house prices and affordability can change; missed payments have serious consequences.'},
        saving:{up:'Savings can preserve liquidity and earn interest with lower volatility than investments.',down:'Returns may lag inflation, and access or rate conditions can reduce the benefit.'},
        general:{up:'The claim may be useful if its assumptions, evidence and context hold.',down:'If the assumptions are incomplete or wrong, acting on it can lead to costs, losses or poor decisions.'}
    }[primaryTopic.id] || {up:'The claim may be useful if its assumptions, evidence and context hold.',down:'If the assumptions are incomplete or wrong, acting on it can lead to costs, losses or poor decisions.'};

    const verdictParts=[];
    if(claimNature==='Target or personal challenge') verdictParts.push('This is best read as a personal target or experiment, not as evidence that the same result is likely for another person.');
    else if(claimNature==='Forecast or opinion') verdictParts.push('This is a forecast or opinion, so the key question is what evidence and assumptions support it.');
    else if(claimNature==='Reported / historical result') verdictParts.push('This describes a reported past result; past outcomes do not show how often the same result would happen again.');
    else if(claimNature==='Advice-style statement') verdictParts.push('This content moves from explanation toward telling viewers what to do, so suitability and incentives matter.');
    else verdictParts.push(`This is mainly ${primaryTopic.label.toLowerCase()} content.`);
    if(calculation) verdictParts.push(`${calculation.title} is an unusually large outcome, so the scale of the claim matters as much as the story around it.`);
    if(financialRisk==='HIGH') verdictParts.push('The financial risk appears high even if there is not enough evidence to call the content a scam.');
    else if(scamLevel==='HIGH') verdictParts.push('There are also serious scam-style warning signs that should be checked independently before any money is sent.');
    else if(missing.length) verdictParts.push(`The biggest weakness is missing context: ${missing.slice(0,3).join(', ')}.`);

    const assessment = {
        verdict: verdictParts.join(' '),
        financialRisk,
        scamRisk: scamLevel,
        evidenceQuality,
        framing: calculation && !hasBalance ? 'The content emphasises a striking outcome more than the probability of achieving it.' : promotionSignals ? 'The content includes a call to action, so incentives and omitted risks matter.' : 'No major promotional framing was identified from the analysed words alone.',
        missing: [...new Set(missing)].slice(0,5)
    };

    const mainClaim = {
        type: primaryClaim.type,
        text: primaryClaim.text,
        nature: claimNature,
        interpretation: challengeSignals ? 'Treat this as a goal being tested, not a normal expected return.' : reportedSignals ? 'Treat this as a reported example unless a full verified track record is provided.' : predictionSignals ? 'Treat this as a forecast, not a fact.' : 'Treat this as a financial claim that still needs context and evidence.',
        calculation,
        evidenceShown: reportedEvidence.length ? reportedEvidence : ['No independent evidence was identified in the analysed words.'],
        supportingClaims
    };

    const verify=[];
    if(['investing','funds','crypto','trading'].includes(primaryTopic.id)) verify.push('What is the full performance record, including losing periods — not just selected wins?','What fees, spreads, taxes or platform costs would reduce the headline result?','How much could be lost, and over what time period?');
    if(primaryTopic.id==='credit') verify.push('What is the APR and total amount repayable?','What happens if a payment is missed?');
    if(primaryTopic.id==='mortgage') verify.push('What are the rate, fees, term and monthly payment after any introductory deal?','How would affordability change if rates rose?');
    if(primaryTopic.id==='saving') verify.push('Is the rate fixed or variable, and for how long?','Are there withdrawal restrictions or balance conditions?');
    if(promotionSignals) verify.push('Does the creator or platform earn money if you sign up, buy or trade?');
    verify.push('Can the key claim be checked using an independent, current source?');

    return {
        level: scamLevel,
        points: scamPoints,
        flags,
        summary: assessment.verdict,
        sourceTitle:title,
        checkedText: transcript,
        context:{topic:`${primaryTopic.icon} ${primaryTopic.label}`,topicId:primaryTopic.id,relatedTopics:matchedTopics.slice(1,4).map(t=>`${t.icon} ${t.label}`),contentType,whoMayBenefit:promotionSignals?'A creator, platform or provider may benefit if viewers act; check disclosures and incentives.':'No clear financial incentive was identified from the words alone.'},
        mainClaim,
        assessment,
        scenarios:upsideDownside,
        concepts:learn,
        verify:[...new Set(verify)].slice(0,6),
        nextStep:{title: scamLevel==='HIGH'?'Pause and verify independently':'Check the assumptions before acting',text:verify[0]||'Check the source, evidence, risks and costs before acting.'}
    };
}

app.post('/api/v2/scam-check', (req, res) => {
    const claimText = cleanText(req.body.claimText);
    const claimUrl = cleanText(req.body.claimUrl);
    const sourceTitle = cleanText(req.body.sourceTitle);
    const sourceDescription = cleanText(req.body.sourceDescription);
    if (claimText.length < 3 || claimText.length > 8000) {
        return res.status(400).json({ error: 'Add the words from the post, or use Get words on a supported public video.' });
    }
    const result = analyseFinancialContent({ claimText, sourceTitle, sourceDescription });
    db.saveAuditLog({ event: 'MONEY_CHECK_V2', riskLevel: result.level, flagsCount: result.flags.length, topic: result.context.topicId, sourceProvided: Boolean(claimUrl) });
    return res.json({ success: true, ...result });
});

const projectSeries = ({ startAmount, monthlyContribution, years, annualReturn, shockAtYear = null, shockRate = 0 }) => {
    const points = [{ year: 0, value: Math.round(startAmount) }];
    let value = startAmount;
    const monthlyRate = Math.pow(1 + annualReturn, 1 / 12) - 1;
    const totalMonths = years * 12;
    for (let month = 1; month <= totalMonths; month++) {
        value = (value + monthlyContribution) * (1 + monthlyRate);
        if (shockAtYear && month === Math.max(1, Math.round(shockAtYear * 12))) value *= (1 + shockRate);
        if (month % 3 === 0 || month === totalMonths) points.push({ year: +(month / 12).toFixed(2), value: Math.max(0, Math.round(value)) });
    }
    return points;
};

app.post('/api/v2/money-lab', (req, res) => {
    const profiles={
      fund:{name:'Funds & ETFs',icon:'🌍',mid:.05,strong:.08,down:.02,shock:.30,note:'A diversified fund can spread risk across many holdings, but its value can still fall with markets.',lessons:[['Diversification','Spreading money across many holdings reduces reliance on one company, but does not remove risk.'],['Fees','Fund and platform fees reduce what stays invested and can compound over time.']]},
      share:{name:'Company Shares',icon:'🏢',mid:.055,strong:.11,down:-.01,shock:.40,note:'One company can outperform, disappoint or fail. The range of outcomes is wider because your money is concentrated.',lessons:[['Concentration risk','One company has a much bigger effect on your result than it would inside a broad fund.'],['Share price','A good company can still have a falling share price, and a high price does not guarantee future growth.']]},
      gilt:{name:'UK Gilts',icon:'🏛️',mid:.035,strong:.05,down:.01,shock:.12,note:'Gilts are UK Government bonds. They can be less volatile than shares, but market prices still move with rates and expectations.',lessons:[['Interest-rate risk','When market interest rates rise, existing fixed-rate bonds can become less attractive and their market prices can fall.'],['Maturity','Holding a gilt to maturity is different from selling it earlier at the market price.']]},
      corp:{name:'Corporate Bonds',icon:'💼',mid:.045,strong:.065,down:.005,shock:.20,note:'Corporate bonds pay for lending to companies, but the company can become less creditworthy or fail to pay.',lessons:[['Credit risk','The borrower may struggle to make interest or repayment obligations.'],['Yield','A higher yield can be compensation for taking more risk, not free extra return.']]},
      reit:{name:'Property / REITs',icon:'🏠',mid:.05,strong:.085,down:.005,shock:.30,note:'Property investments can combine rental income and changing property values, while remaining exposed to rates and economic conditions.',lessons:[['Liquidity','A listed REIT can be traded like a share, but the property it owns is not itself instantly liquid.'],['Property cycle','Rents, vacancies, borrowing costs and property values can all change.']]},
      crypto:{name:'Cryptoassets',icon:'🪙',mid:.04,strong:.18,down:-.10,shock:.50,note:'Crypto can move dramatically in either direction. A positive illustration is not a forecast and large losses are possible.',lessons:[['Volatility','Crypto prices can move much more sharply than many mainstream investments.'],['Recovery maths','After a 50% loss, the remaining money must gain 100% just to return to its starting value.']]}
    };
    const assetType=profiles[req.body.assetType]?req.body.assetType:'fund',asset=profiles[assetType];
    const startAmount=numberInRange(req.body.startAmount,0,100000),monthlyContribution=numberInRange(req.body.monthlyContribution,0,10000),years=numberInRange(req.body.years,1,20);
    const purpose=['spare','emergency','rent','deposit','education','other'].includes(req.body.purpose)?req.body.purpose:'other';
    const hasEmergencyFund=req.body.hasEmergencyFund===true,hasHighInterestDebt=req.body.hasHighInterestDebt===true;
    if(startAmount===null||monthlyContribution===null||years===null)return res.status(400).json({error:'Use valid amounts and a time period between 1 and 20 years.'});
    const totalContributed=Math.round(startAmount+monthlyContribution*12*years);
    const contributed=projectSeries({startAmount,monthlyContribution,years,annualReturn:0});
    const steady=projectSeries({startAmount,monthlyContribution,years,annualReturn:asset.mid});
    const strong=projectSeries({startAmount,monthlyContribution,years,annualReturn:asset.strong});
    const downside=projectSeries({startAmount,monthlyContribution,years,annualReturn:asset.down,shockAtYear:Math.min(1,years),shockRate:-asset.shock});
    const essential=['rent','emergency','deposit','education'].includes(purpose), highRisk=['share','crypto'].includes(assetType);
    let readiness={tone:'good',title:'This setup gives you more room to handle market ups and downs',text:'You reported emergency savings, no expensive debt and money that is not marked for an essential near-term need. That does not make the investment safe.'};
    if(essential||years<=1)readiness={tone:'stop',title:'This money may be needed too soon',text:'Essential or near-term money can be difficult to replace after a market fall. Keeping it accessible may matter more than chasing a return.'};
    else if(!hasEmergencyFund||hasHighInterestDebt||years<5)readiness={tone:'caution',title:'Your financial setup deserves a pause before taking more risk',text:'Emergency cash, expensive debt and time horizon can matter more than trying to pick the perfect market day.'};
    if(highRisk&&readiness.tone==='good')readiness.text+=' This choice can still move sharply, so consider whether you could tolerate a large temporary or permanent loss.';
    const shockStart=Math.round(startAmount),shockAfter=Math.round(startAmount*(1-asset.shock)),loss=shockStart-shockAfter,recovery=shockAfter>0?Math.round(((shockStart/shockAfter)-1)*1000)/10:0;
    const purposeNames={spare:'long-term / spare money',emergency:'emergency money',rent:'rent or bills',deposit:'a house or tenancy deposit',education:'education',other:'another goal'};
    const timing=essential?`You marked this as ${purposeNames[purpose]}. The key question is not “is the market up today?” but whether you can afford for this money to fall when you need it.`:years>=5&&hasEmergencyFund&&!hasHighInterestDebt?'There is no guaranteed best day to invest. Having time, emergency cash and manageable debt can matter more than trying to predict the market.':'Before choosing a market date, strengthen the basics: emergency cash, expensive debt, time horizon and understanding what you own.';
    const checklist=[{label:'Emergency cash',ok:hasEmergencyFund,note:hasEmergencyFund?'You said you have a buffer for surprises.':'A buffer can stop an investment fall becoming a cash emergency.'},{label:'Expensive debt',ok:!hasHighInterestDebt,note:hasHighInterestDebt?'High-cost debt keeps charging interest even when investments fall.':'You did not report expensive debt.'},{label:'Time',ok:years>=5,note:years>=5?'You can leave the money for at least five years.':'Less time means less room to wait through a fall.'},{label:'Essential money',ok:!essential,note:essential?`You marked this money for ${purposeNames[purpose]}.`:'You did not mark this for an essential near-term need.'}];
    const middleFinal=steady.at(-1).value, toughFinal=downside.at(-1).value, strongFinal=strong.at(-1).value;
    const middleDiff=middleFinal-totalContributed, toughDiff=toughFinal-totalContributed;
    let meaning=`You would contribute about £${totalContributed.toLocaleString('en-GB')} over ${years} year${years===1?'':'s'}. In the middle illustration, the pot ends around £${middleFinal.toLocaleString('en-GB')} (${middleDiff>=0?'+':'−'}£${Math.abs(middleDiff).toLocaleString('en-GB')} compared with what you put in).`;
    if(essential) meaning+=` You said this money is for ${purposeNames[purpose]}, so a fall at the wrong time could affect a goal you actually need the money for.`;
    else if(years<5) meaning+=` Your ${years}-year timeframe is relatively short, which gives less time to wait through a market fall.`;
    else meaning+=` A longer timeframe gives more room to live through market ups and downs, but it does not guarantee a profit.`;
    if(assetType==='crypto') meaning+=` Crypto can move especially sharply; the tough illustration is not a worst-case scenario and a much larger loss is possible.`;
    else if(assetType==='share') meaning+=` Because this is one company, company-specific news can have a large effect on the result.`;
    const considerations=[];
    if(!hasEmergencyFund) considerations.push('Build or protect an emergency cash buffer so a surprise bill does not force you to sell an investment at a bad time.');
    if(hasHighInterestDebt) considerations.push('Compare the guaranteed cost of expensive debt with the uncertain return from investing; debt interest continues even when markets fall.');
    if(essential) considerations.push(`Keep in mind that you marked this money for ${purposeNames[purpose]}. Money needed soon or for essentials may need stability and access more than market exposure.`);
    if(years<5) considerations.push('With less than five years, think carefully about how you would cope if the investment were down when you needed the money.');
    considerations.push(`Stress-test the choice: this example fall would take £${shockStart.toLocaleString('en-GB')} to about £${shockAfter.toLocaleString('en-GB')}, and the remaining money would need about ${recovery}% growth to recover.`);
    considerations.push(assetType==='fund'?'Check what the fund actually holds, how diversified it is, and its platform/fund fees.':assetType==='gilt'?'Check the gilt maturity, coupon/yield and what could happen if you need to sell before maturity.':assetType==='corp'?'Check the issuer’s credit quality, maturity, yield and whether the higher return is compensating for higher default risk.':assetType==='reit'?'Check the properties held, debt levels, rental income, fees and sensitivity to interest rates.':assetType==='crypto'?'Check custody, platform risk, fees and whether you could tolerate losing a very large part — potentially all — of the amount.':'Check the company’s business, finances, valuation and how much of your total money would depend on this one share.');
    res.json({success:true,totalContributed,asset:{name:asset.name,icon:asset.icon,resultNote:asset.note},assumptions:{toughAnnualPct:Math.round(asset.down*1000)/10,middleAnnualPct:Math.round(asset.mid*1000)/10,strongAnnualPct:Math.round(asset.strong*1000)/10,stressFallPct:Math.round(asset.shock*100),stressTimingYear:Math.min(1,years),feesIncluded:false,inflationIncluded:false},readiness,checklist,timing,summary:{downsideFinal:downside.at(-1).value,steadyFinal:steady.at(-1).value,strongFinal:strong.at(-1).value},trajectories:{contributed,downside,steady,strong},shock:{start:shockStart,after:shockAfter,loss,fallPct:Math.round(asset.shock*100),recoveryNeededPct:recovery,text:`In this stress illustration, a ${Math.round(asset.shock*100)}% fall turns £${shockStart.toLocaleString('en-GB')} into about £${shockAfter.toLocaleString('en-GB')}. The remaining money then needs about ${recovery}% growth just to get back to £${shockStart.toLocaleString('en-GB')}.`},lessons:asset.lessons.map(([title,text])=>({title,text})),guidance:{meaning,considerations}});
});

// Guided pre-decision rehearsal used by the 90-second hackathon demo.
// It examines missing context and consequences without recommending a transaction.
app.post('/api/v1/rehearsal', (req, res) => {
    const claimText = String(req.body.claimText || '').trim();
    const amount = numberInRange(req.body.amount, 1, 100_000);
    const reason = String(req.body.reason || '').trim();
    if (claimText.length < 3 || claimText.length > 5000 || amount === null || reason.length < 3 || reason.length > 240) {
        return res.status(400).json({ error: 'Provide claim text, an amount between 1 and 100,000, and a short reason.' });
    }

    const lower = claimText.toLowerCase();
    const leverageMatch = lower.match(/(\d{1,3})x\s*(?:leverage|forex|returns?)/);
    const leverage = leverageMatch ? Math.min(Number(leverageMatch[1]), 100) : (lower.includes('leverage') ? 50 : null);
    const guaranteed = /guaranteed|zero risk|free money|can(?:not|'t) lose/.test(lower);
    const urgency = /buy now|today only|limited|dm me|quit your|before it/.test(lower);

    const indicators = [];
    if (leverage) indicators.push(`Leverage is mentioned (${leverage}x), which can amplify losses as well as gains.`);
    if (guaranteed) indicators.push('The promotion uses certainty language that is not evidence of a return.');
    if (urgency) indicators.push('Urgency or social pressure may be reducing the time available to verify the claim.');
    if (indicators.length === 0) indicators.push('No common high-risk phrase was detected; that does not establish that the promotion is safe.');

    const adverseMove = leverage ? Math.max(1, Math.ceil(100 / leverage)) : 25;
    const lossAmount = leverage ? amount : Math.round(amount * 0.25);
    const scenario = leverage
        ? `At ${leverage}x leverage, an adverse move of roughly ${adverseMove}% could put the full £${amount.toLocaleString('en-GB')} at risk, before fees and platform rules.`
        : `A hypothetical 25% fall would reduce £${amount.toLocaleString('en-GB')} by about £${lossAmount.toLocaleString('en-GB')}. This is a learning scenario, not a forecast.`;

    const rehearsal = db.saveAuditLog({
        event: 'DECISION_REHEARSAL',
        indicatorsCount: indicators.length,
        amountBand: amount < 100 ? 'UNDER_100' : amount < 500 ? '100_TO_499' : '500_PLUS'
    });

    return res.json({
        success: true,
        rehearsalId: rehearsal.id,
        indicators,
        missingContext: [
            'Is the firm authorised? Check it independently on the official FCA Register and Warning List.',
            'What evidence supports the promised return, and who supplied that evidence?',
            'How is the promoter paid, and do they benefit if you sign up or trade?',
            `If the £${amount.toLocaleString('en-GB')} were lost, what would ${reason.toLowerCase()} have to give up?`
        ],
        downsideScenario: scenario,
        comprehension: {
            question: 'What does leverage change in this scenario?',
            options: [
                'It guarantees a larger profit',
                'It magnifies losses as well as gains',
                'It makes the promoter FCA-authorised'
            ],
            correctOption: 1
        },
        boundary: 'Educational rehearsal only. This is not a scam determination, suitability assessment, or financial advice.'
    });
});

app.post('/api/v1/decision-receipt', (req, res) => {
    const rehearsalId = String(req.body.rehearsalId || '').trim();
    const amount = numberInRange(req.body.amount, 1, 100_000);
    const selectedOption = numberInRange(req.body.selectedOption, 0, 2);
    if (!rehearsalId.startsWith('LOG-') || amount === null || selectedOption === null) {
        return res.status(400).json({ error: 'Complete a rehearsal and select an answer first.' });
    }

    const understood = selectedOption === 1;
    const receipt = db.saveAuditLog({ event: 'DECISION_RECEIPT', understood, amountBand: amount < 100 ? 'UNDER_100' : amount < 500 ? '100_TO_499' : '500_PLUS' });
    return res.json({
        success: true,
        receiptId: receipt.id,
        createdAt: receipt.timestamp,
        learningStatus: understood ? 'CORE_RISK_UNDERSTOOD' : 'REVIEW_RECOMMENDED',
        nextStep: understood
            ? 'Pause and independently verify the firm, evidence, costs and downside before deciding.'
            : 'Review the downside scenario: leverage magnifies losses as well as gains.',
        privacy: 'The claim text and personal reason were not stored in this demo receipt.',
        boundary: 'This receipt records completion of an educational rehearsal, not approval to invest.'
    });
});

// 2. SIMPLIFIED UK PAYSLIP EDUCATION API
app.post('/api/v1/payslip/decode', (req, res) => {
    const grossSalary = numberInRange(req.body.grossSalary, 0, 1_000_000);
    const taxCode = req.body.taxCode || "1257L";
    const studentLoanPlan = req.body.studentLoanPlan || "plan2";
    const pensionRate = numberInRange(req.body.pensionRate, 0, 100);
    if (grossSalary === null || pensionRate === null) return res.status(400).json({ error: 'grossSalary must be 0-1,000,000 and pensionRate must be 0-100.' });

    // UK 2026/2027 HMRC Tax Computation Engine Rules
    let personalAllowance = 12570;
    if (taxCode.toUpperCase() === "BR") personalAllowance = 0;
    if (taxCode.toUpperCase() === "0T") personalAllowance = 0;

    const taxableIncome = Math.max(0, grossSalary - personalAllowance);

    // PAYE Income Tax (20% Basic, 40% Higher above £50,270)
    let annualTax = 0;
    if (taxableIncome <= 37700) {
        annualTax = taxableIncome * 0.20;
    } else {
        annualTax = (37700 * 0.20) + ((taxableIncome - 37700) * 0.40);
    }

    // Class 1 National Insurance (8% between £12,570 and £50,270; 2% above)
    let annualNi = 0;
    const niThreshold = 12570;
    if (grossSalary > niThreshold) {
        const niEligible = grossSalary - niThreshold;
        if (niEligible <= 37700) {
            annualNi = niEligible * 0.08;
        } else {
            annualNi = (37700 * 0.08) + ((niEligible - 37700) * 0.02);
        }
    }

    // Student Loan Repayment (Plan 2: 9% above £27,295)
    let annualStudentLoan = 0;
    if (studentLoanPlan === "plan2" && grossSalary > 27295) {
        annualStudentLoan = (grossSalary - 27295) * 0.09;
    } else if (studentLoanPlan === "plan5" && grossSalary > 25000) {
        annualStudentLoan = (grossSalary - 25000) * 0.09;
    }

    // Pension Employee & Employer Match (3% minimum statutory match)
    const annualEmployeePension = grossSalary * (pensionRate / 100);
    const annualEmployerMatch = grossSalary * (Math.min(pensionRate, 5) / 100);

    const annualNetPay = grossSalary - annualTax - annualNi - annualStudentLoan - annualEmployeePension;
    const monthlyNetPay = annualNetPay / 12;

    // Log Audit Event
    db.saveAuditLog({
        event: "PAYSLIP_DECODE",
        grossSalary,
        taxCode,
        monthlyNetPay: Math.round(monthlyNetPay),
        employerPensionMatchGbp: Math.round(annualEmployerMatch)
    });

    return res.json({
        success: true,
        summary: {
            grossSalaryAnnual: grossSalary,
            grossSalaryMonthly: Math.round(grossSalary / 12),
            personalAllowance,
            payeTaxMonthly: Math.round(annualTax / 12),
            nationalInsuranceMonthly: Math.round(annualNi / 12),
            studentLoanMonthly: Math.round(annualStudentLoan / 12),
            employeePensionMonthly: Math.round(annualEmployeePension / 12),
            freeEmployerPensionMatchMonthly: Math.round(annualEmployerMatch / 12),
            netTakeHomeMonthly: Math.round(monthlyNetPay),
            netTakeHomeAnnual: Math.round(annualNetPay)
        },
        assumptions: 'Simplified England, Wales and Northern Ireland educational estimate. Verify current HMRC rules before making decisions.'
    });
});

// 3. INVESTOR VS GAMBLER ANNUITY & CRASH SIMULATOR API
app.post('/api/v1/sandbox/simulate', (req, res) => {
    const monthlyContribution = numberInRange(req.body.monthlyContribution, 0, 100_000);
    const strategy = req.body.strategy || "global-etf"; // 'global-etf' | 'meme-crypto' | 'forex-leverage'
    const simulateCrash = req.body.simulateCrash === true;
    if (monthlyContribution === null || !['global-etf', 'meme-crypto', 'forex-leverage'].includes(strategy)) return res.status(400).json({ error: 'Invalid contribution or strategy.' });

    const years = 5;
    const trajectory = [];
    let balance = 0;
    let totalDeposited = 0;

    // Strategy Parameters
    let annualReturn = 0.08; // 8% global index ETF
    let volatility = 0.05;

    if (strategy === "meme-crypto") {
        annualReturn = 0.45;
        volatility = 0.60;
    } else if (strategy === "forex-leverage") {
        annualReturn = -0.30; // 90% loss trajectory over time
        volatility = 0.80;
    }

    for (let yr = 1; yr <= years; yr++) {
        totalDeposited += monthlyContribution * 12;
        let yrReturn = annualReturn;

        if (simulateCrash && yr === 3) {
            // Apply historical market drawdown shock
            yrReturn = strategy === "global-etf" ? -0.22 : -0.85;
        }

        balance = (balance + monthlyContribution * 12) * (1 + yrReturn);
        if (balance < 0) balance = 0;

        trajectory.push({
            year: yr,
            totalDeposited: Math.round(totalDeposited),
            projectedValue: Math.round(balance),
            marketCrashShockApplied: simulateCrash && yr === 3
        });
    }

    db.saveAuditLog({
        event: "INVESTOR_SANDBOX",
        strategy,
        monthlyContribution,
        finalValue: Math.round(balance),
        totalDeposited
    });

    return res.json({
        success: true,
        strategy,
        simulateCrash,
        monthlyContribution,
        years,
        finalValue: Math.round(balance),
        totalDeposited: Math.round(totalDeposited),
        netGainLoss: Math.round(balance - totalDeposited),
        trajectory
    });
});

// 4. B2B FCA CONSUMER DUTY COMPLIANCE TELEMETRY API
app.get('/api/v1/b2b/telemetry', requireAdmin, (req, res) => {
    const metrics = db.getB2bMetrics();
    const recentLogs = db.getAuditLogs(15);

    return res.json({
        success: true,
        fcaComplianceFramework: "FG22/5 Consumer Duty Audit Engine",
        metrics: {
            ...metrics,
            totalAuditLogsStored: recentLogs.length,
            systemStatus: "DEMO_NOT_COMPLIANCE_EVIDENCE"
        },
        recentAuditLogs: recentLogs
    });
});

// B2B FCA Consumer Duty Telemetry CSV / JSON Audit Exporter Endpoint
app.get('/api/v1/b2b/export', requireAdmin, (req, res) => {
    const format = (req.query.format || 'json').toLowerCase();
    const logs = db.getAuditLogs(100);

    if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="FCA_Consumer_Duty_Audit_Telemetry_FinPulse.csv"');
        
        let csv = 'Audit_ID,Timestamp,Event_Type,Platform,Scam_Risk_Score,Risk_Level,Gross_Salary,Tax_Code\n';
        logs.forEach(l => {
            csv += `"${l.id}","${l.timestamp}","${l.event || ''}","${l.platform || ''}","${l.scamScore || ''}","${l.riskLevel || ''}","${l.grossSalary || ''}","${l.taxCode || ''}"\n`;
        });
        return res.send(csv);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="FCA_Consumer_Duty_Audit_Telemetry_FinPulse.json"');
    return res.json({
        exportTimestamp: new Date().toISOString(),
        evidenceType: "DEMO_EDUCATIONAL_EVENTS_NOT_COMPLIANCE_EVIDENCE",
        totalExportedLogs: logs.length,
        auditLogs: logs
    });
});

// Partner ISA Lead Referral Bounty Endpoint
app.post('/api/v1/isa/referral', (req, res) => {
    const credentialToken = `FINPULSE-DEMO-${Date.now()}`;
    const bountyGbp = 0;

    db.saveAuditLog({
        event: "ISA_PARTNER_REFERRAL",
        credentialToken,
        bountyGbp,
        evidenceType: "DEMO_LEARNING_COMPLETION"
    });

    return res.json({
        success: true,
        credentialToken,
        bountyGbp,
        message: "Demo credential generated. This is not an offer, regulated referral, or proof of financial capability."
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:file', (req, res, next) => publicFiles.has(req.params.file) ? res.sendFile(path.join(__dirname, req.params.file)) : next());
app.use('/public', express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: false }));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error, req, res, next) => {
    console.error(error.message);
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    return res.status(502).json({ error: 'Upstream service unavailable' });
});

// Export App for Vercel / Serverless Functions
module.exports = app;

// Start Server if run directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`===================================================`);
        console.log(`⚡ FinPulse AI Enterprise REST API Engine ONLINE`);
        console.log(`🌐 Server running at: http://localhost:${PORT}`);
        console.log(`🛡️ FCA Consumer Duty Telemetry Vault Active`);
        console.log(`===================================================`);
    });
}
