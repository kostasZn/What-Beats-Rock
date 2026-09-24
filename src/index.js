import "dotenv/config";
import { Client, EmbedBuilder, GatewayIntentBits, MessageFlags, Partials, PermissionFlagsBits } from "discord.js";
import { Game, RANKS, SLOT_SYMBOLS, rankForRp } from "./game.js";
import { Judge } from "./judge.js";
import { GameStore } from "./store.js";

const { DISCORD_TOKEN, OWNER_USER_ID } = process.env;

const RANK_COLORS = {
  Pebble: 0x9ca3af,
  Gravel: 0x78716c,
  Cobblestone: 0x64748b,
  Granite: 0x6b7280,
  Diamond: 0x38bdf8,
  Emerald: 0x22c55e,
  Obsidian: 0x111827,
  Rock: 0xf97316,
};

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is required.");
}

const store = new GameStore();
await store.load();

const game = new Game(store, new Judge());

let wagerProcessing = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
  void refreshWagerLobbyMessages();
  void processReadyWagerMatches();
  void syncConfiguredRankRoles();
  setInterval(() => {
    void refreshWagerLobbyMessages();
  }, 1_000);
  setInterval(() => {
    void processReadyWagerMatches();
  }, 1_000);
  setInterval(() => {
    void syncConfiguredRankRoles();
  }, 120_000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guildId) {
    return;
  }

  try {
    await syncUserProfile(interaction);

    if (!isAllowedGameChannel(interaction)) {
      await interaction.reply({
        embeds: [buildPanel(`Use the bot in <#${store.getGuild(interaction.guildId).settings.dailyAnnouncementChannelId}>.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === "beat") {
      await handleBeat(interaction);
      return;
    }

    if (interaction.commandName === "wagercreate") {
      await handleWagerCreate(interaction);
      return;
    }

    if (interaction.commandName === "wagerjoin") {
      await handleWagerJoin(interaction);
      return;
    }

    if (interaction.commandName === "wagerplay") {
      await handleWagerPlay(interaction);
      return;
    }

    if (interaction.commandName === "slots") {
      await handleSlots(interaction);
      return;
    }

    if (interaction.commandName === "help") {
      await handleHelp(interaction);
      return;
    }

    if (interaction.commandName === "ranks") {
      await handleRanks(interaction);
      return;
    }

    if (interaction.commandName === "prompt") {
      await handlePrompt(interaction);
      return;
    }

    if (interaction.commandName === "stats") {
      await handleStats(interaction);
      return;
    }

    if (interaction.commandName === "leaderboard") {
      await handleLeaderboard(interaction);
      return;
    }

    if (interaction.commandName === "testdm") {
      await handleTestDm(interaction);
      return;
    }

    if (interaction.commandName === "setgamechannel") {
      await handleSetGameChannel(interaction);
      return;
    }

    if (interaction.commandName === "setlogchannel") {
      await handleSetLogChannel(interaction);
      return;
    }

    if (interaction.commandName === "setlogchannelon") {
      await handleSetLogChannelOn(interaction);
      return;
    }

    if (interaction.commandName === "setlogchanneloff") {
      await handleSetLogChannelOff(interaction);
      return;
    }

    if (interaction.commandName === "setuprankroles") {
      await handleSetupRankRoles(interaction);
    }
  } catch (error) {
    console.error(error);

    const message = "Oops. The bot tripped over its own shoelaces. Try again in a moment.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [buildPanel(message)] });
    } else {
      await interaction.reply({ embeds: [buildPanel(message)], flags: MessageFlags.Ephemeral });
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.guild) {
    return;
  }

  if (!OWNER_USER_ID) {
    await message.reply("Personal logger is not configured yet. `OWNER_USER_ID` is missing on the bot.");
    return;
  }

  if (message.author.id !== OWNER_USER_ID) {
    await message.reply("These DM logger commands only work for the configured owner.");
    return;
  }

  const command = message.content.trim().toLowerCase();
  if (command !== "personallogger on" && command !== "personallogger off") {
    await message.reply("I got your DM, but I only understand `personalLogger on` and `personalLogger off` here.");
    return;
  }

  const settings = store.getSettings();
  settings.personalLoggerEnabled = command === "personallogger on";
  await store.save();

  await message.reply(
    settings.personalLoggerEnabled
      ? "Personal logger is now on. I’ll DM you voice activity from every server I can see."
      : "Personal logger is now off. I’ll stop DMing you voice activity.",
  );
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const events = buildVoiceLogEvents(oldState, newState);
    if (events.length === 0) {
      return;
    }

    for (const text of events) {
      await dispatchVoiceLog(newState.guild, text);
    }
  } catch (error) {
    console.error("Failed to process voice log event:", error);
  }
});

async function handleBeat(interaction) {
  const answer = interaction.options.getString("answer", true);
  await interaction.deferReply();

  const result = await game.beat({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    answer,
  });

  if (!result.valid) {
    if (result.duplicate) {
      await interaction.editReply({
        embeds: [buildPanel([
          `*${result.reply}*`,
          `Still up: **${result.nextPrompt}**`,
        ].join("\n"))],
      });
      return;
    }

    await syncRankRoleForInteraction(interaction, result.rank);

    await interaction.editReply({
      embeds: [buildPanel([
        `You played: **${result.answer}**`,
        `*${result.reply}*`,
        `Run ended at **${result.previousChain}**. **${formatRpChange(result.rpChange)}**. Current rank: **${formatRank(result.rank, result.rp)}**.`,
        `Back to the beginning: **${result.nextPrompt}**`,
      ].join("\n"))],
    });
    return;
  }

  await syncRankRoleForInteraction(interaction, result.rank);

  await interaction.editReply({
    embeds: [buildPanel([
      `You played: **${result.answer}**`,
      `*${result.reply}*`,
      `Chain: **${result.chain}**. **${formatRpChange(result.rpChange)}**. Current rank: **${formatRank(result.rank, result.rp)}**.`,
      `Next: **${result.nextPrompt}**`,
    ].join("\n"))],
  });
}

async function handleWagerCreate(interaction) {
  const bid = interaction.options.getInteger("bid", true);
  const result = await game.createWagerMatch({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    bid,
  });

  if (!result.ok) {
    await interaction.reply({
      embeds: [buildPanel(result.message)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await syncRankRoleForInteraction(interaction, result.rank);

  await upsertWagerStatusMessage(
    interaction.guildId,
    interaction.channel,
    buildJoiningWagerStatusText({
      latest: "🔥 **Wager Match Created**",
      hostUserId: interaction.user.id,
      players: result.players,
      pot: result.pot,
      startsAt: result.startsAt,
    }),
  );

  await interaction.reply({
    embeds: [buildPanel(`You are in. Your bid is locked at **${result.bid} RP**.`)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleWagerJoin(interaction) {
  const bid = interaction.options.getInteger("bid", true);
  const result = await game.joinWagerMatch({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    bid,
  });

  if (!result.ok) {
    await interaction.reply({
      embeds: [buildPanel(result.message)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await syncRankRoleForInteraction(interaction, result.rank);

  await upsertWagerStatusMessage(
    interaction.guildId,
    interaction.channel,
    buildJoiningWagerStatusText({
      latest: `🔥 <@${interaction.user.id}> joined the wager.`,
      hostUserId: store.getGuild(interaction.guildId).wagerMatch?.hostUserId ?? null,
      players: result.players,
      pot: result.pot,
      startsAt: result.startsAt,
    }),
  );

  await interaction.reply({
    embeds: [buildPanel(`You joined the wager with **${result.bid} RP**.`)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleWagerPlay(interaction) {
  const answer = interaction.options.getString("answer", true);
  const wagerStatusMessageId = store.getGuild(interaction.guildId).wagerMatch?.statusMessageId ?? null;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await game.playWager({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    answer,
  });

  if (!result.ok) {
    await interaction.editReply({
      embeds: [buildPanel(result.message)],
    });
    return;
  }

  if (result.duplicate) {
    await interaction.editReply({
      embeds: [buildPanel([
        `You played: **${result.answer}**`,
        `*${result.reply}*`,
        `Still up: **${result.nextPrompt}**`,
      ].join("\n"))],
    });
    return;
  }

  if (result.valid) {
    await interaction.editReply({
      embeds: [buildPanel([
        `You played: **${result.answer}**`,
        `*${result.reply}*`,
        `Wager chain: **${result.chain}**`,
        `Next wager prompt: **${result.nextPrompt}**`,
      ].join("\n"))],
    });

    await upsertWagerStatusMessage(
      interaction.guildId,
      interaction.channel,
      buildLiveWagerStatusText(interaction.guildId, {
        latest: `🔥 <@${interaction.user.id}> is still alive. Chain: **${result.chain}**`,
        publicStatus: result.publicStatus,
      }),
    );
    return;
  }

  await interaction.editReply({
    embeds: [buildPanel([
      `You played: **${result.answer}**`,
      `*${result.reply}*`,
      `You are out at **${result.previousChain}**.`,
    ].join("\n"))],
  });

  if (result.result) {
    for (const winner of result.result.winners) {
      await syncRankRoleForUserId(interaction.guild, interaction.guildId, winner.userId);
    }

    await upsertWagerStatusMessage(
      interaction.guildId,
      interaction.channel,
      buildWagerResults(result.result),
      {
        allowCreate: false,
        messageId: wagerStatusMessageId,
      },
    );
    return;
  }

  await upsertWagerStatusMessage(
    interaction.guildId,
    interaction.channel,
    buildLiveWagerStatusText(interaction.guildId, {
      latest: `🔥 <@${interaction.user.id}> is out.`,
      publicStatus: result.publicStatus,
    }),
  );
}

async function handleSlots(interaction) {
  const amount = interaction.options.getInteger("amount", true);
  await interaction.deferReply();

  const result = await game.slots({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    amount,
  });

  if (!result.ok) {
    await interaction.editReply({
      embeds: [buildPanel([
        "🎰 **Slots**",
        result.message,
        `Current rank: **${formatRank(result.rank, result.rp)}**.`,
      ].join("\n"))],
    });
    return;
  }

  const suspenseReels = slotPlaceholderReels();
  await interaction.editReply({
    embeds: [buildPanel([
      "🎰 **Slots**",
      `Bet: **${amount} RP**`,
      formatSlotReels(suspenseReels),
      "*Spinning...*",
    ].join("\n"))],
  });

  await wait(1400);
  await interaction.editReply({
    embeds: [buildPanel([
      "🎰 **Slots**",
      `Bet: **${amount} RP**`,
      formatSlotReels([result.reels[0], suspenseReels[1], suspenseReels[2]]),
      "*Here we go...*",
    ].join("\n"))],
  });

  await wait(1700);
  await interaction.editReply({
    embeds: [buildPanel([
      "🎰 **Slots**",
      `Bet: **${amount} RP**`,
      formatSlotReels([result.reels[0], result.reels[1], suspenseReels[2]]),
      "*Wait for it...*",
    ].join("\n"))],
  });

  await wait(2100);
  await syncRankRoleForInteraction(interaction, result.rank);

  await interaction.editReply({
    embeds: [buildPanel([
      "🎰 **Slots**",
      formatSlotReels(result.reels),
      slotOutcomeLine(result),
      `${formatRpChange(result.rpChange)}.`,
      `Current rank: **${formatRank(result.rank, result.rp)}**.`,
    ].join("\n"))],
  });
}

async function handlePrompt(interaction) {
  const status = await game.getPrompt(interaction.guildId, interaction.user.id);
  const lines = [`Current prompt: **${status.prompt}**`];

  if (status.wagerPrompt) {
    lines.push(`Wager prompt: **${status.wagerPrompt}**`);
  }

  await interaction.reply({
    embeds: [buildPanel(lines.join("\n"))],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHelp(interaction) {
  await interaction.reply({
    embeds: [buildPanel([
      "**What Beats a Rock Commands**",
      "`/ranks` Show all ranks and their RP requirements.",
      "`/beat answer:<thing>` Submit your answer for the current prompt.",
      "`/wagercreate bid:<rp>` Start a multiplayer wager match.",
      "`/wagerjoin bid:<rp>` Join the current wager match.",
      "`/wagerplay answer:<thing>` Play your current wager prompt.",
      "`/slots amount:<rp>` Bet some RP on the slot machine.",
      "`/prompt` Show your current prompt.",
      "`/stats` Show your rank and chain high score.",
      "`/leaderboard` Show the server leaderboard.",
      "`/testdm` Owner only. Send yourself a test DM from the bot.",
      "`/setgamechannel channel:#name` Owner/admin only. Lock gameplay to one channel.",
      "`/setlogchannel channel:#name` Owner only. Choose the voice log channel for this server.",
      "`/setlogchannelon` Owner only. Turn server voice logging on.",
      "`/setlogchanneloff` Owner only. Turn server voice logging off.",
    ].join("\n"))],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRanks(interaction) {
  await interaction.reply({
    embeds: [buildPanel([
      "**What Beats a Rock Ranks**",
      introRankList(),
    ].join("\n"))],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStats(interaction) {
  const status = await game.getPrompt(interaction.guildId, interaction.user.id);

  await interaction.reply({
    embeds: [buildPanel([
      `⛓️ Personal chain high score: **${status.chain}**.`,
      `Rank: **${formatRank(status.rank, status.rp)}**.`,
      nextRankLine(status.rank, { showRpToNext: false }),
    ].join("\n"))],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLeaderboard(interaction) {
  await pruneMissingStoredPlayers(interaction.guild, interaction.guildId);
  const entries = game.leaderboard(interaction.guildId);

  if (entries.length === 0) {
    await interaction.reply({ embeds: [buildPanel("🪨 Nobody has scored yet. The rock remains undefeated.")] });
    return;
  }

  const lines = entries.map((entry, index) => {
    return [
      `**${index + 1}.** <@${entry.userId}>`,
      `Rank: **${formatRank(entry.rank, entry.rp)}**`,
      `Chain high score: **${entry.chain}**`,
    ].join(" - ");
  });

  const embed = new EmbedBuilder()
    .setTitle("🪨 What Beats a Rock Leaderboard")
    .setDescription(lines.join("\n"))
    .setColor(0x2b2d31);

  await interaction.reply({ embeds: [embed] });
}

async function handleTestDm(interaction) {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      embeds: [buildPanel("Only the configured owner can use this command.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!OWNER_USER_ID) {
    await interaction.reply({
      embeds: [buildPanel("OWNER_USER_ID is missing on the running bot.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const owner = await client.users.fetch(OWNER_USER_ID);
    await owner.send("DM successful. The bot can reach you here.");
    await interaction.reply({
      embeds: [buildPanel("I sent you a test DM.")],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.warn("Failed to send test DM:", shortDiscordError(error));
    await interaction.reply({
      embeds: [buildPanel("I could not send you a DM. Check that the owner ID is correct and that the bot can message you.")],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleSetGameChannel(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      embeds: [buildPanel("You need the Administrator permission to use this command.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  const guild = store.getGuild(interaction.guildId);
  guild.settings.dailyAnnouncementChannelId = channel.id;
  await store.save();

  if (channel.isTextBased()) {
    await channel.send({ embeds: [buildPanel(buildIntroMessage())] });
  }

  await interaction.reply({
    embeds: [buildPanel(`Game commands will use <#${channel.id}>.`)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetLogChannel(interaction) {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      embeds: [buildPanel("Only the configured owner can manage the logger.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  const guild = store.getGuild(interaction.guildId);
  guild.settings.logChannelId = channel.id;
  await store.save();

  await interaction.reply({
    embeds: [buildPanel(`Voice logs will use <#${channel.id}> when server logging is on.`)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetLogChannelOn(interaction) {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      embeds: [buildPanel("Only the configured owner can manage the logger.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = store.getGuild(interaction.guildId);
  if (!guild.settings.logChannelId) {
    await interaction.reply({
      embeds: [buildPanel("Set a log channel first with `/setlogchannel channel:#name`.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  guild.settings.logChannelEnabled = true;
  await store.save();

  await interaction.reply({
    embeds: [buildPanel(`Server voice logging is now on in <#${guild.settings.logChannelId}>.`)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetLogChannelOff(interaction) {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      embeds: [buildPanel("Only the configured owner can manage the logger.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = store.getGuild(interaction.guildId);
  guild.settings.logChannelEnabled = false;
  await store.save();

  await interaction.reply({
    embeds: [buildPanel("Server voice logging is now off.")],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetupRankRoles(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      embeds: [buildPanel("🛡️ You need the Administrator permission to use this command.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.editReply({
      embeds: [buildPanel("I need the Manage Roles permission before I can create or assign rank roles.")],
    });
    return;
  }

  const setup = await ensureRankRoles(interaction.guild, interaction.guildId);
  const sync = await syncStoredPlayersRankRoles(interaction.guild, interaction.guildId);

  await interaction.editReply({
    embeds: [buildPanel([
      "Rank roles are ready.",
      `Created: **${setup.created}**. Reused: **${setup.reused}**.`,
      `Synced players: **${sync.synced}**. Removed old players: **${sync.removed}**. Failed: **${sync.failed}**.`,
      "If any syncs failed, make sure I have Manage Roles, my bot role is above the rank roles, and I am not below the target user's highest role.",
    ].join("\n"))],
  });
}

function buildPanel(description) {
  return new EmbedBuilder()
    .setDescription(description)
    .setColor(0x2b2d31);
}

function randomDistinctSlotReels() {
  const reels = [];
  while (reels.length < 3) {
    const symbol = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
    if (!reels.includes(symbol)) {
      reels.push(symbol);
    }
  }
  return reels;
}

function slotPlaceholderReels() {
  return ["🔴", "🔴", "🔴"];
}

function formatSlotReels(reels) {
  return `**[ ${reels.join(" | ")} ]**`;
}

function slotOutcomeLine(result) {
  if (result.resultType === "hugeWin") {
    return "Huge win bonus!!!";
  }

  if (result.resultType === "smallWin") {
    return "Small win bonus.";
  }

  return "No match. Better luck next spin.";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plural(count) {
  return count === 1 ? "" : "s";
}

function nextRankLine(rank, options = {}) {
  if (!rank.nextName) {
    return "👑 Top rank reached. The rock council is watching.";
  }

  const base = `Next rank: **${formatRank(rank.nextName, rank.nextMinRp)}**`;
  if (options.showRpToNext === false) {
    return `${base}.`;
  }

  return `${base} in **${rank.rpToNext} RP**.`;
}

function formatRpChange(rpChange) {
  if (rpChange > 0) {
    return `+${rpChange} RP`;
  }

  if (rpChange < 0) {
    return `${rpChange} RP`;
  }

  return "0 RP";
}

async function syncUserProfile(interaction) {
  const changed = store.updateUserProfile(interaction.guildId, interaction.user.id, {
    username: interaction.user.username,
    globalName: interaction.user.globalName,
    displayName: interaction.member?.displayName ?? null,
  });

  if (changed) {
    await store.save();
  }
}

async function processReadyWagerMatches() {
  if (wagerProcessing) {
    return;
  }

  wagerProcessing = true;

  try {
    const events = await game.processReadyWagerMatches();

    for (const event of events) {
      try {
        const channel = await client.channels.fetch(event.channelId);
        if (!channel?.isTextBased()) {
          continue;
        }

        if (event.type === "cancelled") {
          await upsertWagerStatusMessage(
            event.guildId,
            channel,
            "🔥 Wager match cancelled. Not enough players joined, so all bids were refunded.",
            {
              allowCreate: false,
              messageId: event.statusMessageId ?? null,
            },
          );
          continue;
        }

        if (event.type === "started") {
          await upsertWagerStatusMessage(
            event.guildId,
            channel,
            buildLiveWagerStatusText(event.guildId, {
              latest: "🔥 **Wager Match Started**",
              publicStatus: {
                pot: event.pot,
                players: event.players,
              },
            }),
            { allowCreate: true },
          );
        }
      } catch (error) {
        console.error(`Failed to process wager match event for guild ${event.guildId}:`, error);
      }
    }
  } finally {
    wagerProcessing = false;
  }
}

async function refreshWagerLobbyMessages() {
  for (const [guildId, guildState] of Object.entries(store.state.guilds)) {
    const match = guildState.wagerMatch;
    if (!match || match.status !== "joining" || !match.channelId) {
      continue;
    }

    try {
      const channel = await client.channels.fetch(match.channelId);
      if (!channel?.isTextBased()) {
        continue;
      }

      await upsertWagerStatusMessage(
        guildId,
        channel,
        buildJoiningWagerStatusText({
          latest: "🔥 **Wager Match Forming**",
          hostUserId: match.hostUserId,
          players: game.listWagerPlayers(match),
          pot: match.pot,
          startsAt: match.startsAt,
        }),
      );
    } catch (error) {
      console.warn(`Failed to refresh wager lobby for guild ${guildId}:`, shortDiscordError(error));
    }
  }
}

async function syncConfiguredRankRoles() {
  for (const [guildId, guildState] of Object.entries(store.state.guilds)) {
    if (!hasConfiguredRankRoles(guildState)) {
      continue;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.members.fetchMe();
      await syncStoredPlayersRankRoles(guild, guildId);
    } catch (error) {
      console.warn(`Failed background rank sync for guild ${guildId}:`, shortDiscordError(error));
    }
  }
}

function buildIntroMessage() {
  return [
    "Hi:D I am basically a What Beats Rock game but with a ranked system and yes it has gambling. What Beats Rock is a game where you try to come up with things that can beat the previous thing. For example, paper beats rock, scissors beat paper.",
    "Each correct answer gives you RP (Rock Points) and moves you up the ranks. Each wrong answer resets your chain and will lose you RP.",
    "Use `/help` to see all commands.",
  ].join("\n");
}

function isAllowedGameChannel(interaction) {
  if (
    interaction.commandName === "help" ||
    interaction.commandName === "ranks" ||
    interaction.commandName === "testdm" ||
    interaction.commandName === "setgamechannel" ||
    interaction.commandName === "setlogchannel" ||
    interaction.commandName === "setlogchannelon" ||
    interaction.commandName === "setlogchanneloff" ||
    interaction.commandName === "setuprankroles"
  ) {
    return true;
  }

  const configuredChannelId = store.getGuild(interaction.guildId).settings.dailyAnnouncementChannelId;
  if (!configuredChannelId) {
    return true;
  }

  return interaction.channelId === configuredChannelId;
}

function formatRank(rank, rpOverride) {
  const name = typeof rank === "string" ? rank : rank.name;
  const rp = rpOverride ?? (typeof rank === "string" ? null : rank.rp ?? null);
  return `${rankEmoji(name)} ${name}${typeof rp === "number" ? ` (${rp} RP)` : ""}`;
}

function introRankList() {
  return RANKS
    .map((rank) => `\`${formatRank(rank.name, rank.minRp)}\``)
    .join(", ");
}

function rankRoleName(rankName) {
  return formatRank(rankName);
}

function rankEmoji(name) {
  switch (name) {
    case "Pebble":
      return "🪙";
    case "Gravel":
      return "🪨";
    case "Cobblestone":
      return "🧱";
    case "Granite":
      return "⛰️";
    case "Diamond":
      return "💎";
    case "Emerald":
      return "💚";
    case "Obsidian":
      return "🌑";
    case "Rock":
      return "☄️";
    default:
      return "⭐";
  }
}

function formatWagerPlayers(players) {
  return players
    .map((player) => `<@${player.userId}> (${player.bid} RP)`)
    .join(", ");
}

function formatPublicWagerStatus(status) {
  const alive = status.players.filter((player) => player.alive);
  const out = status.players.filter((player) => !player.alive);

  return [
    `Bid total: **${status.pot} RP**`,
    `Alive: ${alive.length > 0 ? alive.map((player) => `<@${player.userId}> (${player.chain})`).join(", ") : "nobody"}`,
    `Out: ${out.length > 0 ? out.map((player) => `<@${player.userId}> (${player.chain})`).join(", ") : "nobody"}`,
  ].join("\n");
}

function buildJoiningWagerStatusText({ latest, hostUserId, players, pot, startsAt }) {
  const countdown = secondsUntil(startsAt);
  return [
    latest,
    hostUserId ? `Host: <@${hostUserId}>` : null,
    `Bid total: **${pot} RP**`,
    `Starts in: **${countdown}** second${plural(countdown)}`,
    `Players: ${formatWagerPlayers(players)}`,
    "Use `/wagerjoin bid:<rp>` to enter.",
  ].filter(Boolean).join("\n");
}

function buildLiveWagerStatusText(guildId, { latest, publicStatus }) {
  const match = store.getGuild(guildId).wagerMatch;
  const lines = [latest];

  if (match?.startingPrompt) {
    lines.push(`Starting prompt: **${game.promptFor(match.startingPrompt)}**`);
  }

  lines.push(formatPublicWagerStatus(publicStatus));
  lines.push("Use `/wagerplay answer:<thing>` to play your private prompt.");
  return lines.join("\n");
}

function buildWagerResults(result) {
  const winnerText = result.winners
    .map((winner) => `<@${winner.userId}> (+${winner.payout} RP)`)
    .join(", ");
  const standings = result.standings
    .map((entry, index) => `**${index + 1}.** <@${entry.userId}> - Chain **${entry.chain}** - Bid **${entry.bid} RP**`)
    .join("\n");

  return [
    "🔥 **Wager Match Finished**",
    `Bid total: **${result.pot} RP**`,
    result.split ? `Tie split winners: ${winnerText}` : `Winner: ${winnerText}`,
    "",
    standings,
  ].join("\n");
}

async function upsertWagerStatusMessage(guildId, channel, description, options = {}) {
  const match = store.getGuild(guildId).wagerMatch;
  const messageId = options.messageId ?? match?.statusMessageId ?? null;

  if (!match && !messageId && options.allowCreate === false) {
    return;
  }

  if (messageId) {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.edit({ embeds: [buildPanel(description)] });
      return;
    } catch (error) {
      if (!isMissingMessageError(error)) {
        throw error;
      }
    }
  }

  if (options.allowCreate === false) {
    return;
  }

  const message = await channel.send({ embeds: [buildPanel(description)] });
  if (match) {
    match.statusMessageId = message.id;
    await store.save();
  }
}

async function ensureRankRoles(discordGuild, guildId) {
  const guild = store.getGuild(guildId);
  guild.settings.rankRoleIds ??= {};
  await discordGuild.roles.fetch();

  let created = 0;
  let reused = 0;

  for (const rank of RANKS) {
    const roleName = rankRoleName(rank.name);
    const savedId = guild.settings.rankRoleIds[rank.name];
    let role = savedId ? discordGuild.roles.cache.get(savedId) : null;

    if (!role) {
      role = discordGuild.roles.cache.find((candidate) => candidate.name === roleName) ??
        discordGuild.roles.cache.find((candidate) => candidate.name === rank.name);
    }

    if (role) {
      reused += 1;
    } else {
      role = await discordGuild.roles.create({
        name: roleName,
        colors: {
          primaryColor: RANK_COLORS[rank.name] ?? 0x99aab5,
        },
        reason: "What Beats a Rock rank role setup",
      });
      created += 1;
    }

    guild.settings.rankRoleIds[rank.name] = role.id;
  }

  await store.save();
  return { created, reused };
}

async function syncRankRoleForInteraction(interaction, rank) {
  await syncRankRoleForUserId(interaction.guild, interaction.guildId, interaction.user.id, rank);
}

async function syncRankRoleForUserId(guildObject, guildId, userId, rankOverride = null) {
  try {
    const guild = store.getGuild(guildId);
    if (!hasConfiguredRankRoles(guild)) {
      return;
    }

    const member = await guildObject.members.fetch(userId);
    const rank = rankOverride ?? rankForRp(store.getUser(guildId, userId).rp);
    await syncMemberRankRole(member, guild.settings.rankRoleIds, rank.name);
  } catch (error) {
    if (isMissingRoleError(error)) {
      clearRankRoleIds(guildId);
      await store.save();
      console.warn("A saved rank role no longer exists. Cleared rank role setup. Run /setuprankroles again.");
      return;
    }

    if (isMissingPermissionsError(error)) {
      console.warn(`Could not sync rank role for user ${userId}. Check Manage Roles, role order, and whether the user is above the bot.`);
      return;
    }

    if (!isMissingMemberError(error)) {
      console.warn(`Failed to sync rank role for user ${userId}:`, shortDiscordError(error));
    }
  }
}

async function syncStoredPlayersRankRoles(discordGuild, guildId) {
  const guild = store.getGuild(guildId);
  const users = store.getUsers(guildId);
  const roleIds = guild.settings.rankRoleIds ?? {};
  const results = {
    synced: 0,
    removed: 0,
    failed: 0,
  };
  let changed = false;

  for (const [userId, user] of Object.entries(users)) {
    if (isBotUserId(userId)) {
      if (store.deleteUser(guildId, userId)) {
        changed = true;
      }
      results.removed += 1;
      continue;
    }

    try {
      const member = await discordGuild.members.fetch(userId);
      const rank = rankForRp(user.rp);
      await syncMemberRankRole(member, roleIds, rank.name);
      results.synced += 1;
    } catch (error) {
      if (isMissingMemberError(error)) {
        if (store.deleteUser(guildId, userId)) {
          changed = true;
        }
        results.removed += 1;
      } else if (isMissingRoleError(error)) {
        clearRankRoleIds(guildId);
        changed = true;
        results.failed += 1;
        console.warn("A saved rank role no longer exists. Cleared rank role setup. Run /setuprankroles again.");
        break;
      } else if (isMissingPermissionsError(error)) {
        results.failed += 1;
        console.warn(`Could not sync rank role for stored user ${userId}. Check Manage Roles, role order, and whether the user is above the bot.`);
      } else {
        results.failed += 1;
        console.warn(`Failed to sync rank role for stored user ${userId}:`, shortDiscordError(error));
      }
    }
  }

  if (changed) {
    await store.save();
  }

  return results;
}

async function pruneMissingStoredPlayers(discordGuild, guildId) {
  const users = store.getUsers(guildId);
  let changed = false;

  for (const userId of Object.keys(users)) {
    if (isBotUserId(userId)) {
      if (store.deleteUser(guildId, userId)) {
        changed = true;
      }
      continue;
    }

    try {
      await discordGuild.members.fetch(userId);
    } catch (error) {
      if (isMissingMemberError(error) && store.deleteUser(guildId, userId)) {
        changed = true;
      }
    }
  }

  if (changed) {
    await store.save();
  }
}

function isBotUserId(userId) {
  return userId === client.user?.id;
}

async function syncMemberRankRole(member, rankRoleIds, rankName) {
  const targetRoleId = rankRoleIds[rankName];
  if (!targetRoleId) {
    return;
  }

  const allRankRoleIds = Object.values(rankRoleIds).filter(Boolean);
  const rolesToRemove = allRankRoleIds.filter((roleId) =>
    roleId !== targetRoleId && member.roles.cache.has(roleId),
  );

  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove, "What Beats a Rock rank update");
  }

  if (!member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId, "What Beats a Rock rank update");
  }
}

function hasConfiguredRankRoles(guild) {
  return RANKS.every((rank) => guild.settings.rankRoleIds?.[rank.name]);
}

function isMissingMemberError(error) {
  return error?.code === 10007;
}

function isMissingMessageError(error) {
  return error?.code === 10008;
}

function isMissingRoleError(error) {
  return error?.code === 10011;
}

function isMissingPermissionsError(error) {
  return error?.code === 50013;
}

function clearRankRoleIds(guildId) {
  const guild = store.getGuild(guildId);
  guild.settings.rankRoleIds = {};
}

function shortDiscordError(error) {
  return error?.message || String(error);
}

function secondsUntil(timestamp) {
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function isOwner(userId) {
  return Boolean(OWNER_USER_ID) && userId === OWNER_USER_ID;
}

function buildVoiceLogEvents(oldState, newState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user?.bot) {
    return [];
  }

  const logs = [];
  const name = member.displayName ?? member.user.username;
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const stayedInVoice = Boolean(oldChannel && newChannel);
  const time = `<t:${Math.floor(Date.now() / 1000)}:T>`;

  if (oldChannel && !newChannel && oldState.streaming) {
    logs.push(`${name} stopped streaming at ${time}.`);
  }

  if (!oldChannel && newChannel) {
    logs.push(`${name} joined **${newChannel.name}** at ${time}.`);
  } else if (oldChannel && !newChannel) {
    logs.push(`${name} left **${oldChannel.name}** at ${time}.`);
  } else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
    logs.push(`${name} moved from **${oldChannel.name}** to **${newChannel.name}** at ${time}.`);
  }

  if (stayedInVoice && oldState.selfMute !== newState.selfMute) {
    logs.push(`${name} ${newState.selfMute ? "muted" : "unmuted"} themselves at ${time}.`);
  }
  if (stayedInVoice && oldState.selfDeaf !== newState.selfDeaf) {
    logs.push(`${name} ${newState.selfDeaf ? "deafened" : "undeafened"} themselves at ${time}.`);
  }
  if (stayedInVoice && oldState.serverMute !== newState.serverMute) {
    logs.push(`${name} was ${newState.serverMute ? "server muted" : "server unmuted"} at ${time}.`);
  }
  if (stayedInVoice && oldState.serverDeaf !== newState.serverDeaf) {
    logs.push(`${name} was ${newState.serverDeaf ? "server deafened" : "server undeafened"} at ${time}.`);
  }
  if (stayedInVoice && oldState.streaming !== newState.streaming) {
    logs.push(`${name} ${newState.streaming ? "started streaming" : "stopped streaming"} at ${time}.`);
  }

  return logs;
}

async function dispatchVoiceLog(guild, text) {
  const settings = store.getSettings();
  const guildState = store.getGuild(guild.id);
  const sends = [];

  if (settings.personalLoggerEnabled && OWNER_USER_ID) {
    try {
      const owner = await client.users.fetch(OWNER_USER_ID);
      sends.push(owner.send(text));
    } catch (error) {
      console.warn("Failed to DM personal logger event:", shortDiscordError(error));
    }
  }

  if (guildState.settings.logChannelEnabled && guildState.settings.logChannelId) {
    try {
      const channel = await client.channels.fetch(guildState.settings.logChannelId);
      if (channel?.isTextBased()) {
        sends.push(channel.send({ embeds: [buildPanel(text)] }));
      }
    } catch (error) {
      console.warn(`Failed to send server logger event for guild ${guild.id}:`, shortDiscordError(error));
    }
  }

  if (sends.length > 0) {
    await Promise.allSettled(sends);
  }
}

client.login(DISCORD_TOKEN);
