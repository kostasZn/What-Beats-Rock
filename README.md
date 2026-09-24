# What Beats a Rock Discord Bot

A discord bot for the "What beats rock?" game. Each player starts with:

> What beats rock?

They answer with `/beat answer: paper`, the bot judges the move, replies with a reason, then asks what beats the new thing.

## Commands

- `/beat answer:<thing>`: Submit a move for your current prompt.
- `/wagercreate bid:<rp>`: Start a multiplayer wager match.
- `/wagerjoin bid:<rp>`: Join the current multiplayer wager match.
- `/wagerplay answer:<thing>`: Play your current wager prompt.
- `/ranks`: Show all ranks and their RP requirements.
- `/slots amount:<rp>`: Bet RP on the slot machine.
- `/prompt`: See your current prompt.
- `/stats`: See your personal rank and chain high score.
- `/leaderboard`: Show player ranks and chain high scores.
- `/setuprankroles`: Admin only. Create or reuse rank roles and sync them to everyone who has played.
- `/setgamechannel`: Admin only. Choose the channel where the bot should be used.

## Setup

1. Install Node.js 20
2. Install dependencies:

```bash
npm install
```

3. Fill in:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
OPENAI_API_KEY=...
```

4. Deploy commands:

```bash
npm run deploy
```

5. Start the bot:

```bash
npm start
```
## How Scoring Works

- A valid answer increases your current chain by 1 and gives `+10 RP`.
- A wrong answer ends the run, resets your prompt back to rock, and costs `-15 RP`.
- Rank roles are created by playing: users only get a rank role after they use `/beat`, or when an admin runs `/setuprankroles` to sync existing players.

Ranks:

- Pebble: 0 RP
- Gravel: 100 RP
- Cobblestone: 250 RP
- Granite: 500 RP
- Diamond: 900 RP
- Emerald: 1400 RP
- Obsidian: 2000 RP
- Rock: 3000 RP
