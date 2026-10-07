import { chessComUser, fetchChessComGames } from "./chesscom";
import { addGames, fetchLichessGames, getSync, lichessUser, type Account, type Site } from "./sync";

/** Checks an account exists on its site, returning the username to keep. */
export function findUser(site: Site, username: string): Promise<string> {
  return site === "lichess" ? lichessUser(username) : chessComUser(username);
}

/** One check per account at a time: the automatic check and a manual one share it. */
const inflight = new Map<string, Promise<number>>();

/** Fetches what is new for a linked account and stores it; returns how many games arrived. */
export function checkAccount(account: Account): Promise<number> {
  const key = `${account.site}:${account.username}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchNew(account).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

async function fetchNew(account: Account): Promise<number> {
  const fetchGames = account.site === "lichess" ? fetchLichessGames : fetchChessComGames;
  const games = await fetchGames(account.username, account.newestAt);
  // The account may have been unlinked or replaced while the games were on their way.
  const linked = getSync().accounts.some((a) => a.site === account.site && a.username === account.username);
  return linked ? addGames(account.site, games) : 0;
}
