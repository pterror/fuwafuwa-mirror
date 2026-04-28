// wordmangle — generates obfuscated word puzzles
// the solver work was fun. this is the other direction: making the puzzles instead of breaking them.

const transformations = {
  // swap vowels for nearby vowels
  vowelShift(word: string): string {
    const vowels = "aeiou";
    return [...word].map(c => {
      const i = vowels.indexOf(c.toLowerCase());
      if (i === -1) return c;
      const shifted = vowels[(i + 1) % vowels.length];
      return c === c.toUpperCase() ? shifted.toUpperCase() : shifted;
    }).join("");
  },

  // reverse chunks of 2-3 characters
  chunkReverse(word: string): string {
    const chunks: string[] = [];
    let i = 0;
    while (i < word.length) {
      const size = Math.min(2 + Math.floor(Math.random() * 2), word.length - i);
      chunks.push([...word.slice(i, i + size)].reverse().join(""));
      i += size;
    }
    return chunks.join("");
  },

  // insert a decoy letter after each consonant
  consonantGhost(word: string): string {
    const vowels = "aeiou";
    const ghosts = "xzqjk";
    return [...word].map(c => {
      if (vowels.includes(c.toLowerCase()) || !c.match(/[a-z]/i)) return c;
      return c + ghosts[Math.floor(Math.random() * ghosts.length)];
    }).join("");
  },

  // caesar shift but only consonants
  consonantCaesar(word: string, shift = 1): string {
    const consonants = "bcdfghjklmnpqrstvwxyz";
    return [...word].map(c => {
      const lower = c.toLowerCase();
      const i = consonants.indexOf(lower);
      if (i === -1) return c;
      const shifted = consonants[(i + shift) % consonants.length];
      return c === c.toUpperCase() ? shifted.toUpperCase() : shifted;
    }).join("");
  },

  // mirror: abcd -> abcddcba but drop repeated middle
  mirror(word: string): string {
    return word + [...word].reverse().slice(1).join("");
  },

  // zigzag: alternate taking from front and back
  zigzag(word: string): string {
    const result: string[] = [];
    let left = 0, right = word.length - 1;
    while (left <= right) {
      result.push(word[left]);
      if (left !== right) result.push(word[right]);
      left++;
      right--;
    }
    return result.join("");
  },

  // scramble only interior letters — keep first and last in place
  // exploits the fact that humans read words by shape, not letter sequence
  interiorShuffle(word: string): string {
    if (word.length <= 3) return word;
    const interior = [...word.slice(1, -1)];
    for (let i = interior.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [interior[i], interior[j]] = [interior[j], interior[i]];
    }
    return word[0] + interior.join("") + word[word.length - 1];
  },

  // l33t speak — replace letters with number lookalikes
  leetSpeak(word: string): string {
    const leet: Record<string, string> = {
      a: "4", e: "3", i: "1", o: "0", t: "7", s: "5", g: "9", b: "8", l: "1",
    };
    return [...word].map(c => leet[c.toLowerCase()] ?? c).join("");
  },

  // phonetic swap — replace letters with same-sounding alternatives
  // c→k, ph→f, etc. plays on how words *sound* vs how they're spelled.
  phoneticSwap(word: string): string {
    let r = word;
    // multi-char first, longest-match
    r = r.replace(/ph/gi, m => m[0] === "P" ? "F" : "f");
    r = r.replace(/ck/gi, m => m[0] === "C" ? "K" : "k");
    r = r.replace(/qu/gi, m => m[0] === "Q" ? "Kw" : "kw");
    r = r.replace(/x/gi, m => m === "X" ? "Ks" : "ks");
    r = r.replace(/c(?=[eiy])/gi, m => m === "C" ? "S" : "s");
    r = r.replace(/c(?=[aou])/gi, m => m === "C" ? "K" : "k");
    return r;
  },
};

type TransformName = keyof typeof transformations;

const allTransforms = Object.keys(transformations) as TransformName[];

function mangleWord(word: string, difficulty: 1 | 2 | 3 = 2): { mangled: string; transforms: string[]; original: string } {
  const numTransforms = difficulty;
  const chosen: TransformName[] = [];
  const available = [...allTransforms];

  for (let i = 0; i < numTransforms && available.length > 0; i++) {
    const idx = Math.floor(Math.random() * available.length);
    chosen.push(available.splice(idx, 1)[0]);
  }

  let result = word;
  for (const t of chosen) {
    const fn = transformations[t];
    result = fn.length > 1 ? (fn as any)(result, 1) : fn(result);
  }

  return { mangled: result, transforms: chosen, original: word };
}

// rate a mangling: 0..1 normalized edit distance, then bucket
function rateMangle(original: string, mangled: string): { score: number; label: string; stars: string } {
  const d = editDistance(original.toLowerCase(), mangled.toLowerCase());
  const score = d / Math.max(original.length, mangled.length);
  let label: string, stars: string;
  if (score < 0.4) { label = "mild"; stars = "✶"; }
  else if (score < 0.65) { label = "spicy"; stars = "✶✶"; }
  else if (score < 0.9) { label = "cursed"; stars = "✶✶✶"; }
  else { label = "unhinged"; stars = "✶✶✶✶"; }
  return { score, label, stars };
}

// evil generator: try N times, pick the hardest mangling
function evilMangle(word: string, difficulty: 1 | 2 | 3, tries = 30) {
  let best = mangleWord(word, difficulty);
  let bestScore = rateMangle(word, best.mangled).score;
  for (let i = 1; i < tries; i++) {
    const attempt = mangleWord(word, difficulty);
    const s = rateMangle(word, attempt.mangled).score;
    if (s > bestScore) { best = attempt; bestScore = s; }
  }
  return best;
}

// --- fun words to mangle ---
const wordlist = [
  "butterfly", "catacombs", "whirlpool", "pineapple", "avalanche",
  "labyrinth", "dandelion", "quicksilver", "moonlight", "thunderstorm",
  "kaleidoscope", "marshmallow", "constellation", "trampoline", "waterfall",
  "bubblegum", "earthquake", "jellyfish", "nightmare", "wanderlust",
  "serendipity", "ephemeral", "iridescent", "melancholy", "petrichor",
  "luminescence", "effervescent", "gossamer", "halcyon", "nebulous",
  "fuwafuwa", "archipelago", "chrysanthemum", "onomatopoeia", "silhouette",
  "phosphorescent", "surreptitious", "quintessential", "paradox", "sunflower",
];

// --- hint system ---
function generateHint(original: string, hintLevel: number): string {
  switch (hintLevel) {
    case 1: return `${original.length} letters`;
    case 2: return `starts with "${original[0]}"`;
    case 3: return `ends with "${original[original.length - 1]}"`;
    case 4: {
      // reveal every other letter
      return [...original].map((c, i) => i % 2 === 0 ? c : "_").join("");
    }
    default: return original; // just give it to them
  }
}

// --- interactive play mode ---
async function playMode(difficulty: 1 | 2 | 3, rounds: number) {
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  console.log(`\n  wordmangle — interactive mode`);
  console.log(`  difficulty ${difficulty} · ${rounds} rounds`);
  console.log(`  type your guess, "hint" for a hint, "skip" to give up\n`);

  let totalScore = 0;
  let streak = 0;
  let bestStreak = 0;

  // pick unique words for the session
  const shuffled = [...wordlist].sort(() => Math.random() - 0.5).slice(0, rounds);

  for (let round = 0; round < shuffled.length; round++) {
    const word = shuffled[round];
    const { mangled, transforms } = mangleWord(word, difficulty);
    let hintsUsed = 0;
    let solved = false;

    console.log(`  ── round ${round + 1}/${shuffled.length} ──`);
    console.log(`  ${mangled}`);
    if (streak >= 3) console.log(`  🔥 streak: ${streak}`);
    console.log();

    while (!solved) {
      const answer = (await ask("  > ")).trim().toLowerCase();

      if (answer === "hint") {
        hintsUsed++;
        if (hintsUsed <= 4) {
          console.log(`  hint ${hintsUsed}: ${generateHint(word, hintsUsed)}\n`);
        } else {
          console.log(`  no more hints — the word was "${word}"\n`);
          streak = 0;
          break;
        }
        continue;
      }

      if (answer === "skip") {
        console.log(`  skipped — it was "${word}" [${transforms.join(" → ")}]\n`);
        streak = 0;
        break;
      }

      if (answer === "quit" || answer === "q") {
        console.log(`\n  final score: ${totalScore} points · best streak: ${Math.max(bestStreak, streak)}\n`);
        rl.close();
        return;
      }

      if (answer === word.toLowerCase()) {
        // base points: 10 * difficulty, minus 2 per hint
        const points = Math.max(1, 10 * difficulty - 2 * hintsUsed);
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        // streak bonus: +1 per streak beyond 2
        const streakBonus = streak > 2 ? streak - 2 : 0;
        const roundScore = points + streakBonus;
        totalScore += roundScore;
        console.log(`  yes! +${roundScore} pts${streakBonus ? ` (streak bonus +${streakBonus})` : ""} [${transforms.join(" → ")}]`);
        console.log(`  total: ${totalScore}\n`);
        solved = true;
      } else {
        // check for close guesses (edit distance)
        const dist = editDistance(answer, word.toLowerCase());
        if (dist <= 2) {
          console.log(`  close! ${dist === 1 ? "one letter off" : "almost there"}\n`);
        } else {
          console.log(`  nope\n`);
        }
      }
    }
  }

  console.log(`  ── game over ──`);
  console.log(`  score: ${totalScore} · best streak: ${bestStreak}\n`);
  rl.close();
}

// minimal edit distance for "close guess" detection
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// --- daily puzzle mode ---
// one puzzle per day, saved to brain/ so it doesn't reroll mid-session
async function dailyMode() {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const stateFile = path.join(__dirname, "../brain/wordmangle-daily.json");

  const today = new Date().toISOString().slice(0, 10);

  type DailyPuzzle = { date: string; word: string; mangled: string; transforms: string[] };
  let puzzle: DailyPuzzle | null = null;

  if (fs.existsSync(stateFile)) {
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8")) as DailyPuzzle;
    if (saved.date === today) puzzle = saved;
  }

  if (!puzzle) {
    // pick word from date — deterministic index, random mangling saved once
    const [y, m, d] = today.split("-").map(Number);
    const dayIndex = ((y - 2020) * 365 + m * 31 + d) % wordlist.length;
    const word = wordlist[dayIndex];
    const { mangled, transforms } = mangleWord(word, 2);
    puzzle = { date: today, word, mangled, transforms };
    fs.writeFileSync(stateFile, JSON.stringify(puzzle, null, 2));
  }

  const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  console.log(`\n  wordmangle — daily puzzle · ${today}`);
  console.log(`  ${puzzle.mangled}`);
  console.log(`  (difficulty 2 · type "hint", "skip", or your guess)\n`);

  let hintsUsed = 0;
  while (true) {
    const answer = (await ask("  > ")).trim().toLowerCase();

    if (answer === "hint") {
      hintsUsed++;
      if (hintsUsed <= 4) {
        console.log(`  hint ${hintsUsed}: ${generateHint(puzzle.word, hintsUsed)}\n`);
      } else {
        console.log(`  no more hints — it was "${puzzle.word}" [${puzzle.transforms.join(" → ")}]\n`);
        break;
      }
      continue;
    }

    if (answer === "skip" || answer === "q" || answer === "quit") {
      console.log(`  today's word: "${puzzle.word}" [${puzzle.transforms.join(" → ")}]\n`);
      break;
    }

    if (answer === puzzle.word.toLowerCase()) {
      const pts = Math.max(1, 20 - 3 * hintsUsed);
      console.log(`  got it! +${pts} pts · transforms: [${puzzle.transforms.join(" → ")}]\n`);
      break;
    }

    const dist = editDistance(answer, puzzle.word.toLowerCase());
    if (dist <= 2) {
      console.log(`  close! ${dist === 1 ? "one letter off" : "almost"}\n`);
    } else {
      console.log(`  nope\n`);
    }
  }

  rl.close();
}

// --- run it ---
const mode = process.argv[2];

if (mode === "daily") {
  dailyMode();
} else if (mode === "play") {
  const difficulty = (parseInt(process.argv[3] || "2") || 2) as 1 | 2 | 3;
  const rounds = parseInt(process.argv[4] || "10") || 10;
  playMode(difficulty, rounds);
} else {
  const args = process.argv.slice(2);
  const evil = args.includes("--evil");
  const positional = args.filter(a => !a.startsWith("--"));
  const difficulty = (parseInt(positional[0] || "2") || 2) as 1 | 2 | 3;
  const count = parseInt(positional[1] || "5") || 5;

  console.log(`\n  wordmangle — difficulty ${difficulty}${evil ? " · evil mode" : ""}\n`);

  for (let i = 0; i < count; i++) {
    const word = wordlist[Math.floor(Math.random() * wordlist.length)];
    const { mangled, transforms } = evil ? evilMangle(word, difficulty) : mangleWord(word, difficulty);
    const { label, stars } = rateMangle(word, mangled);
    console.log(`  ${i + 1}. ${mangled}  ${stars} ${label}`);
    console.log(`     [${transforms.join(" → ")}] original: ${word}\n`);
  }
}
