# FinPulse AI — FinTech Hackathon Project

> **Portfolio Note:** FinPulse AI was developed collaboratively during a fintech hackathon. This repository is a fork of the original team repository and is included on my GitHub portfolio to showcase the project and my contribution to its development.

## Live Demo

🚀 **[Try FinPulse AI](https://finpulse-ai-dqho.onrender.com/)**

## About FinPulse

FinPulse is an AI-powered fintech prototype designed to make financial information easier to understand and help users recognise potentially misleading or fraudulent financial content.

The platform combines financial education, scam-awareness tools and interactive learning experiences in one accessible application.

### Key Features

- **Scam Check** — analyses financial content to help users identify potential warning signs and suspicious claims.
- **Money Lab** — introduces users to different investment options and provides educational guidance around investment decisions.
- **Money Battle** — gamified financial-learning challenges designed to make financial concepts more engaging.
- **Money Sense** — scenario-based financial education that allows users to practise making financial decisions.
- **Interactive Financial Education** — simplifies financial concepts for users with different levels of financial knowledge.

## My Contribution

During the hackathon, I contributed to the development of FinPulse through:

- Product ideation and feature development
- Designing the user journey and overall experience
- Development and refinement of the financial scam-detection concept
- Investment-learning and financial-literacy features
- Testing and improving the prototype
- Working collaboratively with the team to develop the final hackathon solution

The project gave me practical experience combining **FinTech, AI, financial education, product thinking and user-centred problem solving**.

## Skills Demonstrated

`FinTech` · `Artificial Intelligence` · `Financial Literacy` · `Product Development` · `Problem Solving` · `Teamwork` · `Prototype Development`

---
---# FinPulse AI

FinPulse AI is an educational financial-literacy and scam-awareness prototype built for the Work in Fintech AI Summit & AI Hackathon 2026.

It demonstrates:

- plain-language checks for common high-risk promotion patterns;
- a guided pre-decision rehearsal with missing-context questions, a personalised downside scenario, a comprehension check and a private Decision Receipt;
- a simplified UK payslip learning calculator;
- hypothetical investment stress-test visualisations;
- gamified financial-literacy lessons;
- a concept dashboard for potential partner outcome measurement.

## Important limitations

FinPulse AI does not provide financial advice, determine whether a firm is authorised, perform real image/video OCR, certify financial capability, or establish FCA Consumer Duty compliance. Outputs are educational prompts produced by deterministic rules. Verify firms directly through the official FCA Register and Warning List, and verify tax results against current HMRC guidance.

## 90-second judge demo

1. Select **50x Forex Scam** and run **Check Claim Risk Indicators**.
2. Keep Maya's example amount and rental-deposit reason, then select **Rehearse Maya's Decision**.
3. Show the missing context and personalised leverage downside.
4. Answer **It magnifies losses as well as gains**.
5. Generate the private Decision Receipt and close on the independent-verification next step.

The receipt records educational completion only. It intentionally stores neither the pasted claim nor Maya's personal reason.

The public deployment stores only short-lived, non-identifying demo events in memory. It intentionally has no durable customer database. Partner telemetry routes are hidden unless `ADMIN_API_TOKEN` is configured. The app does not mirror the FCA Warning List because its former RSS URL currently redirects to a missing page; users are sent to the official live list instead. A production service would additionally require authenticated users, tenant isolation, consent and retention controls, a durable managed datastore, monitoring, regulatory review, and independent security testing.

## Local development

Requirements: Node.js 24.

```bash
npm ci
npm test
npm start
```

Open `http://localhost:3000`. The API health endpoint is `/api/v1/health`.

To call protected development endpoints, set a long random `ADMIN_API_TOKEN` and send it as a bearer token. Do not expose this token to browser code.

## Deployment

The repository includes a Vercel configuration that routes the website and API through the Express serverless entry point. Vercel creates preview deployments for pull requests and a production deployment from the configured production branch.

Before production deployment:

1. connect the GitHub repository to the Vercel project;
2. configure a long random `ADMIN_API_TOKEN` in Vercel project settings;
3. require the `CI / test` check and pull-request reviews on `master`;
4. validate the preview URL, including `/api/v1/health`, before merging.

## Security and privacy

- Only an explicit allowlist of website assets is public; source and data files are not served.
- API payloads are size-limited and rate-limited.
- Partner telemetry and exports require server-side authentication.
- No user-provided claim, salary, or referral data is written to disk.
- Dependency updates are monitored with Dependabot.

## Licence

MIT. Third-party trademarks belong to their respective owners.
