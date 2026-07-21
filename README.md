# Email Inbox Routing

An AI-assisted **shared-inbox email classification and routing** toolkit — a practical automation case study for workplace mail handling.

Contact-form and shared-inbox teams often spend time reading the same kinds of messages and forwarding them to the right owners. This project shows how to turn that into a repeatable pipeline: **extract → classify with an LLM → decide → prefill a native forward** (Outlook) or batch-process local files.

> Demo data uses fictional `example.com` mailboxes and a generic “DemoCo” company. Routing categories and recipients are **illustrative** — swap them for your own taxonomy.

---

## What it demonstrates

| Capability | How |
|------------|-----|
| Form / notification parsing | Extract submitter + message body from relay-style notifications |
| Multi-category LLM scoring | One model call scores many routing categories with confidence |
| Decision policy | Threshold, ambiguity → review queue, carve-outs for edge cases |
| Rule-based forwarding | Category → To recipients + mandatory CC; or no-forward + guidance link |
| Outlook Classic bridge | VBA macro calls Node, opens a native Forward draft with To/CC filled |
| Audit trail | Local JSONL log of classify / route outcomes |
| Optional Graph path | Microsoft Graph helpers for mailbox read / forward (tenant permitting) |

```
Inbound notification / .eml / pasted body
  → SubmitterExtractor
  → LlmEmailClassifier (OpenAI-compatible chat API)
  → decide (confidence threshold)
  → buildForwardTargets (To + CC)
  → Outlook forward draft  |  inbox batch  |  audit log
```

---

## Quick start

**Requirements:** Node.js 20+, an OpenAI-compatible API key.

```powershell
git clone https://github.com/<you>/email-inbox-routing.git
cd email-inbox-routing
copy .env.example .env
# Edit .env: set LLM_API_KEY (and URL/model if not OpenAI)
npm install
npm test
npm run classify -- --body-file fixtures/atra-media-inquiry.txt
```

Example `.env`:

```env
LLM_BASE_URL=https://api.openai.com
LLM_API_PATH=/v1/chat/completions
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

Any OpenAI-compatible endpoint works (Azure OpenAI, local gateways, etc.).

---

## Everyday workflows

| Goal | Command / action |
|------|------------------|
| Classify a sample body | `npm run classify -- --body-file fixtures/...` |
| JSON for automation | `npm run classify:json -- --body-file ... --out result.json` |
| Batch local mail | Drop `.eml` / `.txt` into `inbox/` → `npm run process:inbox` |
| Outlook one-click | Install macros under [`outlook/`](outlook/README.md), select a message, run `ClassifyAndForwardSelected` |

The Outlook path is intentionally **human-in-the-loop**: the macro prefills recipients; you review and send. That keeps control with the mailbox owner while still cutting classification and addressing time.

---

## Project layout

```
src/
  classifier/     LLM client + multi-category scorer
  submitterExtractor/
  router/         Forward / no-forward / review outcomes
  ruleSet/        Demo category → recipient mappings
  manualRouting/  Shared CLI + VBA classify-and-route
  graph/          Optional Microsoft Graph helpers
outlook/          VBA macros for Outlook Classic
fixtures/         Synthetic sample messages
tests/            Unit + property + integration tests
```

---

## Customizing for your team

1. Edit `src/ruleSet/seedData.ts` — categories, `FORWARD` / `NO_FORWARD_*`, and recipients.
2. Update `src/classifier/categoryGuidance.ts` — short descriptions used in the model prompt.
3. Adjust `FORWARD_CC_RECIPIENT` in `src/router/index.ts` if you always CC a shared mailbox.
4. Point `EXPECTED_SENDER` / subject filters in `src/notificationFilter/` at your notification format.

Keep real addresses and internal runbooks out of public forks; this repo ships only demo placeholders.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Run the automated suite |
| `npm run classify` | Interactive / file-based classification |
| `npm run classify:json` | Machine-readable result (used by VBA) |
| `npm run process:inbox` | Watch / process `inbox/` |
| `npm run setup` | Windows helper: install deps, seed `.env` |
| `npm run verify` | Check Node + `.env` + LLM connectivity |

---

## Design notes (portfolio angle)

- **Native forward, not rewrite** — forwarding keeps the original body, subject, and attachments; the tool only chooses recipients.
- **Ambiguity is a first-class outcome** — low confidence or competing categories go to review instead of a wrong mailbox.
- **Desktop bridge when cloud APIs are restricted** — Outlook VBA + local Node is a realistic pattern when Graph or IT policy blocks full automation.
- **Rules as data** — categories and recipients are versionable mappings, not buried in prompt text alone.

---

## License

MIT — see [LICENSE](LICENSE). Demo fixtures and category names are fictional examples only.
