import OpenAI from "openai";
import { normalizeThing } from "./game.js";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

export class Judge {
  constructor() {
    this.openai = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
  }

  async judge({ target, answer }) {
    const cleanAnswer = normalizeThing(answer);
    const cleanTarget = normalizeThing(target);

    if (!cleanAnswer) {
      return {
        valid: false,
        canonicalAnswer: cleanAnswer,
        reply: "Nothing beats silence here. Give me an actual thing.",
      };
    }

    if (!this.openai) {
      return fallbackJudge(target, cleanAnswer, {
        exactRepeat: cleanAnswer === cleanTarget,
      });
    }

    try {
      return await this.openAiJudge(target, cleanAnswer, {
        guaranteedValid: isGuaranteedWin(target, cleanAnswer),
        exactRepeat: cleanAnswer === cleanTarget,
      });
    } catch (error) {
      console.error(`OpenAI judge failed, using fallback judge: ${describeOpenAiError(error)}`);
      return fallbackJudge(target, cleanAnswer, {
        exactRepeat: cleanAnswer === cleanTarget,
      });
    }
  }

  async generateWagerPrompt() {
    if (!this.openai) {
      return fallbackWagerPrompt();
    }

    try {
      const response = await this.openai.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content:
              "You generate starting prompts for a Discord game called What Beats a Rock. Return one fun, concrete, beatable thing as a short noun phrase. Keep it lowercase, 1 word, no article, no punctuation, no explanation, no JSON beyond the requested shape. Avoid abstract concepts and avoid unbeatable answers.",
          },
          {
            role: "user",
            content: JSON.stringify({
              requiredJsonShape: {
                prompt: "short lowercase noun phrase, 1 word, no article",
              },
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "wager_prompt",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["prompt"],
              properties: {
                prompt: { type: "string" },
              },
            },
          },
        },
      });

      const parsed = JSON.parse(response.output_text);
      return normalizeThing(parsed.prompt || "") || fallbackWagerPrompt();
    } catch (error) {
      console.error(`OpenAI wager prompt generation failed, using fallback prompt: ${describeOpenAiError(error)}`);
      return fallbackWagerPrompt();
    }
  }

  async openAiJudge(target, answer, options = {}) {
    const instruction = buildInstruction(options);

    const response = await this.openai.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content:
            "You judge a Discord game called What Beats a Rock. Be generous, playful and cheese/caustic. In ambiguous cases, prefer valid over invalid and make it funny and cheesy. Accept anything that could plausibly beat, disable, counter, avoid, trap, outlast, outsmart, overpower, or render the target useless in the game sense. Do not require perfect realism. Only reject answers that are obvious nonsense, exact repeats, completely unrelated, circular, or clearly weaker than the target. Classic examples such as paper beating rock, scissors beating paper, rock beating scissors, water beating fire, eraser beating pencil, whiteout beating pen, and gun beating human are always valid. Keep replies cheesy, witty, and short, like a smug game host. Do not use dashes, hyphens, or em dashes as punctuation in the reply. Prefer plain sentences. Dangerous things can be valid game counters, but replies must stay non-graphic and must never give real-world harm instructions. Return only compact JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            target,
            answer,
            guaranteedValid: options.guaranteedValid,
            exactRepeat: options.exactRepeat,
            instruction,
            requiredJsonShape: {
              valid: "boolean",
              canonicalAnswer: "short normalized noun phrase, no article",
              reply: "one cheesy playful sentence, under 140 characters",
            },
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "beat_judgment",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["valid", "canonicalAnswer", "reply"],
            properties: {
              valid: { type: "boolean" },
              canonicalAnswer: { type: "string" },
              reply: { type: "string" },
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text);
    return {
      valid: options.guaranteedValid ? true : options.exactRepeat ? false : Boolean(parsed.valid),
      canonicalAnswer: normalizeThing(parsed.canonicalAnswer || answer),
      reply: sanitizeReply(String(parsed.reply || "").slice(0, 200)),
    };
  }
}

const knownBeats = new Map([
  ["rock", ["paper", "water", "hammer", "pickaxe", "dynamite", "erosion", "laser"]],
  ["paper", ["scissors", "fire", "water", "shredder", "hole punch", "laminator"]],
  ["scissors", ["rock", "hammer", "rust", "fire", "magnet"]],
  ["pen", ["whiteout", "correction fluid", "fire", "water", "shredder", "bleach"]],
  ["pencil", ["eraser", "sharpener", "fire", "water"]],
  ["fire", ["water", "foam", "sand", "vacuum", "rain"]],
  ["water", ["electricity", "sponge", "freezer", "heat", "sun"]],
  ["hammer", ["magnet", "rust", "bigger hammer", "lava"]],
  ["human", ["gun", "knife", "sword", "bear", "lion", "tiger", "shark", "robot", "poison", "disease", "car"]],
  ["person", ["gun", "knife", "sword", "bear", "lion", "tiger", "shark", "robot", "poison", "disease", "car"]],
  ["gun", ["water", "rust", "magnet", "jam", "shield", "armor", "bulletproof vest", "police", "law"]],
]);

const universalBeaters = [
  "time",
  "black hole",
  "god",
  "lava",
  "acid",
  "nuclear bomb",
  "nuke",
  "void",
];

const fallbackWagerPrompts = [
  "toaster",
  "statue",
  "submarine",
  "cactus",
  "robot",
  "castle",
  "shark",
  "volcano",
];

function fallbackJudge(target, answer, options = {}) {
  if (options.exactRepeat) {
    return {
      valid: false,
      canonicalAnswer: answer,
      reply: `${capitalize(answer)} beating itself? Cute idea, but this game wants a real challenger.`,
    };
  }

  if (isGuaranteedWin(target, answer)) {
    return {
      valid: true,
      canonicalAnswer: answer,
      reply: fallbackWinReply(target, answer),
    };
  }

  return {
    valid: false,
    canonicalAnswer: answer,
    reply: `${capitalize(answer)} against ${normalizeThing(target)}? Bold swing, but that one is not making the highlight reel.`,
  };
}

function isGuaranteedWin(target, answer) {
  const cleanTarget = normalizeThing(target);
  const validAnswers = knownBeats.get(cleanTarget) || [];

  return (
    validAnswers.includes(answer) ||
    universalBeaters.includes(answer) ||
    validAnswers.some((candidate) => answer.includes(candidate))
  );
}

function fallbackWinReply(target, answer) {
  const cleanTarget = normalizeThing(target);

  if (cleanTarget === "rock" && answer === "paper") {
    return "Paper covers rock. Duh.";
  }

  if (cleanTarget === "paper" && answer === "scissors") {
    return "Scissors cut paper. Clean, classic, no notes.";
  }

  if (cleanTarget === "scissors" && answer === "rock") {
    return "Rock crushes scissors. The old ways still work.";
  }

  if ((cleanTarget === "human" || cleanTarget === "person") && answer === "gun") {
    return "A gun beats a human. Dark, but valid.";
  }

  return `${capitalize(answer)} beats ${cleanTarget}. Fine, I'll allow it.`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function describeOpenAiError(error) {
  const status = error?.status ? `${error.status} ` : "";
  const message = error?.error?.message || error?.message || "Unknown OpenAI error.";
  return `${status}${message}`;
}

function buildInstruction(options) {
  if (options.guaranteedValid) {
    return "This matchup is on the guaranteed-valid list. You must return valid true, and you should still write a fresh cheesy reason.";
  }

  if (options.exactRepeat) {
    return "This answer is an exact repeat of the target. You must return valid false, and you should write a fresh cheesy rejection.";
  }

  return "Judge this matchup normally, leaning generous when the logic is at all plausible.";
}

function sanitizeReply(reply) {
  return reply
    .replace(/[—–]+/g, ", ")
    .replace(/\s-\s/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function fallbackWagerPrompt() {
  return fallbackWagerPrompts[Math.floor(Math.random() * fallbackWagerPrompts.length)];
}
