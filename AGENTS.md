# OpenCode Rate-Limit-Fallback Plugin

**Generated:** 2025-03-31  
**Stack:** TypeScript, OpenCode Plugin API, Bun/npm  
**Size:** ~500 LOC across 4 files

## OVERVIEW

Enhanced OpenCode plugin that automatically switches to fallback models when rate limits are hit. Unlike the original, this fork adds chat notifications, multi-model rotation, and detailed session tracking.

**Key Features:**
- Chat-visible fallback notifications with attempt count and model switch details
- Multi-model fallback chain (rotates through configured models)
- Per-session cooldown to prevent spam
- Optional file-based logging

## STRUCTURE

```
./
├── index.ts          # Plugin entry point - exports createPlugin
├── src/
│   ├── plugin.ts     # Core plugin logic (~360 lines)
│   ├── config.ts     # Config loading and parsing (~110 lines)
│   └── log.ts        # File-based logger (~40 lines)
├── package.json      # ES module, ships TS source directly
├── tsconfig.json     # ES2022, NodeNext, strict mode
└── README.md         # User documentation
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| **Change fallback behavior** | `src/plugin.ts` | `getNextFallbackModel()`, `createFallbackNoticeParts()` |
| **Modify config schema** | `src/config.ts` | `RateLimitFallbackConfig` interface, `DEFAULT_CONFIG` |
| **Add rate limit patterns** | `src/config.ts` | `DEFAULT_PATTERNS` array |
| **Change log format/location** | `src/log.ts` | `LOG_DIR`, `LOG_FILE` constants |
| **Plugin entry/exports** | `index.ts` | OpenCode calls ALL exports as plugins |
| **User-facing docs** | `README.md` | Installation, configuration examples |

## CONVENTIONS

### TypeScript
- **ES2022** target with **NodeNext** module resolution
- **Strict mode** enabled (no implicit any)
- **Type-only imports** for plugin types: `import type { Hooks }`
- Consistent file casing enforced

### Module System
- ES modules (`"type": "module"` in package.json)
- Ships TypeScript source directly (no build step)
- No `dist/` output despite tsconfig `outDir: "./dist"`

### Configuration
- Config file: `rate-limit-fallback.json` in OpenCode config dir
- Searches: `~/.config/opencode/`, plus `config/`, `plugins/`, `plugin/` subdirs
- Windows: `%APPDATA%/opencode/`

### Fallback Model Format
```typescript
// String format (parsed to object)
"anthropic/claude-sonnet-4"

// Object format (passed through)
{ providerID: "anthropic", modelID: "claude-sonnet-4" }
```

## ANTI-PATTERNS

- **NEVER add a build step** - Project ships TS source directly; consumers use Bun/Node with TS support
- **NEVER use default exports** for plugin functions - OpenCode calls ALL exports
- **NEVER remove `type` from type imports** - Causes runtime errors in some environments
- **NEVER ignore pattern case** - Rate limit detection is case-insensitive (`toLowerCase()`)

## COMMANDS

```bash
# Type check only (no build step)
npm run typecheck

# Install dependencies
bun install  # or npm install

# Use plugin locally in OpenCode
# Add to opencode.jsonc:
# "plugin": ["file:///path/to/rate-limit-fallback/index.ts"]
```

## FALLBACK SEQUENCE GUIDE

**Strongly based on:** [oh-my-openagent Agent-Model Matching Guide](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/agent-model-matching.md)

### Model Personality Matching

Different AI models have different "personalities" — they interpret instructions differently. **A model isn't just "smarter" or "dumber" — it thinks differently.** This plugin follows the oh-my-openagent principle of matching fallback models to the agent's working style.

### Recommended Fallback Chains

#### For Orchestration Agents (Sisyphus-style)
Agents that coordinate, delegate, and communicate heavily need **instruction-following models** that handle complex multi-step prompts:

```json
{
  "fallbackModel": [
    "anthropic/claude-opus-4-6",
    "kimi-for-coding/k2p5",
    "opencode-go/glm-5",
    "openai/gpt-5.4"
  ]
}
```

**Why:** Claude-family models (including Kimi and GLM) excel at following detailed checklists and maintaining conversation flow. GPT-5.4 works but should be last resort for communicators.

#### For Deep Specialist Agents (Hephaestus-style)
Agents that do autonomous deep work need **principle-driven models** that figure out mechanics from goals:

```json
{
  "fallbackModel": [
    "openai/gpt-5.4",
    "anthropic/claude-opus-4-6"
  ]
}
```

**Why:** GPT-5.4 responds to principles, not detailed instructions. Don't give it recipes — give it goals. Claude can work but requires more explicit prompting.

#### For Utility/Search Agents (Explore/Librarian-style)
Fast, cheap models for grep/search tasks where intelligence isn't the bottleneck:

```json
{
  "fallbackModel": [
    "github-copilot/grok-code-fast-1",
    "opencode-go/minimax-m2.7",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5-nano"
  ]
}
```

**Why:** Speed over intelligence. Don't "upgrade" utility agents to Opus — that's hiring a senior engineer to file paperwork.

### Model Family Reference

| Family | Models | Best For | Prompt Style |
|--------|--------|----------|--------------|
| **Claude-like** | Claude Opus/Sonnet/Haiku, Kimi K2.5, GLM 5 | Orchestration, communication, multi-step workflows | Mechanics-driven — detailed checklists, step-by-step procedures |
| **GPT-like** | GPT-5.4, GPT-5.4 Mini, GPT-5-Nano | Deep reasoning, architecture, autonomous exploration | Principle-driven — concise goals, let it figure out mechanics |
| **Gemini** | Gemini 3.1 Pro, Gemini 3 Flash | Visual tasks, frontend, documentation | Visual reasoning, multimodal |
| **Fast Utility** | Grok Code Fast, MiniMax M2.7 | Search, grep, retrieval | Speed-focused, minimal intelligence needed |

### Category-Based Mapping

Per [oh-my-openagent orchestration docs](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md), delegate by **category** (intent), not model name:

| Category | Recommended Model | Use Case |
|----------|------------------|----------|
| `visual-engineering` | Gemini 3.1 Pro | Frontend, UI/UX, CSS, design |
| `ultrabrain` | GPT-5.4 (xhigh) | Deep logical reasoning, architecture |
| `deep` | GPT-5.3 Codex | Goal-oriented autonomous problem-solving |
| `artistry` | Gemini 3.1 Pro | Creative, novel approaches |
| `quick` | GPT-5.4 Mini | Trivial tasks, single-file changes |
| `writing` | Gemini 3 Flash | Documentation, prose |

### Safe vs Dangerous Overrides

**Safe** — same personality type:
- Claude Opus → Claude Sonnet (both communicative)
- Kimi K2.5 → GLM 5 (both Claude-like)
- GPT-5.4 → Claude Opus (Prometheus auto-switches prompts)

**Dangerous** — personality mismatch:
- Sisyphus → older GPT models: Still a bad fit. GPT-5.4 is the only dedicated GPT prompt path for communicators.
- Hephaestus → Claude: Built for GPT's autonomous style. Claude can't replicate this.
- Explore/Librarian → Opus: Massive cost waste. Search doesn't need Opus-level reasoning.

### Configuration Example

```json
{
  "enabled": true,
  "fallbackModel": [
    "anthropic/claude-opus-4-6",
    "kimi-for-coding/k2p5",
    "openai/gpt-5.4"
  ],
  "cooldownMs": 300000,
  "patterns": [
    "rate limit",
    "usage limit",
    "too many requests",
    "quota exceeded",
    "overloaded"
  ],
  "logging": true
}
```

### Rotation Pattern

This plugin implements intelligent rotation per [oh-my-openagent orchestration](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md) principles:

1. **Attempt 1:** Try first fallback (e.g., Claude Opus)
2. **Attempt 2:** Return to main model (might have been transient)
3. **Attempt 3:** Try first fallback again
4. **Attempt 4+:** Rotate through remaining fallbacks sequentially

This pattern balances persistence with exploration — don't abandon working models too quickly, but exhaust options when failures persist.

## NOTES

- **Dual lockfiles**: Both `bun.lock` and `package-lock.json` present (migration artifact)
- **No tests**: No testing framework configured
- **No CI/CD**: No GitHub Actions or other automation
- **Peer dependency**: Requires `@opencode-ai/plugin >=1.0.0`
- **State management**: Uses in-memory Maps (`sessionStates`, `sessionModelInfo`)
- **Cooldown mechanism**: 5-minute default prevents rapid fallback cycling
- **Reference docs**: This plugin's fallback patterns are strongly informed by [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) multi-model orchestration principles
