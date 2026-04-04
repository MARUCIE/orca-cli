# Forge CLI

**Provider-neutral agent runtime — Claude, GPT, Gemini through one CLI.**

```bash
export POE_API_KEY=your-key
forge chat -p poe
```

## Install

```bash
npm install -g @armature/forge-cli
```

## Usage

```bash
# Interactive REPL (multi-turn, multi-model)
forge chat -p poe

# One-shot query
forge chat -p poe -m GPT-4o "explain this codebase"

# Task execution with agent tools
forge run -p poe "fix the failing tests"

# Initialize project config
forge init
```

## Features

- **Multi-model**: Claude-Sonnet-4, GPT-4o, Gemini-2.5-Pro — switch with `/models`
- **Agent tools**: Read, Write, Search, ListDir, Bash — model calls autonomously
- **Multi-turn**: Conversation history persists, `/compact` to manage context
- **13 commands**: `/help /model /models /clear /compact /system /history /tokens /stats /retry /cwd /exit`
- **Rich display**: `● Read(file:1-5)` → `│ 5 lines` → `✓ 0.1s`
- **Metrics**: tok/s, cost ($), TTFT, session totals
- **Controls**: Esc cancel, Tab completion, Up/Down history, Ctrl+L clear

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/models` | Interactive model picker |
| `/model set <name>` | Switch model mid-session |
| `/clear` | Clear conversation |
| `/compact` | Keep last 2 turns |
| `/system <prompt>` | Set system prompt |
| `/retry` | Retry last message |
| `/stats` | Session statistics |
| `/exit` | Exit with summary |

## Configuration

```
CLI flags  >  ENV vars  >  .armature.json  >  ~/.armature/config.json
```

## Architecture

Forge CLI is the product layer of the [Armature Agent SDK](https://github.com/MARUCIE/armature-agent-sdk).

```
forge-cli (this repo)
  └── @armature/sdk (optional, for native provider path)
  └── openai (for Poe/OpenRouter proxy path)
```

## License

MIT — Maurice | maurice_wen@proton.me
