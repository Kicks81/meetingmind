# MeetingMind

**A local, private, Granola-style live meeting note taker — with first-class Chinese + English support (including mid-sentence code-switching).**

MeetingMind live-transcribes your meetings (your mic **and** the other side's audio), writes rolling summaries as the meeting happens, automatically answers questions raised in the meeting using your own Obsidian vault as a knowledge base, and exports everything into one clean Obsidian note — finishing with a structured final summary (TL;DR, decisions, action items, open questions).

Everything runs on your machine. Audio goes only to the ASR provider you configure; text goes only to the LLM you select. No accounts, no telemetry, no cloud storage.

## What it does

| During the meeting | |
|---|---|
| 🎙️ **Live transcription** | Streaming ASR (BytePlus Seed-ASR) tuned for zh/en code-switching. Interim text appears as you speak, finalized segments lock in. |
| 📝 **Rolling summaries** | Every ~80 words the LLM appends a bulleted update — shaped by a selectable template (General / 1:1 / Standup / Client call / Interview / Brainstorm / Training). Always pinned to the latest. |
| 💡 **Auto Q&A with your vault** | Questions asked out loud are detected (works with both `?` and `？`), filtered for substance, and answered using the meeting context **plus** relevant notes retrieved from your Obsidian vault. You can also type your own question any time. |
| ✏️ **Correction dictionary** | Select a mis-heard name → type the right one. Applied to everything retroactively and forever after, and fed back to the ASR as a hotword so it starts hearing it right. |
| 🧹 **Small-talk removal** | One click AI-cleans greetings/filler from the transcript; hover ✕ deletes any single segment. |

| After the meeting | |
|---|---|
| 🏁 **Final synthesis** | On Stop: one structured note — TL;DR, Decisions, Action Items (with owners), Open Questions — in the meeting's language. |
| 🗂️ **Obsidian export** | One note per meeting in your chosen vault folder (`YYYY-MM` subfolder automatic), grown via appends during the meeting. Oversized content splits automatically; nothing is ever silently lost. |
| 💾 **Crash-safe** | The whole session autosaves every 5 s. Chrome crash, refresh, reboot — reopen and click Restore. |
| 🔌 **Self-healing** | Mid-meeting connection drops auto-reconnect with backoff. |

## Quick start

**Prerequisites:** Windows + Chrome, [Node.js](https://nodejs.org), a [BytePlus](https://www.byteplus.com) API key (speech), an [OpenRouter](https://openrouter.ai) API key (LLM).

1. Clone this repo and double-click **`start.bat`** — it installs the one dependency (`ws`), starts the relay, and opens the app at `http://localhost:8765`.
2. Allow the microphone **"while visiting the site"** (asked once, remembered forever).
3. Paste your OpenRouter and BytePlus keys into the header fields (stored only in your browser; **Save Config** exports them to a local JSON if you want a backup — keep that file out of git, it's already ignored).
4. Enter your Obsidian **vault name** (the name, not the path) and pick a notes folder (📁 button autocompletes from your real vault folders).
5. Optional but recommended: click **Load Vault** and select your vault folder so Q&A can cite your own notes, and pre-seed the **Hotwords** box with names/jargon the ASR should expect.
6. Click **Start Meeting**. For online calls, either share your screen with "share audio" checked, or set up a loopback device (e.g. VB-Cable) once and select it in the system-audio dropdown for zero-prompt starts.

Model tip: **DeepSeek V4 Flash** is the sweet spot for zh/mixed meetings — Chinese-native, fast, and cheap.

## How it's built

```
Chrome (meeting.html + core.js)          Node relay (relay.js)
┌────────────────────────────────┐      ┌──────────────────────┐
│ mic + system audio → PCM16     │ ws   │ adds auth headers,   │ wss   BytePlus
│ BytePlus binary protocol       ├─────►│ pipes bytes verbatim ├─────► Seed-ASR
│ summaries / Q&A (streaming)    │      │ + serves the app     │
│ Obsidian export via obsidian://│      └──────────────────────┘
└───────────────┬────────────────┘
                │ https                        obsidian://new URIs
                ▼                                     ▼
           OpenRouter (any model)               Obsidian vault
```

- **No build step.** One HTML file + one pure-logic JS module + one relay. Open, read, edit.
- **CJK-correct by contract.** Every text function (question detection, word counting, vault search, language pinning) has an explicit Chinese strategy, regression-tested against zh / en / mixed fixtures: `node evals/run.mjs`.

## For developers

- [DEVELOPMENT.md](DEVELOPMENT.md) — every architecture decision and its rationale (D1–D12), sharp edges, gotchas. **Read this first.**
- [BACKLOG.md](BACKLOG.md) — prioritized work queue with full history.
- [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md) — the iteration protocol (one item → implement → verify → commit) and the Granola scorecard.
- [CLAUDE.md](CLAUDE.md) — hard constraints for AI-assisted development.

## License

No license granted yet — private project. All rights reserved.
