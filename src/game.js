const STARTING_PROMPT = "rock";
const WIN_RP = 10;
const LOSS_RP = 15;
const WAGER_JOIN_WINDOW_MS = 15_000;

export const SLOT_SYMBOLS = ["🪨", "🧱", "⛰️", "💎", "💚", "🌑", "☄️", "🔥"];
export const SLOT_ODDS = {
  hugeWin: 0.12,
  smallWin: 0.33,
  lose: 0.55,
};
export const SLOT_HUGE_WIN_MULTIPLIER = 3;

export const RANKS = [
  { name: "Pebble", minRp: 0 },
  { name: "Gravel", minRp: 100 },
  { name: "Cobblestone", minRp: 250 },
  { name: "Granite", minRp: 500 },
  { name: "Diamond", minRp: 900 },
  { name: "Emerald", minRp: 1400 },
  { name: "Obsidian", minRp: 2000 },
  { name: "Rock", minRp: 3000 },
];

export class Game {
  constructor(store, judge) {
    this.store = store;
    this.judge = judge;
  }

  async beat({ guildId, userId, answer }) {
    const user = this.store.getUser(guildId, userId);
    const submittedAnswer = normalizeThing(answer);

    if (submittedAnswer && user.runAnswers.includes(submittedAnswer)) {
      return {
        valid: false,
        blocked: false,
        duplicate: true,
        reply: `${titleCase(submittedAnswer)} already had its moment in this run. Try a different answer.`,
        nextPrompt: this.promptFor(user.current),
      };
    }

    const target = user.current;
    const judgment = await this.judge.judge({ target, answer });
    const cleanAnswer = normalizeThing(judgment.canonicalAnswer || answer);

    if (!judgment.valid) {
      const lossResult = this.failRun(user);
      await this.store.save();

      return {
        valid: false,
        blocked: false,
        previousChain: lossResult.previousChain,
        rp: lossResult.rp,
        rpChange: lossResult.rpChange,
        rank: lossResult.rank,
        target,
        answer: cleanAnswer,
        reply:
          judgment.reply ||
          `${titleCase(cleanAnswer)}? Really? ${titleCase(target)} is not losing sleep over that one.`,
        nextPrompt: lossResult.nextPrompt,
      };
    }

    user.current = cleanAnswer;
    user.currentRunChain += 1;
    user.bestChain = Math.max(user.bestChain, user.currentRunChain);
    user.runAnswers.push(cleanAnswer);
    user.rp += WIN_RP;
    await this.store.save();

    return {
      valid: true,
      blocked: false,
      chain: user.currentRunChain,
      rp: user.rp,
      rpChange: WIN_RP,
      rank: rankForRp(user.rp),
      target,
      answer: cleanAnswer,
      reply:
        judgment.reply ||
        `${titleCase(cleanAnswer)} beats ${target}. Duh.`,
      nextPrompt: this.promptFor(user.current),
    };
  }

  async slots({ guildId, userId, amount }) {
    const user = this.store.getUser(guildId, userId);

    const bet = Math.floor(Number(amount));
    if (!Number.isFinite(bet) || bet <= 0) {
      return {
        ok: false,
        message: "Your slot bet has to be at least 1 RP.",
        rp: user.rp,
        rank: rankForRp(user.rp),
      };
    }

    if (bet > user.rp) {
      return {
        ok: false,
        message: `You only have **${user.rp} RP** right now.`,
        rp: user.rp,
        rank: rankForRp(user.rp),
      };
    }

    const outcome = rollSlotOutcome();
    const reels = buildSlotReels(outcome);
    let rpChange = -bet;
    let resultType = "lose";

    if (outcome === "hugeWin") {
      rpChange = bet * SLOT_HUGE_WIN_MULTIPLIER;
      resultType = "hugeWin";
    } else if (outcome === "smallWin") {
      rpChange = bet >= 10 ? 10 : 5;
      resultType = "smallWin";
    }

    user.rp = Math.max(0, user.rp + rpChange);
    await this.store.save();

    return {
      ok: true,
      bet,
      resultType,
      reels,
      rpChange,
      rp: user.rp,
      rank: rankForRp(user.rp),
    };
  }

  async createWagerMatch({ guildId, userId, channelId, bid }) {
    const guild = this.store.getGuild(guildId);
    const user = this.store.getUser(guildId, userId);
    const safeBid = Math.floor(Number(bid));

    if (guild.wagerMatch) {
      return {
        ok: false,
        message: "A wager match is already running or filling in this server.",
      };
    }

    if (!Number.isFinite(safeBid) || safeBid <= 0) {
      return {
        ok: false,
        message: "Your bid has to be at least 1 RP.",
      };
    }

    if (safeBid > user.rp) {
      return {
        ok: false,
        message: `You only have **${user.rp} RP** right now.`,
      };
    }

    user.rp -= safeBid;
    guild.wagerMatch = {
      status: "joining",
      channelId,
      hostUserId: userId,
      createdAt: Date.now(),
      startsAt: Date.now() + WAGER_JOIN_WINDOW_MS,
      startingPrompt: null,
      statusMessageId: null,
      pot: safeBid,
      players: {
        [userId]: createWagerPlayer(safeBid),
      },
    };

    await this.store.save();
    return {
      ok: true,
      bid: safeBid,
      pot: guild.wagerMatch.pot,
      startsAt: guild.wagerMatch.startsAt,
      players: this.listWagerPlayers(guild.wagerMatch),
      rank: rankForRp(user.rp),
      rp: user.rp,
    };
  }

  async joinWagerMatch({ guildId, userId, bid }) {
    const guild = this.store.getGuild(guildId);
    const user = this.store.getUser(guildId, userId);
    const match = guild.wagerMatch;
    const safeBid = Math.floor(Number(bid));

    if (!match || match.status !== "joining") {
      return {
        ok: false,
        message: "There is no wager match open for joining right now.",
      };
    }

    if (userId in match.players) {
      return {
        ok: false,
        message: "You are already in this wager match.",
      };
    }

    if (!Number.isFinite(safeBid) || safeBid <= 0) {
      return {
        ok: false,
        message: "Your bid has to be at least 1 RP.",
      };
    }

    if (safeBid > user.rp) {
      return {
        ok: false,
        message: `You only have **${user.rp} RP** right now.`,
      };
    }

    user.rp -= safeBid;
    match.players[userId] = createWagerPlayer(safeBid);
    match.pot += safeBid;

    await this.store.save();
    return {
      ok: true,
      bid: safeBid,
      pot: match.pot,
      startsAt: match.startsAt,
      players: this.listWagerPlayers(match),
      rank: rankForRp(user.rp),
      rp: user.rp,
    };
  }

  async processReadyWagerMatches() {
    const now = Date.now();
    const events = [];

    for (const [guildId, guild] of Object.entries(this.store.state.guilds)) {
      const match = guild.wagerMatch;
      if (!match || match.status !== "joining" || match.startsAt > now) {
        continue;
      }

      const playerIds = Object.keys(match.players);
      if (playerIds.length < 2) {
        for (const [userId, player] of Object.entries(match.players)) {
          const user = this.store.getUser(guildId, userId);
          user.rp += player.bid;
        }

        guild.wagerMatch = null;
        await this.store.save();
        events.push({
          type: "cancelled",
          guildId,
          channelId: match.channelId,
          statusMessageId: match.statusMessageId ?? null,
        });
        continue;
      }

      const prompt = await this.judge.generateWagerPrompt();
      match.status = "active";
      match.startingPrompt = prompt;

      for (const player of Object.values(match.players)) {
        player.alive = true;
        player.chain = 0;
        player.currentPrompt = prompt;
        player.runAnswers = [];
      }

      await this.store.save();
      events.push({
        type: "started",
        guildId,
        channelId: match.channelId,
        statusMessageId: match.statusMessageId ?? null,
        prompt: this.promptFor(prompt),
        pot: match.pot,
        players: this.listWagerPlayers(match),
      });
    }

    return events;
  }

  async playWager({ guildId, userId, answer }) {
    const guild = this.store.getGuild(guildId);
    const match = guild.wagerMatch;

    if (!match || match.status !== "active") {
      return {
        ok: false,
        message: "There is no active wager match right now.",
      };
    }

    const player = match.players[userId];
    if (!player) {
      return {
        ok: false,
        message: "You are not part of the current wager match.",
      };
    }

    if (!player.alive) {
      return {
        ok: false,
        message: "You are already out of this wager match.",
      };
    }

    const submittedAnswer = normalizeThing(answer);
    if (submittedAnswer && player.runAnswers.includes(submittedAnswer)) {
      return {
        ok: true,
        valid: false,
        duplicate: true,
        answer: submittedAnswer,
        reply: `${titleCase(submittedAnswer)} already had its moment in this wager run. Try a different answer.`,
        nextPrompt: this.promptFor(player.currentPrompt),
      };
    }

    const target = player.currentPrompt;
    const judgment = await this.judge.judge({ target, answer });
    const cleanAnswer = normalizeThing(judgment.canonicalAnswer || answer);

    if (!judgment.valid) {
      player.alive = false;
      player.runAnswers = [];
      const previousChain = player.chain;

      const finish = await this.finishWagerMatchIfDone(guildId, match);
      return {
        ok: true,
        valid: false,
        duplicate: false,
        previousChain,
        answer: cleanAnswer,
        reply:
          judgment.reply ||
          `${titleCase(cleanAnswer)}? Swing and a miss. ${titleCase(target)} is still standing.`,
        publicStatus: this.getWagerPublicStatus(match),
        result: finish,
      };
    }

    player.currentPrompt = cleanAnswer;
    player.chain += 1;
    player.runAnswers.push(cleanAnswer);

    await this.store.save();
    return {
      ok: true,
      valid: true,
      duplicate: false,
      chain: player.chain,
      answer: cleanAnswer,
      reply:
        judgment.reply ||
        `${titleCase(cleanAnswer)} beats ${target}. Risk rewarded.`,
      nextPrompt: this.promptFor(player.currentPrompt),
      publicStatus: this.getWagerPublicStatus(match),
    };
  }

  async getPrompt(guildId, userId) {
    const user = this.store.getUser(guildId, userId);
    const match = this.store.getGuild(guildId).wagerMatch;
    const wagerPlayer = match?.players?.[userId];

    return {
      prompt: this.promptFor(user.current),
      current: user.current,
      chain: user.bestChain,
      runAnswers: user.runAnswers,
      rp: user.rp,
      rank: rankForRp(user.rp),
      wagerPrompt:
        match?.status === "active" && wagerPlayer?.alive
          ? this.promptFor(wagerPlayer.currentPrompt)
          : null,
      wagerStatus: match?.status ?? null,
    };
  }

  leaderboard(guildId, limit = 10) {
    const users = this.store.getUsers(guildId);
    const entries = Object.entries(users).map(([userId, user]) => {
      return {
        userId,
        rp: user.rp,
        rank: rankForRp(user.rp),
        chain: user.bestChain,
      };
    });

    const sorter = (a, b) => b.rp - a.rp || b.chain - a.chain;

    return entries.sort(sorter).slice(0, limit);
  }

  promptFor(thing) {
    return `What beats ${thing}?`;
  }

  failRun(user) {
    const previousChain = user.currentRunChain;
    const rpChange = -Math.min(LOSS_RP, user.rp);
    user.rp += rpChange;
    user.current = STARTING_PROMPT;
    user.currentRunChain = 0;
    user.runAnswers = [];

    return {
      previousChain,
      rp: user.rp,
      rpChange,
      rank: rankForRp(user.rp),
      nextPrompt: this.promptFor(user.current),
    };
  }

  listWagerPlayers(match) {
    return Object.entries(match.players).map(([userId, player]) => ({
      userId,
      bid: player.bid,
      alive: player.alive,
      chain: player.chain,
    }));
  }

  getWagerPublicStatus(match) {
    return {
      pot: match.pot,
      players: this.listWagerPlayers(match),
    };
  }

  async finishWagerMatchIfDone(guildId, match) {
    const aliveCount = Object.values(match.players).filter((player) => player.alive).length;
    if (aliveCount > 0) {
      await this.store.save();
      return null;
    }

    const standings = Object.entries(match.players)
      .map(([userId, player]) => ({
        userId,
        bid: player.bid,
        chain: player.chain,
      }))
      .sort((a, b) => b.chain - a.chain || a.userId.localeCompare(b.userId));

    const bestChain = standings[0]?.chain ?? 0;
    const winners = standings.filter((entry) => entry.chain === bestChain);
    const baseShare = winners.length > 0 ? Math.floor(match.pot / winners.length) : 0;
    let remainder = winners.length > 0 ? match.pot % winners.length : 0;

    const payouts = [];
    for (const winner of winners) {
      const payout = baseShare + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      const user = this.store.getUser(guildId, winner.userId);
      user.rp += payout;
      payouts.push({
        userId: winner.userId,
        payout,
      });
    }

    const guild = this.store.getGuild(guildId);
    guild.wagerMatch = null;
    await this.store.save();

    return {
      bestChain,
      winners: payouts,
      standings,
      pot: match.pot,
      split: winners.length > 1,
    };
  }
}

export function rankForRp(rp) {
  const safeRp = Math.max(0, Math.floor(rp));
  let rank = RANKS[0];
  let next = null;

  for (let index = 0; index < RANKS.length; index += 1) {
    if (safeRp >= RANKS[index].minRp) {
      rank = RANKS[index];
      next = RANKS[index + 1] || null;
    }
  }

  return {
    name: rank.name,
    minRp: rank.minRp,
    nextName: next?.name ?? null,
    nextMinRp: next?.minRp ?? null,
    rpToNext: next ? next.minRp - safeRp : 0,
  };
}

export function normalizeThing(value) {
  return value
    .trim()
    .replace(/^[.,!?;:"'()[\]{}]+|[.,!?;:"'()[\]{}]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(a|an|the)\s+/i, "")
    .slice(0, 80)
    .toLowerCase();
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rollSlotOutcome() {
  const roll = Math.random();

  if (roll < SLOT_ODDS.hugeWin) {
    return "hugeWin";
  }

  if (roll < SLOT_ODDS.hugeWin + SLOT_ODDS.smallWin) {
    return "smallWin";
  }

  return "lose";
}

function buildSlotReels(outcome) {
  if (outcome === "hugeWin") {
    const symbol = randomSlotSymbol();
    return [symbol, symbol, symbol];
  }

  if (outcome === "smallWin") {
    const matching = randomSlotSymbol();
    let other = randomSlotSymbol();
    while (other === matching) {
      other = randomSlotSymbol();
    }

    const reels = [matching, matching, other];
    return shuffle(reels);
  }

  let first = randomSlotSymbol();
  let second = randomSlotSymbol();
  let third = randomSlotSymbol();

  while (second === first) {
    second = randomSlotSymbol();
  }

  while (third === first || third === second) {
    third = randomSlotSymbol();
  }

  return [first, second, third];
}

function randomSlotSymbol() {
  return SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function createWagerPlayer(bid) {
  return {
    bid,
    alive: true,
    chain: 0,
    currentPrompt: null,
    runAnswers: [],
  };
}

export function getWagerJoinWindowMs() {
  return WAGER_JOIN_WINDOW_MS;
}
