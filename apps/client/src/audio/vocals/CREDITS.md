# Vocal Clips Provenance & Credits

Each clip in this folder is a short spoken-word intro or stinger generated offline with synthetic text-to-speech and mastered to mono 24 kHz 64 kbps MP3 (`.scratch/music/master.py` via `ffmpeg` `libmp3lame`).

## Generation Tool & Voices

- **Tool:** `gemini-api` CLI v0.5.0 (`gemini-api tts --language en-US -o json`), models **`gemini-3.8-flash-tts`** (`menu`, `calm`, `council`, `story`, `beach`, `victory`, `defeat`) and **`gemini-3.8-flash-lite-tts`** (`proposals`, `final`, `academy`, regenerated when `gemini-3.8-flash-tts` Free Tier daily quota was exhausted)
- **Voices:** Google Gemini 3.8 TTS **prebuilt studio voices** (synthetic catalog voices, not voice clones or replications of named real people)
- **Processing:** `highpass=85 Hz`, `+2 dB @ 220 Hz`, `-1.5 dB @ 3200 Hz`, `lowpass=7600 Hz`, compressor (`-20 dB`, `3:1`), `loudnorm` (`-16 LUFS`, `-1.5 dBTP`, `LRA 9`), `15 ms` fade-in (`24000 Hz`, mono `64 kbps` MP3)

## Licence & Commercial Use Terms

Governed by the **Google APIs Terms of Service** (`https://developers.google.com/terms`), **Gemini API Additional Terms of Service** (`https://ai.google.dev/gemini-api/terms`), and **Generative AI Prohibited Use Policy** (`https://policies.google.com/terms/generative-ai/use-policy`):

- **Ownership:** Under *Use of Generated Content*, *"Google won't claim ownership over that content."* Pre-generated audio outputs may be used commercially in a public game built by developers for professional or business purposes.
- **Compliance obligations:**
  - Do not misrepresent AI-generated speech as human-performed (`Prohibited Use Policy`).
  - Do not use outputs to train, extract, reverse-engineer, or build competing voice or AI models.
  - Prebuilt voices and generated audio may contain embedded SynthID watermarks; note that Google may generate similar audio outputs for other developers using the same prebuilt voices.
  - Note on service tiers: the game ships only static offline-generated MP3 files (it makes no live Gemini API calls and embeds no API client). If regenerating assets, review Paid vs. Unpaid Services terms for training-data retention, EEA/UK/Switzerland rules on API clients, and age-18 requirements.

## Clips & Verbatim Scripts

| File | Voice (Prebuilt) | Style Prompt (`--style`) | Exact Script (`text`) |
|---|---|---|---|
| `menu.mp3` | `Charon` | `smoky late-night noir radio narrator, warm, rhythmic, mysterious` | `Golden hour across Port Concord bay... <short pause> Seven guardians watch the vault till break of day. <breath> Blind-signed notes passing hand to hand, <short pause> Two-thirds honest keeps the ledger grand... <short pause> In the Mint Citadel, shadows softly creep — who guards the federation while the harbor sleeps?` |
| `calm.mp3` | `Sulafat` | `cool late-night lo-fi spoken word, relaxed and observant` | `First light on the docks, the block clock starts slow. <short pause> Four stations humming where the ecash notes flow. <breath> Keep your eyes open, keep the consensus clear... <short pause> Every honest signature holds the vault right here.` |
| `proposals.mp3` | `Kore` | `tense noir detective voice, low and measured` | `A new withdrawal hits the signing hall desk... <short pause> Looks like a user's note, <short pause> or a Byzantine test. <breath> Read the signer list, check the archive light... <short pause> Let a forged one reach threshold and the mint falls tonight.` |
| `final.mp3` | `Fenrir` | `urgent whispered thriller countdown, hushed intensity` | `Final blocks ticking down over Saltmarket stones... <short pause> <breath> Partitions snapping, static in the relay tones. <short pause> Hold the threshold steady, watch who hesitates last... <short pause> Twelve blocks left, and the die is cast.` |
| `council.mp3` | `Algenib` | `solemn gravelly council elder, slow deliberate cadence` | `<breath> Ring the brass bell, gather round the seal. <short pause> Secret ballots drop, before the truth reveals. <short pause> One-third Byzantine, and the federation stalls... <short pause> Weigh the evidence carefully inside these council walls.` |
| `story.mp3` | `Despina` | `intimate twilight storyteller, soft smoky harbour noir` | `Low tide in Gullmoor, rain on the street... <short pause> Twelve cold words lost beneath winter sleet. <breath> Follow the torchlight, keep out of sight... <short pause> Every ledger remembers who walked Port Concord tonight.` |
| `beach.mp3` | `Aoede` | `warm sunlit island radio host, relaxed and smiling` | `Welcome to Beach Town, sun on the pier! <short pause> Seven bright stalls and cold drinks near. <breath> Spend your power-of-two notes, pocket the change... <short pause> No Byzantines here — just the sea breeze and waves.` |
| `academy.mp3` | `Iapetus` | `encouraging mentor over a chill study beat, calm and clear` | `Count the threshold, check the quorum line... <short pause> Byzantines under one-third keep the split network fine. <breath> Drill the federation math till it's second nature to see: <short pause> more than two-thirds honest keeps the vault free.` |
| `victory.mp3` | `Puck` | `triumphant warm celebration, energetic and relieved` | `<breath> Threshold reached! Every forged plot turned away. <short pause> The federation stands unbroken at the close of day. <short pause> Raise a glass in Port Concord, the vault is safe and sound!` |
| `defeat.mp3` | `Enceladus` | `melancholy rainy harbour-noir outro, quiet and reflective` | `<sigh> Rain on the harbor... the threshold slipped away. <short pause> Either the mint has halted, or a forged note had its say. <breath> Remember the signers, remember who stood by... <short pause> Another round in Port Concord beneath a darker sky.` |
