# Outlook Classic bridge (human-in-the-loop)

When full mailbox automation via Microsoft Graph is unavailable or undesirable, use **Outlook Classic + VBA** for one-click classify + prefilled forward:

1. You select a message  
2. Macro calls the local Node classifier  
3. Outlook opens a native **Forward** draft with To / CC filled  
4. You review and send  

## Prerequisites

1. **Outlook Classic** (not New Outlook)
2. Node.js installed; `npm install` in this repo
3. `.env` configured with `LLM_*` (same as `npm run classify`)
4. Smoke test:

```powershell
npm run classify:json -- --body-file fixtures/atra-media-inquiry.txt --out $env:TEMP\test-routing.json
```

Expect `"action": "FORWARD"` and `outlookTo` containing a demo recipient such as `pr-media@example.com`.

## Install the macro

1. Outlook → **Alt+F11** → **Insert → Module**
2. Paste the full contents of **`EmailForwardRouting-paste.bas`** (prefer this file over `EmailForwardRouting.bas`, which may include an `Attribute VB_Name` line that breaks paste-compile)
3. Save, then **Alt+F8** → run **`Routing_TestPing`** (should show Macro OK)
4. Trust Center → enable macros as required by your org policy
5. Select one Contact-form notification → **Alt+F8** → **`ClassifyAndForwardSelected`**

If you ran `npm run setup` on Windows, the VBA resolves the project via the `EMAIL_ROUTING_HOME` environment variable.

## Macros

| Macro | Behavior |
|-------|----------|
| `Routing_TestPing` | Checks that `classify-json.bat` is reachable |
| `ClassifySelected` | Classify only; show summary dialog |
| `ClassifyAndForwardSelected` | Classify + open Forward draft with To/CC |

| Routing action | Outlook behavior |
|----------------|------------------|
| `FORWARD` | `mail.Forward()` draft; To + CC prefilled (includes demo `inbox-cc@example.com`) |
| `NO_FORWARD` | Info dialog + optional guidance URL |
| `REVIEW_QUEUE` | Prompt for manual handling |

## Tips

- Select the message in the **list** (row highlighted); reading pane alone is not enough
- Classification can take 10–60s depending on the model; watch the status bar
- If compile fails after paste, remove any `Attribute VB_Name = ...` line at the top of the module
