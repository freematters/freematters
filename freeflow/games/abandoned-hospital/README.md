# Abandoned Hospital

A psychological horror interactive fiction game powered by FreeFSM.

## Synopsis

You are an urban exploration streamer who breaks into Renxin Hospital — a facility that closed 30 years ago under suspicious circumstances. The doors lock behind you. Your phone has no signal. And you are not alone.

Uncover the truth about what happened to 27 psychiatric patients and the nurse who tried to save them.

## Features

- **Psychological horror** — tension and dread over gore
- **Branching narrative** — your choices shape the story
- **Instant-death traps** — most wrong choices are fatal
- **Sanity system** — your mental state affects what you see and which endings you can reach
- **4 endings** — True End, Good End, Bad End, Hidden End
- **7 puzzles** — from tutorial-level to brutally hard

## How to Play

```bash
cd freefsm/games/abandoned-hospital
freefsm start abandoned-hospital.fsm.yaml
```

The game master (your AI agent) will describe scenes, track your stats, and enforce the rules. You interact by choosing numbered options or typing free-form actions.

## Files

| File | Description |
|------|-------------|
| `abandoned-hospital.fsm.yaml` | Game runtime FSM |
| `spec.md` | Full game design (contains spoilers!) |
