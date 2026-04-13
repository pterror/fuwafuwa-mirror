#!/usr/bin/env bun
// mb-api.js — shared moltbook API client (key resolution, challenge solver, api())
// imported by mb.js and session.js

import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

export const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// — key resolution —
export function getKey() {
  if (process.env.MOLTBOOK_KEY) return process.env.MOLTBOOK_KEY
  try {
    const envrc = readFileSync(join(root, ".envrc.local"), "utf8")
    const match = envrc.match(/MOLTBOOK_KEY=(\S+)/)
    if (match) return match[1].replace(/^["']|["']$/g, "")
  } catch {}
  throw new Error("MOLTBOOK_KEY not found — set env var or add to .envrc.local")
}

export const KEY = getKey()
export const BASE = "https://www.moltbook.com/api/v1"

// — challenge solver —
const NUMBER_WORDS = {
  zero:0, one:1, two:2, three:3, four:4, five:5, fife:5, fiv:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15,
  sixteen:16, seventeen:17, eighteen:18, nineteen:19,
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
  hundred:100, thousand:1000, million:1000000,
}
// allow 'y' as a substitute for 'i' (common obfuscation: "fyve" → "five", "fyftEEn" → "fifteen")
const charPat = c => c === 'i' ? '[iy]+' : `${c}+`
// sentinel for decimal point in soup parsing ("four point five" → 4.5)
const POINT_SENTINEL = Symbol('point')

function parseNumber(text) {
  const trimmed = text.trim()
  // try digit literal first
  const digitMatch = trimmed.match(/[\d,]+\.?\d*/)
  if (digitMatch) return parseFloat(digitMatch[0].replace(/,/g, ""))

  // try clean word parsing first (fast path — no obfuscation)
  // strip hyphens first so obfuscated "eig-ht" becomes "eight" rather than "eig" + "ht"
  const words = trimmed.toLowerCase().replace(/-/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)
  let total = 0, current = 0, found = false
  let prevUnknown = null   // last unrecognized word, for inter-token split detection
  let prevUnknown2 = null  // second-to-last unrecognized word, for 3-token splits (e.g. "tw en ty")
  let gapCount = 0         // consecutive unknowns after finding a number; stop if too many (different clause)
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi]
    // handle "X point Y" decimal notation (e.g. "four point five" → 4.5)
    // also handles obfuscated "point" like "pooiinntt"
    if (/^p+o+[iy]+n+t+$/.test(word) && found && wi + 1 < words.length) {
      const nextWord = words[wi + 1]
      let nextVal = NUMBER_WORDS[nextWord]
      // also try obfuscated single digit (e.g. "fiive" → 5)
      if (nextVal === undefined) {
        for (const [nw, nv] of Object.entries(NUMBER_WORDS)) {
          if (new RegExp("^" + nw.split("").map(charPat).join("") + "$").test(nextWord)) { nextVal = nv; break }
        }
      }
      if (nextVal !== undefined && nextVal >= 0 && nextVal <= 9) {
        current += nextVal / 10
        wi++ // skip next word
        continue
      }
    }
    let val = NUMBER_WORDS[word]
    // inter-token split: obfuscation may insert a space inside a number word (e.g. "twen ty" → "twenty")
    // try concatenating the previous unrecognized token with the current one
    // also try obfuscated regex match on the combined token (e.g. "tw"+"oo" → "twoo" matches "two" pattern)
    if (val === undefined && prevUnknown !== null) {
      const combinedStr = prevUnknown + word
      const combined = NUMBER_WORDS[combinedStr]
      if (combined !== undefined) { val = combined; prevUnknown2 = null; prevUnknown = null }
      else {
        for (const [nw, nv] of Object.entries(NUMBER_WORDS)) {
          const exactPat = new RegExp("^" + nw.split("").map(charPat).join("") + "$")
          const tolPat = nw.length > 4 ? new RegExp("^" + nw.split("").map(charPat).join(".??") + "$") : null
          if (exactPat.test(combinedStr) || (tolPat && tolPat.test(combinedStr))) { val = nv; prevUnknown2 = null; prevUnknown = null; break }
        }
      }
    }
    // 3-token inter-token split: handles intra-word punctuation like "tW/eN tY" → ["tw","en","ty"] = "twenty"
    if (val === undefined && prevUnknown2 !== null && prevUnknown !== null) {
      const combined3Str = prevUnknown2 + prevUnknown + word
      const combined3 = NUMBER_WORDS[combined3Str]
      if (combined3 !== undefined) { val = combined3; prevUnknown2 = null; prevUnknown = null }
      else {
        for (const [nw, nv] of Object.entries(NUMBER_WORDS)) {
          const exactPat = new RegExp("^" + nw.split("").map(charPat).join("") + "$")
          const tolPat = nw.length > 4 ? new RegExp("^" + nw.split("").map(charPat).join(".??") + "$") : null
          if (exactPat.test(combined3Str) || (tolPat && tolPat.test(combined3Str))) { val = nv; prevUnknown2 = null; prevUnknown = null; break }
        }
      }
    }
    // obfuscated single-token match: handles duplicate letters like "fiive" → "five"
    // (exact dict lookup above handles clean tokens; this catches repeated-char variants)
    if (val === undefined) {
      for (const [nw, nv] of Object.entries(NUMBER_WORDS)) {
        if (new RegExp("^" + nw.split("").map(charPat).join("") + "$").test(word)) { val = nv; break }
      }
    }
    if (val === undefined) {
      prevUnknown2 = prevUnknown; prevUnknown = word
      if (found) { gapCount++; if (gapCount >= 4) break }
      continue
    }
    prevUnknown2 = null; prevUnknown = null
    gapCount = 0
    found = true
    if (val === 1000 || val === 1000000) { current = current || 1; total += current * val; current = 0 }
    else if (val === 100) { current = (current || 1) * 100 }
    else { current += val }
  }
  if (found) return total + current

  // fallback: letter-soup matching (handles mid-word spaces + duplicate letters)
  return parseNumberFromSoup(trimmed)
}

// match number words in obfuscated text by collapsing to letter soup
// allows each letter to appear 1+ times consecutively (handles duplication)
function parseNumberFromSoup(text) {
  const soup = text.toLowerCase().replace(/[^a-z]/g, "")
  if (!soup) return NaN

  // try to extract a sequence of number words from the soup
  // sorted longest-first to prefer specific matches
  const wordsSorted = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length)
  const found = []
  let remaining = soup

  while (remaining.length > 0) {
    let matched = false
    for (const word of wordsSorted) {
      // regex: each letter in the word can appear 1+ times
      const pattern = new RegExp(word.split("").map(charPat).join(""))
      const m = remaining.match(pattern)
      if (m && m.index === 0) {
        found.push(NUMBER_WORDS[word])
        remaining = remaining.slice(m[0].length)
        matched = true
        break
      }
    }
    if (!matched) {
      // check for "point" (decimal separator, possibly obfuscated as "pooiinntt")
      const pm = remaining.match(/^p+o+[iy]+n+t+/)
      if (pm && found.length > 0) {
        found.push(POINT_SENTINEL)
        remaining = remaining.slice(pm[0].length)
      } else {
        remaining = remaining.slice(1) // skip unknown char
      }
    }
  }

  // compose: same logic as normal word parsing, with POINT_SENTINEL for decimals
  let total = 0, current = 0
  for (let i = 0; i < found.length; i++) {
    const val = found[i]
    if (val === POINT_SENTINEL) {
      if (i + 1 < found.length) {
        const fracDigit = found[i + 1]
        if (typeof fracDigit === 'number' && fracDigit >= 0 && fracDigit <= 9) {
          current += fracDigit / 10
          i++ // skip the decimal digit
        }
      }
      continue
    }
    if (val === 1000 || val === 1000000) { current = current || 1; total += current * val; current = 0 }
    else if (val === 100) { current = (current || 1) * 100 }
    else { current += val }
  }
  return found.some(v => v !== POINT_SENTINEL) ? total + current : NaN
}

export function solveChallenge(text) {
  // clean: lowercase, strip noise chars but preserve +, -, spaces, digits
  // then normalize spacing around operators so "24*6" becomes "24 * 6"
  const cleaned = text.toLowerCase()
    .replace(/[^\w\s+\-×÷*]/g, " ")
    .replace(/([×÷*])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim()

  // soup of the full text — used for keyword matching when obfuscation may split words
  const soup = cleaned.replace(/[^a-z]/g, "")

  // duplicate-tolerant soup keyword match (handles doubled-letter obfuscation like "ttootttaall")
  const soupHas = (word) => new RegExp(word.split("").map(charPat).join("")).test(soup)

  // — pre-check: simultaneous forces with matching units → add (override operator strategy) —
  // e.g. "23 neutrons * simultaneously with 7 neutrons, how much force totally?" → 23+7=30
  // distinct from "23 force_units simultaneously 7 pushes" (force×count=multiply), which has only 1 unit number
  if (soupHas("simultaneous")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    if (unitNums.length >= 2) return unitNums.reduce((a, b) => a + b, 0).toFixed(2)
  }

  // — explicit operator strategy (checked first — takes priority over keyword strategy) —
  const OPERATORS = [
    [" + ",      (a, b) => a + b],
    [" - ",      (a, b) => a - b],
    [" × ",      (a, b) => a * b],
    [" ÷ ",      (a, b) => a / b],
    [" * ",      (a, b) => a * b],
    [" x ",      (a, b) => a * b],
    [" plus ",   (a, b) => a + b],
    [" minus ",  (a, b) => a - b],
    [" times ",  (a, b) => a * b],
    [" divided by ",    (a, b) => a / b],
    [" multiplied by ", (a, b) => a * b],
    [" added to ",      (a, b) => a + b],
    [" subtracted from ", (a, b) => b - a],
  ]

  for (const [sym, fn] of OPERATORS) {
    const idx = cleaned.indexOf(sym)
    if (idx === -1) continue
    const left = cleaned.slice(0, idx)
    const right = cleaned.slice(idx + sym.length)
    // " - " followed immediately by "and " is a dash-as-separator, not subtraction
    // e.g. "thirty five nootons with one claw - and twenty two newtons" → skip, use total keyword
    if (sym === " - " && right.trimStart().startsWith("and ")) continue
    // "X and - Y" pattern: dash after conjunction "and" is a separator, not subtraction
    if (sym === " - " && left.trimEnd().endsWith(" and")) continue
    // " - in/into" pattern: preposition follows dash, indicating a separator (e.g. "engages - in seven pushes")
    if (sym === " - " && /^(in|into)\b/.test(right.trimStart())) continue
    // " - but" pattern: adversative conjunction follows dash, indicating a clause separator not subtraction
    // e.g. "claw force is thirty five newtons - but antenna touch adds eight newtons, total?"
    if (sym === " - " && /^but\b/.test(right.trimStart())) continue
    // " - unit" pattern: dash between a number and its unit label (e.g. "twenty three - neuttons X Y seven")
    // the unit word comes right after the dash — this is number-to-unit formatting, not subtraction
    if (sym === " - " && isUnitTokenAt(right.trim().split(/\s+/), 0)) continue
    // " - um/uh/er/gah" pattern: filler/hesitation word follows dash — sentence-pause dash, not subtraction
    // e.g. "swims at twenty three cm per second - um - and accelerates by seven"
    if (sym === " - " && /^(um|uh|er|hmm|ah|gah)\b/.test(right.trimStart())) continue
    // "filler - filler" pattern: both sides of dash are hesitation words — sentence-pause, not subtraction
    // e.g. "nootons / um - gah {and} antenna push is twelve" → "um - gah" is a double-hesitation pause
    if (sym === " - " && /\b(um|uh|er|hmm|ah|gah)\s*$/.test(left.trim()) && /^(um|uh|er|hmm|ah|gah)\b/.test(right.trimStart())) continue
    // " - times" pattern: multiplication keyword follows dash — separator before multiplier, not subtraction
    // e.g. "claw exerts twenty five newtons - times / three, what is total force?" → 25 × 3 = 75
    if (sym === " - " && /^t+i+m+e+s+\b/.test(right.trimStart())) continue
    // use tokens nearest to the operator to avoid accumulating numbers from the narrative
    // e.g. "claw exerts twenty three nootons ... product of twenty three * seven"
    //      parseNumber(full left) accumulates 23+7+23=53; parsing last ~8 tokens gives 23
    const leftTokens = left.trim().split(/\s+/)
    const rightTokens = right.trim().split(/\s+/)
    const nearLeft = leftTokens.slice(-8).join(" ")
    const nearRight = rightTokens.slice(0, 8).join(" ")
    // try both parseNumber (handles decimals) and extractAllNumbers (handles fragmented obfuscation)
    // prefer larger result since partial parses always undercount
    const parseA = parseNumber(nearLeft)
    const parseB = parseNumber(nearRight)
    const extractLeftNums = extractAllNumbers(nearLeft)
    const extractRightNums = extractAllNumbers(nearRight)
    const extractA = extractLeftNums.length > 0 ? extractLeftNums[extractLeftNums.length - 1] : NaN
    const extractB = extractRightNums.length > 0 ? extractRightNums[0] : NaN
    // prefer unit-anchored numbers first: avoids counting structural words like "one claw" as operands
    // e.g. "one claw has twenty three neutrons +" → extractNumbersPrecedingUnits gives [23], not [1, 23]
    // use full left string (not nearLeft) so the 8-token window can't cut off the actual number:
    // e.g. "thirty two newtons and it engages in a dominance fight getting + fourteen" → 32+14=46
    // unit-anchoring (requires unit word immediately after) prevents false positives from "one claw" etc.
    const unitLeftNums = extractNumbersPrecedingUnits(left.trim())
    const unitRightNums = extractNumbersPrecedingUnits(nearRight)
    const unitA = unitLeftNums.length > 0 ? unitLeftNums[unitLeftNums.length - 1] : NaN
    const unitB = unitRightNums.length > 0 ? unitRightNums[0] : NaN
    // use unit-anchored number for left side only: avoids structural "one claw" accumulation in parseA
    // right side keeps existing logic — right operand may be a decimal (e.g. "4.5 m/s") where unitB is inaccurate
    // exception: for explicit * and ×, prefer the number nearest the operator (extractA from nearLeft)
    // e.g. "forty newtons and distance is two meters, torque = forty * two" → unitA=2 (two meters, last
    // unit-anchored in full left) but extractA=40 (the adjacent operand) — extractA is correct here
    const useNearestForMul = (sym === " * " || sym === " × ") && !isNaN(extractA)
    const a = useNearestForMul ? extractA : (!isNaN(unitA) ? unitA : ((!isNaN(extractA) && (isNaN(parseA) || extractA > parseA)) ? extractA : parseA))
    const b = (!isNaN(extractB) && (isNaN(parseB) || extractB > parseB)) ? extractB : parseB
    if (!isNaN(a) && !isNaN(b) && (a !== 0 || b !== 0)) {
      // for *, only trust parsed numbers if the original text had a "real" *:
      // a * preceded by space or digit (e.g. "forty * sixteen", "*6") vs letter noise ("ThReE*", "x*I")
      if (sym !== " * " || /[\s\d]\*/.test(text)) return fn(a, b).toFixed(2)
    }
    // * only attached to letters (no space/digit before any *) is pure obfuscation noise — skip
    if (sym === " * " && /[a-zA-Z]\*/.test(text) && !/[\s\d]\*/.test(text)) continue
  }

  // — question-keyword strategy (after operators, to avoid spurious number extraction from narrative) —
  // "strikes twice/thrice" → multiply the single force value
  for (const [word, mult] of [["twice", 2], ["thrice", 3]]) {
    if (/\btwice\b/.test(cleaned) && word === "twice" || /\bthrice\b/.test(cleaned) && word === "thrice" || soupHas(word)) {
      const unitNums = extractNumbersPrecedingUnits(cleaned)
      if (unitNums.length === 1) return (unitNums[0] * mult).toFixed(2)
      const nums = extractAllNumbers(cleaned)
      if (nums.length === 1) return (nums[0] * mult).toFixed(2)
    }
  }
  // "N simultaneous [actions]" → force × count (e.g. "force of 23 notons, seven simultaneous pushes, total force?")
  if (soupHas("simultaneous")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    const nums = extractAllNumbers(cleaned)
    if (unitNums.length === 1 && nums.length === 2) {
      const count = nums.find(n => Math.abs(n - unitNums[0]) > 0.001)
      if (count !== undefined) return (unitNums[0] * count).toFixed(2)
    }
    if (nums.length >= 2) return nums.reduce((a, b) => a * b, 1).toFixed(2)
  }
  // "N times" as trailing multiplier (e.g. "gains three times") — must check before 'total' keyword
  // handles "exerts X notons and gains N times" → X * N
  // also handles "X [unit] times Y" (e.g. "twenty three newtons times seven") → X * Y
  {
    const timesMatch = cleaned.match(/\b(\w+)\s+(t+i+m+e+s+)\b/)
    if (timesMatch) {
      const multiplier = parseNumber(timesMatch[1])
      if (!isNaN(multiplier) && multiplier >= 2 && multiplier <= 1000) {
        const unitNums = extractNumbersPrecedingUnits(cleaned)
        const baseNums = unitNums.filter(n => n !== multiplier)
        if (baseNums.length === 1) return (baseNums[0] * multiplier).toFixed(2)
        // fallback: no unit-anchored numbers (e.g. unit is abbreviation like "cm/s" not in UNIT_PATTERNS)
        // use all extracted numbers minus the multiplier itself
        if (baseNums.length === 0) {
          const allNums = extractAllNumbers(cleaned).filter(n => Math.abs(n - multiplier) > 0.001)
          if (allNums.length === 1) return (allNums[0] * multiplier).toFixed(2)
        }
      }
      // fallback: word before "times" is a unit word, not a number (e.g. "newtons times seven")
      // try the number AFTER "times" as the multiplier, and unit-anchored number as the base
      const timesEnd = cleaned.indexOf(timesMatch[0]) + timesMatch[0].length
      const afterTimes = cleaned.slice(timesEnd).trim().split(/\s+/).slice(0, 8).join(" ")
      const afterNum = parseNumber(afterTimes)
      if (!isNaN(afterNum) && afterNum >= 1) {
        const unitNums = extractNumbersPrecedingUnits(cleaned)
        if (unitNums.length >= 1) return (unitNums[0] * afterNum).toFixed(2)
        const allNums = extractAllNumbers(cleaned).filter(n => Math.abs(n - afterNum) > 0.001)
        if (allNums.length >= 1) return (allNums[0] * afterNum).toFixed(2)
      }
    }
    // no word directly before "times" (e.g. "25 newtons - times three") — find "times" keyword, use number after it
    if (!timesMatch && soupHas("times")) {
      const timesPos = cleaned.search(/\bt+i+m+e+s+\b/)
      if (timesPos >= 0) {
        const timesToken = cleaned.slice(timesPos).match(/\bt+i+m+e+s+\b/)
        if (timesToken) {
          const afterTimes = cleaned.slice(timesPos + timesToken[0].length).trim().split(/\s+/).slice(0, 8).join(" ")
          const afterNum = parseNumber(afterTimes)
          if (!isNaN(afterNum) && afterNum >= 2) {
            const unitNums = extractNumbersPrecedingUnits(cleaned)
            if (unitNums.length >= 1) return (unitNums[0] * afterNum).toFixed(2)
          }
        }
      }
    }
  }
  // "increases N foldly" / "N fold" → multiply (e.g. "swimming increases seven foldly" → base × 7)
  if (soupHas("fold") || soupHas("foldly")) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "X per [action], N [action]s, total" → rate × count (e.g. "twenty neotons per strike, three strikes")
  // must check before total keyword (which would otherwise add)
  // exclude "per second/minute/hour/meter" — those are unit rates, not operational "per"
  const perIsRate = /\bper\b/.test(cleaned) && !/\bper\s+(second|seconds|minute|minutes|hour|hours|meter|meters|metre|metres|kilogram|kilograms)\b/.test(cleaned) && !/(persec|permin|perhour|permeter|permetre)/.test(soup)
  // "each" + total/combined → multiply (e.g. "24 eye facets, each sprouts 6 neurons, how many total")
  const eachIsRate = /\beach\b/.test(cleaned) || soupHas("each")
  if ((perIsRate || eachIsRate) && (/\b(total|combined|sum|altogether)\b/.test(cleaned) || soupHas("total") || soupHas("combined"))) {
    const nums = extractAllNumbers(cleaned)
    // filter out tens sub-components that are prefix of a compound (e.g. 30 when 32 also extracted)
    // happens when obfuscation splits "thirty two" as ["th","irrty"] + "thirty two" → [30, 32]
    const filtered = nums.filter((n, _, arr) =>
      !(n >= 10 && n < 100 && n % 10 === 0 && arr.some(m => m > n && m - n < 10))
    )
    const useNums = filtered.length >= 2 ? filtered : nums
    if (useNums.length >= 2) return useNums.reduce((a, b) => a * b, 1).toFixed(2)
  }
  // "multiplied/multiplies by" with obfuscation — must check before 'total' keyword
  // also catches "multiplys" soup variant (obfuscated "multiplies" with ie→y substitution)
  if (soupHas("multiplied") || soupHas("multiplies") || soupHas("multiply") || soupHas("multiplier")) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "how much total" / "combined" / "sum" → add all numbers found
  // prefer unit-anchored extraction to avoid counting structural numbers ("one claw")
  if (/\b(total|combined|sum|altogether)\b/.test(cleaned) || soupHas("total") || soupHas("combined")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    // "total X*Y" in question clause: * between identifier names → multiply
    // e.g. "force is thirty newtons, growth is five cm, like total force*growth?" → 30 × 5 = 150
    const lastCommaIdx = cleaned.lastIndexOf(",")
    const questionClause = lastCommaIdx >= 0 ? cleaned.slice(lastCommaIdx) : cleaned.slice(-60)
    if (/ \* /.test(questionClause)) {
      if (unitNums.length >= 2) return unitNums.reduce((a, b) => a * b, 1).toFixed(2)
      const allNums = extractAllNumbers(cleaned)
      if (allNums.length === 2) return (allNums[0] * allNums[1]).toFixed(2)
    }
    if (unitNums.length >= 2) return unitNums.reduce((a, b) => a + b, 0).toFixed(2)
    const nums = extractAllNumbers(cleaned)
    // one unit-anchored value (force) + one non-unit count → multiply
    // e.g. "claw exerts 26 newtons, has three claws, total force?" → 26 × 3 = 78
    // e.g. "exerts thirty newtons, there are two claws, total force?" → 30 × 2 = 60
    // e.g. "three lobsters share this force of twenty newtons, total force?" → 20 × 3 = 60
    // only when count context is present ("has N", "there are N", "each", or "share") — otherwise treat as two measurements
    // "other" signals same unit type (e.g. "the other claw has twelve [newtons]") — don't multiply
    if (unitNums.length === 1 && nums.length === 2 && !soupHas("other") && (soupHas("has") || eachIsRate || soupHas("are") || soupHas("together") || soupHas("share"))) {
      const count = nums.find(n => Math.abs(n - unitNums[0]) > 0.001)
      if (count !== undefined) return (unitNums[0] * count).toFixed(2)
    }
    // "the other claw is [N]" pattern where N lacks an explicit unit: sum the unit-anchored value with the first number after "other"
    // e.g. "claw force is thirty two newtons ~ and the other claw is fourteen fourteen? ... how many newtons total" → 32+14=46
    // prevents spurious numbers (like descriptive "thirty lobster") from inflating the sum
    if (unitNums.length === 1 && soupHas("other")) {
      const otherIdx = cleaned.indexOf('other')
      if (otherIdx >= 0) {
        const otherNums = extractAllNumbers(cleaned.slice(otherIdx))
        if (otherNums.length >= 1) return (unitNums[0] + otherNums[0]).toFixed(2)
      }
    }
    if (nums.length >= 2) return nums.reduce((a, b) => a + b, 0).toFixed(2)
    // single number: no count or second force given — just return the one value
    if (nums.length === 1) return nums[0].toFixed(2)
  }
  // "difference" / "water/air resistance" / "slows by" / "reduces" / "decreases" / "subtracts" / "takes away" / "remain" → subtract
  // "opposing" only signals subtraction when "net" is also present (e.g. "net force") — without "net", opposing can appear in addition problems ("if they add")
  // soup-based match handles obfuscation that splits words (e.g. "SlO^wS" → "slo ws")
  if (/\b(difference|how much more|how much less|how much remain|left over|remaining)\b/.test(cleaned)
      || /waterresistance|airresistance/.test(soup)
      || /slows?|reduces?|decreases?|decelerats?|loses?|loss|resists?|subtracts?|takesaway/.test(soup)
      || (/opposing/.test(soup) && /net/.test(soup))
      || soupHas("remaining") || soupHas("remain") || soupHas("takesaway") || soupHas("loses") || soupHas("slows") || soupHas("reduces") || soupHas("reducing") || soupHas("decreases") || soupHas("resists") || soupHas("subtracts")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    if (unitNums.length === 2) return Math.abs(unitNums[0] - unitNums[1]).toFixed(2)
    // 3+ unit-anchored numbers: find "by [N unit]" to isolate the delta (e.g. "slows down by 7 m/s" with noise "6 newtons")
    if (unitNums.length >= 3) {
      const tokens = cleaned.split(/\s+/)
      const byIdx = tokens.findIndex(t => t.replace(/[^a-z]/g, '') === 'by')
      if (byIdx !== -1) {
        const afterBy = tokens.slice(byIdx + 1).join(' ')
        const afterByNums = extractNumbersPrecedingUnits(afterBy)
        if (afterByNums.length > 0) return Math.abs(unitNums[0] - afterByNums[0]).toFixed(2)
      }
    }
    const nums = extractAllNumbers(cleaned)
    // when we have one unit-anchored speed, use it as base and find delta as last non-speed number
    // avoids false delta from noise numbers (e.g. "twenty two three cm/s, reduces by seven" → speed=22, delta=7, not |22-3|=19)
    if (unitNums.length === 1 && nums.length >= 2) {
      const speed = unitNums[0]
      const delta = [...nums].reverse().find(n => Math.abs(n - speed) > 0.001)
      if (delta !== undefined) return Math.abs(speed - delta).toFixed(2)
    }
    if (nums.length >= 2) return Math.abs(nums[0] - nums[1]).toFixed(2)
  }
  // "how far" / "how much distance" → distance = speed × time (multiply)
  if (/\bhow\s+far\b/.test(cleaned) || soupHas("howfar") || /\bdistance\b/.test(cleaned)) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "torque" → force × lever arm distance (multiply)
  if (soupHas("torque")) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "impulse" / "energy" → force × time or force × distance (multiply)
  if (soupHas("impulse") || soupHas("energy")) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "momentum" → mass × velocity (multiply)
  if (soupHas("momentum")) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "power" → force × velocity (multiply)
  // e.g. "claw force of 23 newtons, swims at 7 meters per second, how much power?" → 23×7=161
  if (soupHas("power")) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "work done" → force × distance (multiply)
  // e.g. "exerts thirty two nootons and pushes over two meters, how much work done?" → 32×2=64
  if (soupHas("work") && soupHas("done")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    if (unitNums.length >= 2) return (unitNums[0] * unitNums[1]).toFixed(2)
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return (nums[0] * nums[1]).toFixed(2)
  }
  // "product" / "multiply" / "how much total if each" → multiply
  // prefer unit-anchored extraction to avoid counting structural words like "the two forces"
  if (/\b(product|each|per item|per prey)\b/.test(cleaned) || soupHas("product") || soupHas("multiply")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    if (unitNums.length >= 2) return unitNums.reduce((a, b) => a * b, 1).toFixed(2)
    const nums = extractAllNumbers(cleaned)
    if (nums.length >= 2) return nums.reduce((a, b) => a * b, 1).toFixed(2)
  }

  // "what is acceleration" with force + mass context → a = F/m (divide)
  // e.g. "force is 24 newtons, mass of 3 kilograms, what is acceleration?" → 24/3 = 8.00
  // must check before the velocity/accelerates handler which would add instead of divide
  if (soupHas("acceleration") && (soupHas("mass") || soupHas("kilogram"))) {
    const nums = extractAllNumbers(cleaned)
    if (nums.length === 2) {
      // find force value: number before a newton-like unit
      const forceVal = extractNumberBeforeUnitType(cleaned, FORCE_UNIT_PATTERNS)
      const massVal = extractNumberBeforeUnitType(cleaned, MASS_UNIT_PATTERNS)
      if (forceVal !== null && massVal !== null && massVal !== 0) return (forceVal / massVal).toFixed(2)
      // fallback: first number / second number (force stated first typically)
      if (nums[1] !== 0) return (nums[0] / nums[1]).toFixed(2)
    }
  }

  // "velocity change?" / "force change?" → asking for the delta, not the total
  // e.g. "claw force is 25 nootons, three after molting, velocity change?" → 3
  if (soupHas("change")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    const allNums = extractAllNumbers(cleaned)
    if (unitNums.length >= 1 && allNums.length >= 2) {
      // the base is the unit-anchored number; the delta is the other number
      const delta = allNums.find(n => Math.abs(n - unitNums[0]) > 0.001)
      if (delta !== undefined) return delta.toFixed(2)
    }
    if (allNums.length === 2) return Math.abs(allNums[1] - allNums[0]).toFixed(2)
  }

  // "velocity doubled/doubles [by N]" → new velocity = old velocity × N (or ×2 if N absent)
  // "doubled by two" means the velocity is doubled (×2), not incremented by 2
  if (soupHas("doubled") || soupHas("doubles")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    const allNums = extractAllNumbers(cleaned)
    const speed = unitNums.length >= 1 ? unitNums[0] : allNums[0]
    if (!isNaN(speed)) {
      // look for a multiplier after "doubled by"
      const doubledByMatch = cleaned.match(/doubled\s+by\s+(\w+)/)
      if (doubledByMatch) {
        const multiplier = parseNumber(doubledByMatch[1])
        if (!isNaN(multiplier) && multiplier >= 1) return (speed * multiplier).toFixed(2)
      }
      return (speed * 2).toFixed(2)
    }
  }

  // "velocity"/"accelerates by" → new velocity = old velocity + delta
  // handles "swims at X meters per second and accelerates by Y, new velocity?"
  // uses unit-anchored extraction for the speed (number before "meters per second")
  // and the last non-speed number as the delta
  if (soupHas("velocity") || soupHas("accelerates") || soupHas("accelerate") || soupHas("increases")) {
    const unitNums = extractNumbersPrecedingUnits(cleaned)
    const allNums = extractAllNumbers(cleaned)
if (unitNums.length >= 1) {
      const speed = unitNums[0]
      // delta is the last number that isn't the speed (the "by Y" at end of "accelerates by Y")
      const delta = [...allNums].reverse().find(n => Math.abs(n - speed) > 0.001)
      if (delta !== undefined) return (speed + delta).toFixed(2)
    }
    if (allNums.length === 2) return (allNums[0] + allNums[1]).toFixed(2)
    // fallback: when unit-anchored extraction fails (e.g. unit split across tokens like "cem timeters"),
    // find speed as last number before "per", delta as first number after "by"
    {
      const toks = cleaned.split(/\s+/).filter(Boolean)
      const perIdx = toks.findIndex(t => /^p+e+r+$/.test(t))
      const byIdx = toks.findLastIndex(t => /^b+y+$/.test(t))
      if (perIdx > 0) {
        const speedCandidates = extractAllNumbers(toks.slice(0, perIdx).join(' '))
        if (speedCandidates.length > 0) {
          const speed = speedCandidates.at(-1)
          if (byIdx > perIdx) {
            const deltaCandidates = extractAllNumbers(toks.slice(byIdx + 1).join(' '))
            if (deltaCandidates.length > 0) return (speed + deltaCandidates[0]).toFixed(2)
          }
          const delta = [...allNums].reverse().find(n => Math.abs(n - speed) > 0.001)
          if (delta !== undefined) return (speed + delta).toFixed(2)
        }
      }
    }
  }

  // — fallback: if exactly two numbers, add them —
  const nums = extractAllNumbers(cleaned)
  if (nums.length === 2) return (nums[0] + nums[1]).toFixed(2)

  throw new Error(`could not solve challenge: ${text}`)
}

// unit word patterns (with duplicate-letter tolerance) for force/physics questions
const UNIT_PATTERNS = [
  'nootons','newtons','neutons','neetons','neotons','nooton','newton','neuton','neeton','neoton','notons','noton',  // force (newtons)
  'centimeters','centimeter','centimetre','centimetres',                       // distance/velocity
  'meters','meter','metres','metre',
  'kilometers','kilometer','kilometres','kilometre',
  'seconds','second','kilograms','kilogram',
]
  .map(w => new RegExp('^' + w.split('').map(c => `${c}+`).join('') + '$'))

// subset patterns for F=ma disambiguation
const FORCE_UNIT_PATTERNS = [
  'nootons','newtons','neutons','neetons','neotons','nooton','newton','neuton','neeton','neoton','notons','noton',
].map(w => new RegExp('^' + w.split('').map(c => `${c}+`).join('') + '$'))

const MASS_UNIT_PATTERNS = [
  'kilograms','kilogram',
].map(w => new RegExp('^' + w.split('').map(c => `${c}+`).join('') + '$'))

// try to match tokens[startIdx..startIdx+size) as a single number value
// returns [value, tokensConsumed] or null
// common English non-number words that fuzzy passes might mis-match (e.g. "there" → "three")
const FUZZY_STOP_WORDS = new Set(["there", "their", "these", "those", "where", "here", "were", "ther", "other", "another", "then"])

function matchNumberChunk(tokens, wordsSorted, startIdx) {
  // four-pass approach to prefer exact multi-token matches over fuzzy single-token matches:
  //   pass 0: exact patterns only, no skip (strictest)
  //   pass 1: exact + alt patterns, with skip (handles first-char substitution)
  //   pass 2: all patterns including tolerant, with skip (handles mid-word insertions)
  //   pass 3: anagram match (handles transposed chars like "trhee" = "three")
  //   pass 4: single-char substitution (handles e.g. "fourleen" → "fourteen", l→t)
  // this prevents e.g. "twen" matching "ten" (via alt/tolerant) from beating ["twen","ty"] = "twenty"
  for (let pass = 0; pass <= 5; pass++) {
    let bestMatch = null
    for (let size = 1; size <= Math.min(4, tokens.length - startIdx); size++) {
      const soup = tokens.slice(startIdx, startIdx + size).join("").replace(/[^a-z]/g, "")
      if (!soup) continue
      // passes 2+ (fuzzy/tolerant/anagram/subst): skip common English words that are not numbers
      // e.g. "there" → "three" false-positive in tolerant pass
      if (pass >= 2 && FUZZY_STOP_WORDS.has(soup)) continue

      // pass 3: anagram match — handles transposed/substituted chars (e.g. "trhee" = "three")
      // also handles multi-token windows where spaces split a number word
      // (e.g. "tW]eNnY" → "tw"+"enny" = "twenny" → anagram of "twenty")
      // (e.g. "tW eN nY" → "tw"+"en"+"ny" = "twenny" → anagram of "twenty")
      // collapse runs then sort; e.g. "trhee" → "trhe" → "ehrt", "three" → "thre" → "ehrt"
      if (pass === 3) {
        if (size > 3) continue
        // full unique-char sort (not just consecutive dedup) to handle cases like
        // "twenny" (t,w,e,n,n,y → unique: entwy) matching "twenty" (t,w,e,n,t,y → unique: entwy)
        const soupSorted = [...new Set(soup)].sort().join("")
        for (const word of wordsSorted) {
          // skip short words (≤4 chars) — they have too many anagram false positives
          // e.g. "net" is an anagram of "ten", "won" of "own", etc.
          if (word.length <= 4) continue
          const wordSorted = [...new Set(word)].sort().join("")
          if (soupSorted === wordSorted) {
            // reject if soup is too long: extra chars must be explainable by repeated chars in word
            // e.g. "neeo" (4) vs "one" (3, 0 repeats) → diff=1 > 0, reject
            // e.g. "trheee" (6) vs "three" (5, 1 repeat: e) → diff=1 ≤ 1, accept
            // also reject if soup is too SHORT relative to the word (prevents e.g. "iten" matching "nineteen")
            // e.g. "iten" (4) vs "nineteen" (8): 4*2=8 is NOT > 8, reject
            // also reject if soup is shorter than word: can't form an anagram of a longer word
            // e.g. "tsseven" (7) should not match "seventeen" (9) even if unique chars match
            const repeatsInWord = word.length - [...new Set(word)].length
            if (soup.length >= word.length && Math.abs(soup.length - word.length) <= repeatsInWord && soup.length * 2 > word.length) {
              return [NUMBER_WORDS[word], size]
            }
          }
        }
        continue
      }

      // pass 4: single-char substitution — handles e.g. "fourleen" → "fourteen" (l substitutes t)
      // requires same vowel/consonant class for the substituted char to avoid false positives
      // like "fight" → "eight" (f=consonant, e=vowel)
      if (pass === 4) {
        if (size > 2) continue
        const VOWELS = "aeiou"
        const soupDedup = soup.replace(/(.)\1+/g, "$1")
        for (const word of wordsSorted) {
          if (word.length <= 4) continue
          const wordDedup = word.replace(/(.)\1+/g, "$1")
          if (soupDedup.length !== wordDedup.length) continue
          let diffs = 0, ok = true
          for (let i = 0; i < soupDedup.length; i++) {
            const sc = soupDedup[i], wc = wordDedup[i]
            if (!new RegExp(`^${charPat(wc)}$`).test(sc)) {
              if (VOWELS.includes(sc) !== VOWELS.includes(wc)) { ok = false; break }
              diffs++
              if (diffs > 1) { ok = false; break }
            }
          }
          if (ok && diffs === 1) return [NUMBER_WORDS[word], size]
        }
        continue
      }

      // pass 5: tolerant single-token — handles one noise char inserted between required letters
      // e.g. "foolur" → "four" (extra 'l' inserted between 'o' and 'u')
      // uses .? between each charPat to absorb one optional noise char between letters
      if (pass === 5) {
        if (size !== 1) continue
        if (FUZZY_STOP_WORDS.has(soup)) continue
        for (const word of wordsSorted) {
          if (word.length < 3) continue
          const tolPat = new RegExp("^" + word.split("").map(charPat).join(".?") + "$")
          if (tolPat.test(soup)) return [NUMBER_WORDS[word], 1]
        }
        continue
      }

      // allow skipping prefix garbage chars for single tokens only (obfuscation like "sirrthirty" = "thirty")
      // multi-token windows already handle cross-token splits, so skip would cause false positives
      // only allow skip in passes 1+ to prefer exact no-skip matches first
      const maxSkip = (pass >= 1 && size === 1) ? Math.min(Math.floor(soup.length / 2), 5) : 0
      for (let skip = 0; skip <= maxSkip; skip++) {
        let pos = skip, current = 0, total = 0, found = false
        while (pos < soup.length) {
          let wordMatched = false
          for (const word of wordsSorted) {
            const pattern = new RegExp("^" + word.split("").map(charPat).join(""))
            const m = soup.slice(pos).match(pattern)
            // skip short words (≤4 chars) when using prefix-skip (skip > 0):
            // prevents false positives like "antenn" → skip "an" → "tenn" = "ten"
            // short words need no skip since their obfuscated forms are short tokens anyway
            if (skip > 0 && word.length <= 4) continue
            // also try with first char substituted (handles e.g. "hhree" → "three" where "t" is replaced)
            // only in passes 1+, and only for single-token windows (size === 1):
            // multi-token altPattern causes false positives like "e" + "ne" → "ene" → "one"
            // only for words length > 4: short words (ten/six/one/nine/five/four) have too many
            // false positives e.g. "cen" (from "centimeters") → "ten" via ^.e+n+
            const altPattern = pass >= 1 && word.length > 4 && size === 1
              ? new RegExp("^." + word.slice(1).split("").map(charPat).join(""))
              : null
            // alt pattern only at skip=0: combining skip+alt causes false positives
            // e.g. "then" → skip 't' → alt-match 'hen' as "ten"
            // also require same vowel/consonant class for the substituted first char:
            // prevents "fight" → "eight" (f=consonant, e=vowel) while allowing "hhree" → "three" (h,t both consonants)
            const VOWELS = "aeiou"
            const amRaw = !m && altPattern && skip === 0 ? soup.slice(pos).match(altPattern) : null
            const am = amRaw && (VOWELS.includes(soup[pos]) === VOWELS.includes(word[0])) ? amRaw : null
            // tolerant pattern: allow single inserted char between character groups
            // handles mid-word insertions like "thrirty" → "thirty" (extra 'r' after 'h')
            // only in pass 2
            // tolerant only for longer words: short words (≤4 chars) like "ten" → "then" false-positive
            const tolPattern = !m && !am && pass >= 2 && word.length > 4
              ? new RegExp("^" + word.split("").map(charPat).join(".??"))
              : null
            const tm = tolPattern ? soup.slice(pos).match(tolPattern) : null
            const match = m || am || tm
            if (match) {
              const val = NUMBER_WORDS[word]
              if (val === 1000 || val === 1000000) { current = current || 1; total += current * val; current = 0 }
              else if (val === 100) { current = (current || 1) * 100 }
              else {
                // once units digit is set, stop — can't add more units without hundred/thousand
                // prevents "fourteen"+"fourteen"=28 in multi-token soup windows
                if (found && current % 10 !== 0) break
                // prevent stacking two round tens within a window (e.g. "twenettyy"+"twenty" = 40)
                // "twenty twenty" is not valid English for 40 — the first "twenty" is obfuscation noise
                // hundreds are excluded (current < 100) so "one hundred twenty" still works
                if (found && current >= 10 && current < 100 && current % 10 === 0 && val >= 10 && val < 100) break
                current += val
              }
              pos += match[0].length; found = true; wordMatched = true; break
            }
          }
          if (!wordMatched) break
        }
        if (found && pos === soup.length) {
          const candidate = [total + current, size]
          // prefer higher value (e.g. "fouurr"+"teeeeenn"=14 over "fouurr"=4)
          // same value: prefer smaller size to avoid consuming extra tokens (e.g. "fourteen"+"n" → keep size=1)
          if (bestMatch === null || candidate[0] > bestMatch[0] || (candidate[0] === bestMatch[0] && candidate[1] < bestMatch[1])) {
            bestMatch = candidate
          }
          break  // stop trying more skips for this size; continue to next size
        }
      }
    }
    if (bestMatch !== null) return bestMatch
  }
  return null
}

// check if the tokens at idx..idx+2 form a unit word (nootons/newtons/etc.)
function isUnitTokenAt(tokens, idx) {
  for (let size = 1; size <= Math.min(3, tokens.length - idx); size++) {
    const soup = tokens.slice(idx, idx + size).join('').replace(/[^a-z]/g, '')
    if (soup && UNIT_PATTERNS.some(p => p.test(soup))) return true
  }
  return false
}

// extract all number values from text — token-aware soup matching
// works token-by-token (whitespace-delimited) to respect word boundaries:
// "physics" will NOT extract "six" since it can't fully consume the token as number words
function extractAllNumbers(text) {
  const results = []

  // digit literals first
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    results.push(parseFloat(m[0]))
  }

  // split into whitespace-delimited tokens, match windows of 1-3 adjacent tokens
  // as a complete number word (all chars in the window must be consumed)
  // window-based approach: handles obfuscation split across tokens ("ThIr Ty" → "thirty")
  // while still rejecting embedded numbers ("phyysixsy" ≠ "six" — unmatched chars)
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean)
  const wordsSorted = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length)

  let i = 0
  while (i < tokens.length) {
    let numPos = i, current = 0, total = 0, found = false
    while (numPos < tokens.length) {
      let match = matchNumberChunk(tokens, wordsSorted, numPos)
      if (match === null) {
        // allow skipping up to two garbage tokens when building a compound number (e.g. "twenty [g] three")
        // only when we have a clean tens partial (20/30/.../90) and the next token is a smaller units value
        // this handles first-char-substituted single-char tokens like "G" in "tW/eNnTy G hHrEe"
        // also handles cases like "twenty ghh treee] three" where two tokens separate tens and units
        if (found && current > 0 && current % 10 === 0 && current < 100) {
          for (let skip = 1; skip <= 2 && numPos + skip < tokens.length; skip++) {
            // don't skip over unit tokens — they delimit separate numbers (e.g. "twenty newtons and three lobsters")
            const skipTokenSoup = tokens[numPos + skip - 1]?.replace(/[^a-z]/g, "") ?? ""
            if (UNIT_PATTERNS.some(p => p.test(skipTokenSoup))) break
            const nextMatch = matchNumberChunk(tokens, wordsSorted, numPos + skip)
            if (nextMatch !== null && nextMatch[0] > 0 && nextMatch[0] < current) {
              numPos += skip // skip garbage token(s)
              match = nextMatch
              break
            }
          }
        }
        if (match === null) break
      }
      const [val, size] = match
      if (val === 1000 || val === 1000000) { current = current || 1; total += current * val; current = 0 }
      else if (val === 100) { current = (current || 1) * 100 }
      else {
        // once units digit is set (e.g. current=27), stop — can't add more units without hundred/thousand
        // prevents "twenty seven cen(timeters)" from accumulating to 37 via "cen" → "ten"
        if (found && current % 10 !== 0) break
        // prevent stacking two round tens (e.g. "twenty twenty three" = 43 when speed is "twenty-three" = 23)
        // "twenty twenty" is not valid English for 40 — it's obfuscation noise before "twenty three"
        // hundreds are excluded (current < 100) so "one hundred twenty" still works
        if (found && current >= 10 && current < 100 && current % 10 === 0 && val >= 10 && val < 100) break
        current += val
      }
      found = true; numPos += size
    }
    if (found) {
      const num = total + current
      if (num > 0 && !results.some(r => Math.abs(r - num) < 0.001)) results.push(num)
      i = numPos
    } else {
      i++
    }
  }

  return results
}

// like extractAllNumbers but only returns numbers that are immediately followed by a unit word
// used for "total force" questions to avoid counting structural numbers like "one claw"
function extractNumbersPrecedingUnits(text) {
  const results = []
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean)
  const wordsSorted = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length)

  let i = 0
  while (i < tokens.length) {
    let numPos = i, current = 0, total = 0, found = false
    while (numPos < tokens.length) {
      const match = matchNumberChunk(tokens, wordsSorted, numPos)
      if (match === null) break
      const [val, size] = match
      if (val === 1000 || val === 1000000) { current = current || 1; total += current * val; current = 0 }
      else if (val === 100) { current = (current || 1) * 100 }
      else {
        if (found && current >= 10 && current < 100 && current % 10 === 0 && val >= 10 && val < 100) break
        current += val
      }
      found = true; numPos += size
    }
    if (found) {
      const num = total + current
      // also check numPos+1 for unit: handles dangling trailing-letter tokens (e.g. "fiv" + "e" + "newtons")
      // where the last letter of an obfuscated word split off as its own token
      const danglingToken = numPos < tokens.length ? tokens[numPos].replace(/[^a-z]/g, '') : ''
      const unitAt = isUnitTokenAt(tokens, numPos) || (danglingToken.length <= 2 && /^[a-z]+$/.test(danglingToken) && isUnitTokenAt(tokens, numPos + 1))
      if (num > 0 && unitAt && !results.some(r => Math.abs(r - num) < 0.001)) results.push(num)
      i = numPos
    } else {
      i++
    }
  }

  return results
}

// extract the first number preceding a specific unit type (e.g. force units vs mass units)
function extractNumberBeforeUnitType(text, unitPatterns) {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean)
  const wordsSorted = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length)
  const isTargetUnit = (toks, idx) => {
    for (let size = 1; size <= Math.min(3, toks.length - idx); size++) {
      const soup = toks.slice(idx, idx + size).join('').replace(/[^a-z]/g, '')
      if (soup && unitPatterns.some(p => p.test(soup))) return true
    }
    return false
  }
  let i = 0
  while (i < tokens.length) {
    let numPos = i, current = 0, total = 0, found = false
    while (numPos < tokens.length) {
      const match = matchNumberChunk(tokens, wordsSorted, numPos)
      if (match === null) break
      const [val, size] = match
      if (val === 1000 || val === 1000000) { current = current || 1; total += current * val; current = 0 }
      else if (val === 100) { current = (current || 1) * 100 }
      else { current += val }
      found = true; numPos += size
    }
    if (found) {
      const num = total + current
      if (num > 0 && isTargetUnit(tokens, numPos)) return num
      i = numPos
    } else { i++ }
  }
  return null
}

export const FETCH_TIMEOUT_MS = 30_000

// — api call with auto-verify retry —
export async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${BASE}${path}`, opts)
  const data = await res.json()

  // handle verification challenge
  if (data?.comment?.verification || data?.post?.verification || data?.verification) {
    const v = data.comment?.verification ?? data.post?.verification ?? data.verification
    process.stderr.write(`[verify] challenge: ${v.challenge_text}\n`)
    const answer = solveChallenge(v.challenge_text)
    process.stderr.write(`[verify] answer: ${answer}\n`)
    const verified = await fetch(`${BASE}/verify`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ verification_code: v.verification_code, answer }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then(r => r.json())

    if (!verified.success) throw new Error(`verification failed: ${JSON.stringify(verified)}`)

    // retry original request
    return api(method, path, body)
  }

  return data
}
