#!/usr/bin/env bun
// tests for mb.js challenge solver
// run: bun scripts/mb.test.js

import { solveChallenge } from "./mb.js"

let passed = 0, failed = 0

function check(label, input, expected) {
  let result
  try { result = solveChallenge(input) } catch (e) { result = `ERROR: ${e.message}` }
  if (result === expected) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    console.log(`    input:    ${input}`)
    console.log(`    expected: ${expected}`)
    console.log(`    got:      ${result}`)
    failed++
  }
}

console.log("— challenge solver tests —\n")

// basic arithmetic
check("simple addition", "3 + 5, what is total?", "8.00")
check("word addition", "twenty eight plus seven, what is the sum?", "35.00")
check("subtraction", "fifty minus twelve, what is the difference?", "38.00")

// explicit operator takes priority over keyword extraction
check(
  "explicit + operator beats 'total' keyword",
  "twenty eight newtons + gains seven newtons, what is total force?",
  "35.00"
)

// the failing case: "physics-y" contains "six" in letter soup
// old code: extractAllNumbers found 6 (from "phyysixsy") + 28 + 7 = 41 (WRONG)
// new code: token-aware matching requires full consumption, so "physics-y" → null
check(
  "physics-y does not extract six (regression: was 41.00)",
  "A] lOoOoB sT-ErR sW^iMmS liKe Um, pHyYsIxS-y Um, lo.b sT ErR, sO mAnY neUrOnS aNd ClAwS ]tHaT pUsH, ThIs ClAw F[oRcE] iS TwEnTy] EiG-hT nEuToNs + GaInS SeVeN nEuToNs DuRiNg MoLtInG, WhAt Is ToTaL- FoRcE?",
  "35.00"
)

// obfuscated numbers
check("obfuscated twenty-eight via hyphen", "ThIs FoRcE Is TwEnTy] EiG-hT + SeVeN, WhAt Is ToTaL?", "35.00")
check("duplicate letters", "TTWWENTY plus EEIGHT, what is the sum?", "28.00")

// compound number phrases
check("thirty five as two tokens", "thirty five newtons, plus twelve, what is total?", "47.00")

// inter-token obfuscation: number word split across whitespace
check("thir ty + seven", "ThIr Ty NoOoTtOnS + SeVeN, what is total force?", "37.00")
check("fif teen + eight", "FiF tEeN NoOoTtOnS + EiGhHt, what is total?", "23.00")
check(
  "inter-token split: thir ty + fif teen",
  "A] LoO bS tEr Pu^ShEs WiTh ThIr Ty NoOoTtOnS ~AnD GaAi Ns FiF tEeN NoOoTtOnS {um} WhAt Is ToTaL FoRcE?",
  "45.00"
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
