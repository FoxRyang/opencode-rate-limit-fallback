# OpenCode Rate Limit Fallback Plugin (Enhanced)

Enhanced fork of the OpenCode rate-limit-fallback plugin with chat notifications and improved tracking.

Original: [sk2andy/opencode-rate-limit-fallback](https://github.com/sk2andy/opencode-rate-limit-fallback)  
Based on: [liamvinberg/opencode-rate-limit-fallback](https://github.com/liamvinberg/opencode-rate-limit-fallback)

## ✨ Enhancements

- **💬 Chat Notifications**: Fallback events are now visible in the chat with details
- **📊 Detailed Tracking**: Track which models were used and fallback history per session
- **🔄 Multi-Model Support**: Rotate through multiple fallback models
- **📝 Rich Logging**: File-based logging with structured data

## Installation

### Method 1: Using npm/published version

Add to your `opencode.jsonc`:
```json
{
  "plugin": ["opencode-rate-limit-fallback"]
}
```

### Method 2: Local development

Clone this repo and use the local path:
```json
{
  "plugin": [
    "file:///path/to/opencode-rate-limit-fallback/index.ts"
  ]
}
```

## Configuration

Create `rate-limit-fallback.json` in your OpenCode config directory:

```json
{
  "enabled": true,
  "fallbackModel": [
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "google/gemini-2.0-flash"
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

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `fallbackModel` | string \| object \| array | `"anthropic/claude-opus-4-5"` | Fallback model(s) - supports single or multiple models |
| `cooldownMs` | number | `300000` | Cooldown period in ms (default: 5 minutes) |
| `patterns` | string[] | See code | Custom rate limit detection patterns |
| `logging` | boolean | `false` | Enable file-based logging |

### Multi-Model Fallback Chain

When you specify an array of models, the plugin will rotate through them:

1. Main model fails → try first fallback
2. First fallback fails → try main model again
3. Main model fails → try first fallback again
4. First fallback fails → try second fallback
5. Continue through all configured fallbacks

## Chat Notification Example

When a rate limit is detected, the plugin adds a notice to your message:

```
⚠️ **[Rate Limit Fallback]** Attempt #1
📝 **Reason**: rate limit exceeded for model claude-3-5-sonnet-20241022
🔄 **Model Switch**: anthropic/claude-opus-4 → openai/gpt-4o
⏱️ **Time**: 3/31/2026, 5:25:47 PM
---

[Your original message here...]
```

## How It Works

1. **Detection**: Listens for `session.status` events with retry messages matching configured patterns
2. **Notification**: Prepends a fallback notice to your original message showing:
   - Attempt number
   - Rate limit reason
   - Model switch details (from → to)
   - Timestamp
3. **Fallback**: Reverts the session and resends with the fallback model
4. **Cooldown**: Prevents spam by ignoring subsequent rate limits during cooldown period

## Logging

When `logging: true`, logs are written to:
```
~/.local/share/opencode/logs/rate-limit-fallback.log
```

## Differences from Original

| Feature | Original | This Fork |
|---------|----------|-----------|
| Multi-model fallback | ❌ Single only | ✅ Array support |
| Chat notifications | ❌ Silent | ✅ Visible notice |
| Session tracking | ❌ Basic | ✅ Detailed history |
| Rotation pattern | ❌ None | ✅ Intelligent rotation |

## License

MIT License - see [LICENSE](LICENSE) file.
