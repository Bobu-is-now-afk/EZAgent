# EZAgent judge demo landing

This standalone page is adapted from the teammate's public repository at
https://github.com/saya-zhandev/ezagent (commit `abee346`, 2026-10-18).

The setup and model download sequence is a simulation. The browser can call an
Ollama-compatible API only after an address is configured in Settings. Until
then, Chat and Agent display labelled offline samples. No installer is included.

Deploy this folder as a separate Vercel project with Root Directory `demo` and
Production Branch `main`. Do not put API keys in `index.html` or expose a raw
Ollama service publicly. A protected server-side proxy is needed for live AI.
