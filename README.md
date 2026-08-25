# FinPulse.AI

**Spot the signs. Understand the risk. Protect your money.**

FinPulse.AI is a hackathon prototype for the Work in Fintech AI Summit 2026. It is designed for young people who need help **at the moment of a money decision**, using plain English rather than finance jargon.

## The product

### 🛡️ Scam Check
- Paste a public YouTube, TikTok, Instagram or X link.
- FinPulse can try to download the public audio and transcribe speech locally with `faster-whisper`.
- The transcript remains visible and editable so the user can correct it or paste text manually if a platform blocks automatic access.
- Scam Check looks for concrete warning patterns and shows the exact words that triggered each warning.
- Results use simple levels — **High concern / Be careful / Fewer warning signs** — rather than pretending a percentage is the probability that something is a scam.
- The result also explains **what seems to be sold**, **who may benefit**, why the warning sign matters, and what the user can check next.

### 💰 Money Lab
- A paper-simulation experience, not a recommendation engine.
- Users enter a starting amount, regular contribution, time horizon, purpose of the money, emergency-fund status and high-interest-debt status.
- FinPulse visualises money contributed, a simple steady-growth example, and a market-fall-and-recovery example.
- A 30% fall illustration shows why losses need a larger percentage gain to recover.
- A plain-English readiness checklist explains when investing **tends to fit better**: essential cash protected, expensive debt considered, and a longer time horizon.
- Separate guidance explains what to think about after a normal market loss versus a suspected scam.

### 🎮 Money Battles
- Five short social-learning rounds.
- Users earn points for spotting pressure, fake certainty and risky behaviour — **not for making the biggest fake profit**.
- A challenge link lets a friend try to beat the score.

### 🏆 My Progress
- Local streak, FinPoints, scam checks, completed battles and badges.
- No account is required for the prototype.

## Important safety boundary

FinPulse is educational. It does **not**:
- tell a user what specific product to buy or sell;
- guarantee that an offer is safe or fraudulent;
- guarantee investment returns;
- replace the FCA Firm Checker, a bank, police or professional advice;
- treat simulated market paths as forecasts.

## Run the app

Requirements: Node.js 24.

```bash
npm ci
npm test
npm start
```

Open `http://localhost:3000`.

## Optional automatic video transcription on Windows

The app remains usable without automatic transcription because users can paste a caption/transcript manually.

For automatic public-video transcription, use Python 3.12:

```powershell
py -3.12 -m venv .venv-transcribe
.\.venv-transcribe\Scripts\python.exe -m pip install -r requirements-transcribe.txt
```

The first transcription downloads the Whisper model. Public platforms can change or block automated media access; when that happens FinPulse falls back to manual text entry rather than pretending the video was analysed.

## Test

```bash
npm test
```

The test suite covers the existing API plus the new plain-English Scam Check and Money Lab endpoints.

## Deployment note

The core web app and Node API can be deployed normally. Local `yt-dlp` + Whisper transcription requires a host that can run Python and download public media; it will not automatically work on a basic serverless host without that runtime. For the hackathon demo, run the full transcription-enabled version locally and keep manual transcript entry as the safe fallback.
