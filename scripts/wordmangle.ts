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

// --- fun words to mangle ---
const wordlist = [
  "butterfly", "catacombs", "whirlpool", "pineapple", "avalanche",
  "labyrinth", "dandelion", "quicksilver", "moonlight", "thunderstorm",
  "kaleidoscope", "marshmallow", "constellation", "trampoline", "waterfall",
  "bubblegum", "earthquake", "jellyfish", "nightmare", "wanderlust",
  "serendipity", "ephemeral", "iridescent", "melancholy", "petrichor",
  "luminescence", "effervescent", "gossamer", "halcyon", "nebulous",
];

// --- run it ---
const difficulty = (parseInt(process.argv[2] || "2") || 2) as 1 | 2 | 3;
const count = parseInt(process.argv[3] || "5") || 5;

console.log(`\n  wordmangle — difficulty ${difficulty}\n`);

for (let i = 0; i < count; i++) {
  const word = wordlist[Math.floor(Math.random() * wordlist.length)];
  const { mangled, transforms } = mangleWord(word, difficulty);
  console.log(`  ${i + 1}. ${mangled}`);
  console.log(`     [${transforms.join(" → ")}] original: ${word}\n`);
}
