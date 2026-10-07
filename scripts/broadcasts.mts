// Prepares Chess TV: analyses each famous game in data/broadcasts with full-strength Stockfish,
// then asks a language model, through the AI Gateway, to comment on it from that analysis.
// Writes public/broadcasts/<slug>.json and the library index. Run: pnpm broadcasts [slug...] [--force]
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { generateText, Output } from "ai";
import { Chess, type Move } from "chess.js";
import { z } from "zod";
import type { Broadcast, BroadcastMove, BroadcastSummary } from "../lib/broadcast.ts";
import { classify, formatScore, negate } from "../lib/coach.ts";
import type { Score } from "../lib/engine.ts";

const MODEL = "anthropic/claude-haiku-5.5";
const GO = "go depth 22 movetime 1500";
const CONCURRENCY = 3;
const root = join(import.meta.dirname, "..");
const sourceDir = join(root, "data", "broadcasts");
const outDir = join(root, "public", "broadcasts");

interface Analysis {
  score: Score;
  bestMove: string | null;
  pv: string[];
}

/** Stockfish (full NNUE build, single-threaded WASM) driven over UCI on stdin and stdout. */
class Engine {
  private proc: ChildProcessWithoutNullStreams;
  private pending: { until: string; lines: string[]; resolve: (lines: string[]) => void } | null = null;

  constructor() {
    const require = createRequire(import.meta.url);
    const pkg = dirname(require.resolve("stockfish/package.json"));
    this.proc = spawn(process.execPath, [join(pkg, "bin", "stockfish-19-single.js")]);
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      const p = this.pending;
      if (!p) return;
      p.lines.push(line);
      if (line.startsWith(p.until)) {
        this.pending = null;
        p.resolve(p.lines);
      }
    });
  }

  private request(commands: string[], until: string): Promise<string[]> {
    return new Promise((resolve) => {
      this.pending = { until, lines: [], resolve };
      for (const c of commands) this.proc.stdin.write(`${c}\n`);
    });
  }

  async init(): Promise<void> {
    await this.request(["uci"], "uciok");
    await this.request(["setoption name Hash value 128", "isready"], "readyok");
  }

  async analyse(fen: string): Promise<Analysis> {
    const lines = await this.request([`position fen ${fen}`, GO], "bestmove");
    const best = lines.at(-1)!.split(" ")[1];
    const info = lines.findLast((l) => l.startsWith("info") && / score /.test(l) && / pv /.test(l));
    const cp = info && / score cp (-?\d+)/.exec(info);
    const mate = info && / score mate (-?\d+)/.exec(info);
    const score: Score = mate ? { mate: Number(mate[1]) } : { cp: cp ? Number(cp[1]) : 0 };
    return { score, bestMove: best && best !== "(none)" ? best : null, pv: info ? info.split(" pv ")[1].split(" ") : [] };
  }

  quit(): void {
    this.proc.stdin.write("quit\n");
    this.proc.kill();
  }
}

function uciLineToSan(fen: string, uci: string[], max = 6): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    try {
      out.push(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

const whitePov = (score: Score, sideToMove: "w" | "b") => (sideToMove === "w" ? score : negate(score));

/** Everything the engine knows about the game, ply by ply, and the moves graded like the coach does. */
async function analyseGame(engine: Engine, moves: Move[]) {
  const positions = [moves[0].before, ...moves.map((m) => m.after)];
  const analyses: Analysis[] = [];
  for (const fen of positions) {
    const end = new Chess(fen);
    analyses.push(
      end.isCheckmate() ? { score: { mate: 0 }, bestMove: null, pv: [] } : end.isDraw() ? { score: { cp: 0 }, bestMove: null, pv: [] } : await engine.analyse(fen),
    );
  }
  return moves.map((move, ply) => {
    const before = analyses[ply];
    const after = analyses[ply + 1];
    const mated = new Chess(move.after).isCheckmate();
    const afterForMover: Score = mated ? { mate: 1 } : negate(after.score);
    const played = move.from + move.to + (move.promotion ?? "");
    const isBest = before.bestMove === played;
    const cls = mated ? "best" : classify(before.score, afterForMover, isBest);
    const evaluation = mated ? { mate: move.color === "w" ? 1 : -1 } : whitePov(after.score, move.color === "w" ? "b" : "w");
    const bestLine = isBest || !before.bestMove ? [] : uciLineToSan(move.before, before.pv.length ? before.pv : [before.bestMove]);
    return {
      move,
      cls,
      evaluation,
      evalBefore: whitePov(before.score, move.color),
      best: bestLine.length ? { san: bestLine[0], uci: before.bestMove!, line: bestLine } : null,
    };
  });
}

type Facts = Awaited<ReturnType<typeof analyseGame>>;

function factsText(facts: Facts): string {
  return facts
    .map(({ move, cls, evaluation, evalBefore, best }, ply) => {
      const n = Math.floor(ply / 2) + 1;
      const label = `${n}${move.color === "w" ? "." : "..."} ${move.san}`;
      const parts = [
        `ply ${ply}`,
        label,
        move.color === "w" ? "White" : "Black",
        `eval ${formatScore(evalBefore)} -> ${formatScore(evaluation)}`,
        `grade ${cls}`,
      ];
      if (best) parts.push(`engine preferred ${best.san} (line: ${best.line.join(" ")})`);
      return parts.join(" | ");
    })
    .join("\n");
}

const Commentary = z.object({
  summary: z.string().describe("Two or three sentences: why this game is remembered and what to watch for."),
  moves: z
    .array(z.object({ ply: z.number().int(), comment: z.string() }))
    .describe("One entry for every ply, in order, starting at ply 0."),
  moments: z
    .array(z.object({ ply: z.number().int(), title: z.string(), text: z.string() }))
    .describe("Three to seven turning points that decided the game."),
  lessons: z.array(z.string()).describe("Three short takeaways a club player can use in their own games."),
});

const SYSTEM = `You are the commentator of Chess TV, a show inside a chess training app for club players.
You explain famous games move by move so viewers understand the ideas: threats, plans, weaknesses, and why a move works or fails.

The engine facts you are given are the ground truth.
- Evaluations are in pawns from White's side: +1.5 means White is better by about a pawn and a half, M3 means White mates in 3, -M2 means Black mates in 2.
- Never call a move good, bad, winning or losing unless the evaluation and grade support it. Grades are best, good, inaccuracy, mistake, blunder.
- The only concrete variations you may give are the engine lines provided and the moves actually played. Do not invent other lines.
- Historical context only where it is widely documented. No invented quotes or anecdotes.

Style: British English, plain words, warm and precise, no hype. Never use em dashes. Refer to moves in standard notation with the move number, e.g. 17.Rd8# or 12...Bxf3.
- comment: one or two sentences, at most 35 words, for every ply. Quiet opening moves can be brief; name the opening only if you are sure.
- moments: three to seven turning points, each a title of at most six words and two to four sentences telling the viewer what to notice and why it matters.
- lessons: three takeaways, one sentence each.`;

function validate(c: z.infer<typeof Commentary>, plies: number): string | null {
  const seen = new Set(c.moves.map((m) => m.ply));
  if (c.moves.length !== plies || seen.size !== plies || ![...seen].every((p) => p >= 0 && p < plies)) {
    return `moves must have exactly one entry for each ply from 0 to ${plies - 1}`;
  }
  if (c.moments.length < 3 || c.moments.length > 7) return "give three to seven moments";
  if (!c.moments.every((m) => m.ply >= 0 && m.ply < plies)) return `moment plies must be between 0 and ${plies - 1}`;
  if (c.lessons.length < 2) return "give three lessons";
  return null;
}

const tidy = (s: string) => s.replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim();

async function comment(headers: Record<string, string>, pgn: string, facts: Facts) {
  const prompt = `Game: ${headers.Title} (${headers.White} vs ${headers.Black}, ${headers.Event}, ${headers.Date}, result ${headers.Result}).

PGN:
${pgn}

Engine facts, one line per ply:
${factsText(facts)}`;
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { output } = await generateText({
      model: MODEL,
      system: SYSTEM,
      prompt: feedback ? `${prompt}\n\nYour previous answer was rejected: ${feedback}. Answer again in full.` : prompt,
      output: Output.object({ schema: Commentary }),
    });
    const problem = validate(output, facts.length);
    if (!problem) return output;
    feedback = problem;
    console.warn(`  retrying: ${problem}`);
  }
  throw new Error(`commentary for ${headers.Slug} did not validate`);
}

async function build(file: string, engine: Engine): Promise<Broadcast> {
  const text = readFileSync(join(sourceDir, file), "utf8");
  const chess = new Chess();
  chess.loadPgn(text);
  const headers = chess.getHeaders();
  const moves = chess.history({ verbose: true });
  console.log(`${headers.Slug}: analysing ${moves.length} plies`);
  const facts = await analyseGame(engine, moves);
  console.log(`${headers.Slug}: writing commentary`);
  const c = await comment(headers, chess.pgn(), facts);
  const byPly = new Map(c.moves.map((m) => [m.ply, tidy(m.comment)]));
  const moments = new Map(c.moments.map((m) => [m.ply, { title: tidy(m.title), text: tidy(m.text) }]));
  const out: BroadcastMove[] = facts.map(({ move, cls, evaluation, best }, ply) => ({
    san: move.san,
    color: move.color,
    from: move.from,
    to: move.to,
    before: move.before,
    after: move.after,
    evaluation,
    cls,
    best: best ? { san: best.san, uci: best.uci } : null,
    comment: byPly.get(ply) ?? "",
    moment: moments.get(ply) ?? null,
  }));
  return {
    slug: headers.Slug,
    title: headers.Title,
    white: headers.White,
    black: headers.Black,
    event: headers.Event,
    date: headers.Date,
    result: headers.Result,
    summary: tidy(c.summary),
    moves: out,
    lessons: c.lessons.map(tidy),
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
}

function writeIndex(): void {
  const entries: BroadcastSummary[] = readdirSync(outDir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => JSON.parse(readFileSync(join(outDir, f), "utf8")) as Broadcast)
    .map((b) => ({
      slug: b.slug,
      title: b.title,
      white: b.white,
      black: b.black,
      event: b.event,
      date: b.date,
      result: b.result,
      summary: b.summary,
      plies: b.moves.length,
      moments: b.moves.filter((m) => m.moment).length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(join(outDir, "index.json"), `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`index: ${entries.length} games`);
}

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error("Set AI_GATEWAY_API_KEY (for example in .env.local) to write commentary.");
  }
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const only = args.filter((a) => !a.startsWith("--"));
  mkdirSync(outDir, { recursive: true });
  const queue = readdirSync(sourceDir)
    .filter((f) => f.endsWith(".pgn"))
    .filter((f) => only.length === 0 || only.includes(f.replace(/\.pgn$/, "")))
    .filter((f) => force || !existsSync(join(outDir, f.replace(/\.pgn$/, ".json"))));
  let failed = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      const engine = new Engine();
      await engine.init();
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          const b = await build(file, engine);
          writeFileSync(join(outDir, `${b.slug}.json`), `${JSON.stringify(b)}\n`);
          console.log(`${b.slug}: done`);
        } catch (e) {
          failed++;
          console.error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      engine.quit();
    }),
  );
  writeIndex();
  if (failed) process.exitCode = 1;
}

await main();
