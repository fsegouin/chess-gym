import { generateText, Output } from "ai";
import { z } from "zod";
import { MAX_REVIEW_PLIES, reviewFacts, type GameReview } from "@/lib/game-review";

const MODEL = "anthropic/claude-haiku-5.5";
/** Per address: enough for honest use, too few to make the route worth abusing. */
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const score = z.union([z.object({ cp: z.number() }), z.object({ mate: z.number() })]);
const Request = z.object({
  playerColor: z.enum(["w", "b"]),
  result: z.string().max(60),
  moves: z
    .array(
      z.object({
        san: z.string().max(10),
        cls: z.enum(["best", "good", "inaccuracy", "mistake", "blunder"]).nullable(),
        before: score.nullable(),
        after: score.nullable(),
        best: z.string().max(10).nullable(),
      }),
    )
    .min(2)
    .max(MAX_REVIEW_PLIES),
});

const Review = z.object({
  headline: z.string().describe("At most twelve words: the story of the game in one line."),
  story: z.string().describe("Three to five sentences on how the game went, from the player's side."),
  turningPoints: z
    .array(z.object({ ply: z.number().int(), title: z.string(), text: z.string() }))
    .describe("One to four moments that decided the game, each a title of at most six words and two or three sentences."),
  strengths: z.array(z.string()).describe("One to three things the player did well, one sentence each."),
  focus: z
    .array(z.object({ title: z.string(), text: z.string() }))
    .describe("One to three concrete habits to work on, each a short title and one or two sentences of practical advice."),
});

const SYSTEM = `You are a friendly, honest chess coach writing a short review of a club player's game.
The engine has already graded every one of the player's moves; those facts are the ground truth.
- Evaluations are in pawns from White's side: +1.5 means White is better by about a pawn and a half, M3 means White mates in 3.
- Never call a move good or bad unless its grade supports it. Grades are best, good, inaccuracy, mistake, blunder.
- Do not invent variations. The only concrete moves you may cite are those played and the coach's preferred moves given.
- Speak to the player as "you". Be encouraging but specific: patterns over single moves, and advice they can use next game.
- British English, plain words, no em dashes. Refer to moves with their number, e.g. 14.Nxe5 or 14...Nxe5.`;

const hits = new Map<string, number[]>();

function limited(key: string): boolean {
  const now = Date.now();
  // Forget addresses whose window has passed, so the map stays small on a long-lived server.
  if (hits.size > 1000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > RATE_LIMIT;
}

const tidy = (s: string) => s.replace(/\s*\u2014\s*/g, ", ").trim();

export async function POST(request: Request): Promise<Response> {
  // Browsers mark their own same-site requests; anything else is not this app asking.
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return Response.json({ error: "Not allowed." }, { status: 403 });
  }
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json({ error: "Written reviews are not set up on this server." }, { status: 503 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) {
    return Response.json({ error: "Too many reviews in a short time. Try again in a few minutes." }, { status: 429 });
  }
  const parsed = Request.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That game could not be read." }, { status: 400 });
  const req = parsed.data;
  const plies = req.moves.length;

  try {
    const { output } = await generateText({
      model: MODEL,
      system: SYSTEM,
      prompt: `The player had the ${req.playerColor === "w" ? "white" : "black"} pieces. Result: ${req.result}.

One line per ply; the player's moves carry the coach's grade:
${reviewFacts(req)}`,
      output: Output.object({ schema: Review }),
      abortSignal: AbortSignal.timeout(90_000),
    });
    const review: GameReview = {
      headline: tidy(output.headline),
      story: tidy(output.story),
      turningPoints: output.turningPoints
        .filter((t) => t.ply >= 0 && t.ply < plies)
        .slice(0, 4)
        .map((t) => ({ ply: t.ply, title: tidy(t.title), text: tidy(t.text) })),
      strengths: output.strengths.slice(0, 3).map(tidy),
      focus: output.focus.slice(0, 3).map((f) => ({ title: tidy(f.title), text: tidy(f.text) })),
    };
    return Response.json(review);
  } catch {
    return Response.json({ error: "The coach could not write a review just now. Try again later." }, { status: 502 });
  }
}
