import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all bot commands and what they do."),

  new SlashCommandBuilder()
    .setName("ranks")
    .setDescription("Show all ranks and their RP requirements."),

  new SlashCommandBuilder()
    .setName("beat")
    .setDescription("Answer the current What Beats a Rock prompt.")
    .addStringOption((option) =>
      option
        .setName("answer")
        .setDescription("The thing that beats your current prompt.")
        .setRequired(true)
        .setMaxLength(80),
    ),

  new SlashCommandBuilder()
    .setName("wagercreate")
    .setDescription("Start a multiplayer wager match with your bid.")
    .addIntegerOption((option) =>
      option
        .setName("bid")
        .setDescription("How much RP you want to put into the wager match.")
        .setRequired(true)
        .setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("wagerjoin")
    .setDescription("Join the current multiplayer wager match.")
    .addIntegerOption((option) =>
      option
        .setName("bid")
        .setDescription("How much RP you want to put into the wager match.")
        .setRequired(true)
        .setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("wagerplay")
    .setDescription("Play your current answer in the multiplayer wager match.")
    .addStringOption((option) =>
      option
        .setName("answer")
        .setDescription("The thing that beats your current wager prompt.")
        .setRequired(true)
        .setMaxLength(80),
    ),

  new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Bet some RP on the slot machine.")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("How much RP you want to bet.")
        .setRequired(true)
        .setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("prompt")
    .setDescription("Show your current prompt."),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show your rank and chain high score."),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show player ranks and chain high scores."),

  new SlashCommandBuilder()
    .setName("testdm")
    .setDescription("Owner only: send a test DM from the bot."),

  new SlashCommandBuilder()
    .setName("setgamechannel")
    .setDescription("Admin only: choose the channel where the bot should be used.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel for bot gameplay.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("setlogchannel")
    .setDescription("Owner only: choose the text channel for server voice logs.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel where voice logs should be posted.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("setlogchannelon")
    .setDescription("Owner only: enable server voice logs in the configured log channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setlogchanneloff")
    .setDescription("Owner only: disable server voice logs.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setuprankroles")
    .setDescription("Admin only: create and sync rank roles for players.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((command) => command.toJSON());
