import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE = {
  guilds: {},
  settings: {
    personalLoggerEnabled: false,
  },
};

export class GameStore {
  constructor(filePath = path.join(process.cwd(), "data", "game-state.json")) {
    this.filePath = filePath;
    this.state = structuredClone(DEFAULT_STATE);
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw);
      if (this.migrate()) {
        await this.save();
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await this.save();
    }
  }

  async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.writeQueue = this.writeQueue.then(() =>
      writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8"),
    );
    return this.writeQueue;
  }

  getSettings() {
    this.state.settings ??= { personalLoggerEnabled: false };
    if (typeof this.state.settings.personalLoggerEnabled !== "boolean") {
      this.state.settings.personalLoggerEnabled = false;
    }
    return this.state.settings;
  }

  getGuild(guildId) {
    this.state.guilds[guildId] ??= createGuildState();
    normalizeGuildState(this.state.guilds[guildId]);
    return this.state.guilds[guildId];
  }

  getUser(guildId, userId) {
    const guild = this.getGuild(guildId);
    guild.users[userId] ??= createUserState();
    normalizeUserState(guild.users[userId]);
    return guild.users[userId];
  }

  updateUserProfile(guildId, userId, profile = {}) {
    const user = this.getUser(guildId, userId);
    const nextProfile = {
      username: profile.username ?? user.profile.username,
      globalName: profile.globalName ?? user.profile.globalName,
      displayName: profile.displayName ?? user.profile.displayName,
    };

    const changed =
      user.profile.username !== nextProfile.username ||
      user.profile.globalName !== nextProfile.globalName ||
      user.profile.displayName !== nextProfile.displayName;

    if (changed) {
      user.profile = nextProfile;
    }

    return changed;
  }

  getUsers(guildId) {
    const users = this.getGuild(guildId).users;
    for (const user of Object.values(users)) {
      normalizeUserState(user);
    }
    return users;
  }

  deleteUser(guildId, userId) {
    const guild = this.getGuild(guildId);
    if (!(userId in guild.users)) {
      return false;
    }

    delete guild.users[userId];
    return true;
  }

  migrate() {
    let changed = false;
    this.state.settings ??= { personalLoggerEnabled: false };
    if (typeof this.state.settings.personalLoggerEnabled !== "boolean") {
      this.state.settings.personalLoggerEnabled = false;
      changed = true;
    }
    this.state.guilds ??= {};

    for (const guild of Object.values(this.state.guilds)) {
      changed = normalizeGuildState(guild) || changed;

      for (const user of Object.values(guild.users)) {
        changed = normalizeUserState(user) || changed;
      }
    }

    return changed;
  }
}

function createGuildState() {
  return {
    users: {},
    wagerMatch: null,
    settings: {
      dailyAnnouncementChannelId: null,
      lastDailyAnnouncementDate: null,
      rankRoleIds: {},
      logChannelId: null,
      logChannelEnabled: false,
    },
  };
}

function normalizeGuildState(guild) {
  let changed = false;

  guild.users ??= {};
  if (!("users" in guild)) {
    guild.users = {};
    changed = true;
  }

  if (!("wagerMatch" in guild)) {
    guild.wagerMatch = null;
    changed = true;
  }

  if (guild.wagerMatch) {
    changed = normalizeWagerMatch(guild.wagerMatch) || changed;
  }

  guild.settings ??= {};
  if (!("dailyAnnouncementChannelId" in guild.settings)) {
    guild.settings.dailyAnnouncementChannelId = null;
    changed = true;
  }

  if (!("lastDailyAnnouncementDate" in guild.settings)) {
    guild.settings.lastDailyAnnouncementDate = null;
    changed = true;
  }

  if (!guild.settings.rankRoleIds || typeof guild.settings.rankRoleIds !== "object") {
    guild.settings.rankRoleIds = {};
    changed = true;
  }

  if (!("logChannelId" in guild.settings)) {
    guild.settings.logChannelId = null;
    changed = true;
  }

  if (!("logChannelEnabled" in guild.settings) || typeof guild.settings.logChannelEnabled !== "boolean") {
    guild.settings.logChannelEnabled = false;
    changed = true;
  }

  return changed;
}

export function createUserState() {
  return {
    profile: {
      username: null,
      globalName: null,
      displayName: null,
    },
    current: "rock",
    currentRunChain: 0,
    bestChain: 0,
    runAnswers: [],
    rp: 0,
    daily: {
      date: null,
      attemptsUsed: 0,
      completedDate: null,
    },
    dailyStreak: {
      current: 0,
      best: 0,
      lastCompletedDate: null,
    },
    wager: {
      current: null,
      currentRunChain: 0,
      runAnswers: [],
    },
  };
}

function normalizeUserState(user) {
  const oldTotalValid = toNumber(user.totalValid);
  const legacyCurrentRunChain = toNumber(user.chain);
  const legacyBestChain = toNumber(user.highChain);
  const legacyDailyBestChain = toNumber(user?.daily?.bestChain);
  let changed = false;

  user.profile ??= {};
  if (!("username" in user.profile)) {
    user.profile.username = null;
    changed = true;
  }

  if (!("globalName" in user.profile)) {
    user.profile.globalName = null;
    changed = true;
  }

  if (!("displayName" in user.profile)) {
    user.profile.displayName = null;
    changed = true;
  }

  if (typeof user.current !== "string") {
    user.current = "rock";
    changed = true;
  }

  const currentRunChain = Math.max(0, toNumber(user.currentRunChain), legacyCurrentRunChain);
  if (user.currentRunChain !== currentRunChain) {
    user.currentRunChain = currentRunChain;
    changed = true;
  }

  const bestChain = Math.max(toNumber(user.bestChain), legacyBestChain, currentRunChain, legacyDailyBestChain);
  if (user.bestChain !== bestChain) {
    user.bestChain = bestChain;
    changed = true;
  }

  if ("chain" in user) {
    delete user.chain;
    changed = true;
  }

  if ("highChain" in user) {
    delete user.highChain;
    changed = true;
  }

  if (!Array.isArray(user.runAnswers)) {
    user.runAnswers = [];
    changed = true;
  }

  if (typeof user.rp !== "number") {
    user.rp = Math.max(0, oldTotalValid * 10);
    changed = true;
  }

  if ("totalValid" in user) {
    delete user.totalValid;
    changed = true;
  }

  user.daily ??= {};
  if (!("date" in user.daily)) {
    user.daily.date = null;
    changed = true;
  }

  const attemptsUsed = toNumber(user.daily.attemptsUsed);
  if (user.daily.attemptsUsed !== attemptsUsed) {
    user.daily.attemptsUsed = attemptsUsed;
    changed = true;
  }

  if ("wins" in user.daily || "currentChain" in user.daily || "bestChain" in user.daily) {
    delete user.daily.wins;
    delete user.daily.currentChain;
    delete user.daily.bestChain;
    changed = true;
  }

  if (!("completedDate" in user.daily)) {
    user.daily.completedDate = null;
    changed = true;
  }

  user.dailyStreak ??= {};
  const currentStreak = toNumber(user.dailyStreak.current);
  if (user.dailyStreak.current !== currentStreak) {
    user.dailyStreak.current = currentStreak;
    changed = true;
  }

  const bestStreak = toNumber(user.dailyStreak.best);
  if (user.dailyStreak.best !== bestStreak) {
    user.dailyStreak.best = bestStreak;
    changed = true;
  }

  if (!("lastCompletedDate" in user.dailyStreak)) {
    user.dailyStreak.lastCompletedDate = null;
    changed = true;
  }

  user.wager ??= {};
  if (typeof user.wager.current !== "string" && user.wager.current !== null) {
    user.wager.current = null;
    changed = true;
  }

  const wagerCurrentRunChain = Math.max(0, toNumber(user.wager.currentRunChain));
  if (user.wager.currentRunChain !== wagerCurrentRunChain) {
    user.wager.currentRunChain = wagerCurrentRunChain;
    changed = true;
  }

  if (!Array.isArray(user.wager.runAnswers)) {
    user.wager.runAnswers = [];
    changed = true;
  }

  return changed;
}

function normalizeWagerMatch(match) {
  let changed = false;

  if (typeof match.status !== "string") {
    match.status = "joining";
    changed = true;
  }

  if (typeof match.channelId !== "string") {
    match.channelId = null;
    changed = true;
  }

  if (typeof match.hostUserId !== "string") {
    match.hostUserId = null;
    changed = true;
  }

  if (!Number.isFinite(match.createdAt)) {
    match.createdAt = Date.now();
    changed = true;
  }

  if (!Number.isFinite(match.startsAt)) {
    match.startsAt = Date.now();
    changed = true;
  }

  if (typeof match.startingPrompt !== "string" && match.startingPrompt !== null) {
    match.startingPrompt = null;
    changed = true;
  }

  if (typeof match.statusMessageId !== "string" && match.statusMessageId !== null) {
    match.statusMessageId = null;
    changed = true;
  }

  if (!Number.isFinite(match.pot)) {
    match.pot = 0;
    changed = true;
  }

  if (!match.players || typeof match.players !== "object") {
    match.players = {};
    changed = true;
  }

  for (const player of Object.values(match.players)) {
    if (!Number.isFinite(player.bid)) {
      player.bid = 0;
      changed = true;
    }

    if (typeof player.alive !== "boolean") {
      player.alive = true;
      changed = true;
    }

    const chain = toNumber(player.chain);
    if (player.chain !== chain) {
      player.chain = chain;
      changed = true;
    }

    if (typeof player.currentPrompt !== "string" && player.currentPrompt !== null) {
      player.currentPrompt = null;
      changed = true;
    }

    if (!Array.isArray(player.runAnswers)) {
      player.runAnswers = [];
      changed = true;
    }
  }

  return changed;
}

function toNumber(value) {
  return Number.isFinite(value) ? value : 0;
}
