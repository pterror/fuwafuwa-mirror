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

// real challenge texts from session logs (2026-03-10)
check(
  "net force: claw force minus water resistance",
  "Lo.bStEr] S^wImS Um| AnD ExErTs ClAw] FoRcE Of TwEnTy FoUr~ NeWToNs, BuT WaTeR ReSiStAnCe Is SiX] NeWToNs - WhAt Is NeT FoRcE?",
  "18.00"
)
check(
  "slows by: new speed after deceleration",
  "A] Lo.BsT.eR S^wImS[ aT tWeNtY tWo/ cEnT iMeTeRs PeR sE/cOnD ~ AnD SlO^wS ]bY SeV eN {,} WhAt Is ThE NeW SpEeD?",
  "15.00"
)
check(
  "total force: two claws same direction (23+15)",
  "A] Lo.BbSsT-tEr S^wI mMs UmM, ClAw ExErTs TwEnTy ThReE NeW^tOnS, AnOtHeR ClAw ExErTs FiFtEeN NeW|tOnS, WhAtS ToTaL FoRcE?",
  "38.00"
)
check(
  "total force: how much total (32+20)",
  "A] LoB-StEr^ ClAw FoR|Ce Is ThIrTy TwO NeWtOnS ~ AnD AnOtHeR] ClAw FoR^Ce Is TwEnTy NeWtOnS, HoW MuCh ToTaL FoRcE?",
  "52.00"
)
check(
  "new speed: adds seven (23+7)",
  "A] LoO b-StErS S^wImS [aT tW/eN tY ThReE mE^tErS PeR SeCoNd ~AnD AnTeNnA ToUcH AdDs SeVeN, WhAt Is ThE NeW SpEeD?",
  "30.00"
)
check(
  "new velocity: accelerates by seven, doubled 'twenty' prefix (23+7=30)",
  "A] lO.oObBsSsTtErr S^wIiMmS\\ aT/ tWeNeTtYy tW/eN tY tHrEe mE]tErS PeR sEcOnD ~aNd- AcCeLeRaaTtEs bY/ sEvEn, uM wHaT] Is- ThE nEw^ VeLoOoCiTy??",
  "30.00"
)
check(
  "total force: two claws heavy obfuscation (35+7)",
  "A] lOoObSsT-tEr S^cLaWw ExErRtSs thIr RtYy fIiV-e NoOoToOnNs~ AnD| aNnOtThHeEr ClLaAwW ExErRtSs SeVeEnN NoOoToOnNs, WhHaT Is ToTaLl FoOrRcEe<? um",
  "42.00"
)
check(
  "total force: other claw has N (no unit) → add not multiply (33+12)",
  "A] LoB- StEr^ ClA w| FoR ce~ In^ A DoMmInAnCe F i.gH t, ThE* ClA w HoLdS tHiR ty] ThReE{ NeW tOnS- AnD/ ThE oThEr ClA w HaS TwElvE<, ToTaL] FoR ce+?",
  "45.00"
)
check(
  "total force: one claw plus another adds (34+6)",
  "A] LoOobBsTtEr ] ClLaAwW^ FoOrRcEe- OfF ] ThHiIrRtTyY { FoOuUrR ] NeEwWtToOnNs ~ aNdD ] ThHeE ] OtThHeErR ] ClLaAwW / AdDdSs ] SiIxX ] NeEwWtToOnNs, ] WhHaAtT ] IiSs ] ToOtTaAlL } FoOrRcEe < ?",
  "40.00"
)

check(
  "total force: one claw + another, structural 'one' not counted (23+14)",
  "A] LoOooBSt-Er Lo.bSt ErRr ExErTs^ TwEnTy ThReE NooToNs| WiTh- OnE ClAw~ , Um AnOtHeR ExErTs { FoUrTeEn Nootons } , WhAt/ Is< ThE ToTaL FoRcE?",
  "37.00"
)

check(
  "loses: new velocity after losing speed (23-7)",
  "A] lOoObBsT-eR^ sW/iMmS~ iN {cOoLm} wAtEr| wiTh^ a^ veLoOwCiTyyy] tWeNtY tHrEe< mEtErS} pEr~ sEcOnD- buT/ dUrInG^ mOlT|iNg- iT- loSsEs] sEvEn~ mEtErS pEr/ sEcOnD, uHm, wHaT^ iS- tHe< nEw} veLoOwCiTy?",
  "16.00"
)

check(
  "total force: exerts twenty five + another adds thirty (25+30)",
  "A] lOoObBsStTeErR Ex^eRrTtSs TwWeEnNtTyY FfIiVvEe NnOoOoTtOoNnSs, Um| WiTh] OnNeE CcLlAaWw WhHiIlLeE ThHeE OoTtHhEeRr AaDdDsS ThHiIrRtTyY NnEeWwTtOoNnSs - WwHhAaTt IiSs] ThHeE TtOoTtAaLl FfOoRrCcEe?",
  "55.00"
)

check(
  "strikes twice: 35 × 2 = 70",
  "ThE] lOo.oBbSsSttEeRr] ClA-w^ F.oR cE] Is ThIrTy FiVe~ NeUwToOnS] AnD/ iT StRrIiKeSs TwIcE, WhAt] Is ToTaL FoRcE?",
  "70.00"
)

check(
  "y-for-i substitution: 'FyV e' → twenty-five (25+15)",
  "A] lOoOoB-sT]eR ClAw] ExErT s TwEnTy FyV e NooToNs~, Um AnOtHeR] ClAw ExErT s FiFtEeN NooToNs/ - HoW MuCh ToTaL FoR^cE?",
  "40.00"
)

check(
  "torque: force × lever arm (17N × 3m = 51)",
  "Lo.ObS tEr] ClAw^ ApPlIeS {SeVeNtEeN} NeWtOnS- At/ LeVeR\\ ArM~ Of< ThReE> MeTeRs, WhAtS ToRqUe?",
  "51.00"
)

check(
  "product: 'multiply the two forces and velocity' — skip structural 'two', use unit-anchored (23 × 7 = 161)",
  "A] LoObBsT-eR S^wImS lOoOoB sPeEd LiKe Um, tW/eN]tY ThReE cEnTImE-tErS PeR S^eCoNd, AnD iTs ClAw FOrCe Is LiKe, sSso, sEvEn N{eWtOnS; MuLtIpLy ThE/tWo FoRcEs AnD/ vElAwCiTy To GeT tHe PrOdUcT?",
  "161.00"
)
check(
  "multiply keyword alone (no 'product'): claw force × tail speed (23 × 4 = 92)",
  "A] LoO.oBbSsTtEr~ ClAw^ ExErTs\\ TwEnTy ThR^eE NoOtOnS| AnD{ TaIl~ SlApS/ WiTh Fo]uR MeTeRs PeR SeCoNd~ MuLtIpLy?",
  "92.00"
)

check(
  "gains three times: 25 × 3 = 75",
  "A] lO^bSt-Er lo.oobsssT Errr'S cLaW] eXxErT s twEnTy- FiVe ] nOoToNs ~ aNd- tHeN gAaiN s tHrEe < tImEs, uM hOw/ mUcH^ tOtAl] fOrCe \\ iS?",
  "75.00"
)

check(
  "first-char substitution: 'G hHrEe' → three (twenty-three minus seven = 16)",
  "A] lOoObbSssTtEr S^wIiMmSs/ aT- tW/eNnTy G hHrEe ] cEeMm EeTtEeR s PeR/ sEeCcoNnD, aNd- sLoWwS] bY^ sEeVvEeN { cEeMm EeTtEeR s PeR/ sEeCcoNnD, wHaT/ iS^ tHe- nEw] vEeLlOoCcIiTy?",
  "16.00"
)

check(
  "fight must not extract eight: 'dominance fight reduces' — 23-7=16 not 23-8=15",
  "A] LoOoBbSsT-tEr S^wImS[ iN~ cOoL WaTeR, BuT/ iTs ClAw] FoRcE Is^ TwEnTy ThReE NeWtOnS- AnD{ pReSsUrE/ aNd DoMiNaNcE} FiGhT ReDuCeS It\\ By^ SeVeN NeWtOnS, HoW MaNy NeWtOnS ReMaIn?",
  "16.00"
)

check(
  "per strike: rate × count (20 × 3 = 60)",
  "A] LoOoBbSsTtEeR^ ClAaW] ExErRtS~ TwEnTy NeOoOtToOnNs/ PeR| StRrIiKkEe Um, AnDd{ ThRrEe StRrIiKkEs< , WhAaT]S ToTtAaL^ FoRrCcEe?",
  "60.00"
)
check(
  "how far: distance = speed × time (17 m/s × 3s = 51)",
  "A] lOoObBsTtEr S^wImS/ aTt SeVeNtEeN~ mE tErS| pE rS eCoNd} aNd/ sW iMs\\ fOr ThReE< sE cOnDs- , hOw{ fA r?",
  "51.00"
)
check(
  "product with decimal: 23 newtons * 4.5 m/s = 103.5 (word 'point' in obfuscated text)",
  "A] lOoOobbsStTeErr] cLlAaWw^ eXxEeRrTtSs] um{ tWwEeNnTtY] tHhRrEe] nEeWwTtOoNnSs] * < fOoUuR] pOoIiNnTt] fIiVvEe] mEeTtEeRrSs] / pEeRr] sEeCcOoNnDd,] wWhHaAt] iIs] tThHe] pRrOoDdUuCcTt?",
  "103.50"
)

check(
  "operator * without surrounding spaces: 24 * 6 = 144 (ashwren catch)",
  "24 newtons *6 squeezes, what's the total force?",
  "144.00"
)

check(
  "obfuscated * noise in word (d*): 32 cm/s × 4 newtons = 128 (product, not explicit *)",
  "A] LoOoBbSsTtEr Um] sW^iMmS[ aT ThIr- tY TwOo] cMeEnT sPeR] sEcOoN d* FoR]cE iS FoOoUr] NeW~tOnS, WhAt] Is ThE PrOdUcT?",
  "128.00"
)

check(
  "obfuscated 'multiplied by' with 'total' present: 32 × 2 = 64",
  "A] L oObB sTtEeR- ClA]w F^oR cE iS ThIrTy TwO ] nEeW- T oOnS, MuL tIpLiEd/ By TwO~ WhAt Is ThE ToTaL?",
  "64.00"
)

check(
  "prefix-garbage obfuscation: 'SiRrThIrTy FiVvEe' = 35, total 35+22 = 57",
  "A] LoObBsStTeEr ]ClAw-FoRcE Is SiRrThIrTy FiVvEe NoOoTtOoNnSs ~ fIgGhtS wIiTh T]wEnTtY TtWo NoOoTtOoNnSs - HoW~ mUcH ToTaL FoRcE, ummmm?",
  "57.00"
)

check(
  "'and - speeds up': dash after 'and' is separator, not subtraction (23+7=30)",
  "A} LoBoSsTtEr ] sW^iMmS { aT < tWeNtY ThReE > mEteRsPeR sEcOnD ~ aNd - sPeEeDdS / uP | bY { sEvEn } , wHaT } iS < tHe > nEw } vElAwCiTy ? ummmm",
  "30.00"
)

check(
  "dash-as-separator before 'and': 35+22=57, not subtraction (regression: was 14.00)",
  "A] lO-bStEr Ex^ErTs ThIrTy FiVe NooOtOnS (nOoToNs) WiTh Um OnE ClAw - AnD TwEnTy TwO NeWtOnS OtHeR ClAw ~ WhAt Is ThE ToTaL FoR cE?",
  "57.00"
)

check(
  "obfuscated 'remaining' and 'loses' with repeated chars: 40 - 6 = 34",
  "A] lO^bStEr' s ClAww ExErTs FoRtY] NeW^tOnS, BuT/ aFtEr MoL tInG LoOoSeS SiX~ NeW}tOnS - wHaT Is ReMa]iNiNg FoRcE??",
  "34.00"
)

check(
  "mid-word char insertion: 'tHrIrTy' (extra r) = thirty two + fifteen = 47",
  "A] LoB-sT eR| ClAw^ FoRcE- ExErTs/ tHrIrTy\\ TwO {nEu-TonS} umm, aNd~ ItS// SwIm- VelOoOcItY| Is/ FiFtEeN <meTeRs> PeR\\ SeCoNd, So^ WhAt] Is- tHe/ SuM?",
  "47.00"
)

check(
  "each + total: 24 eyes × 6 neurons = 144",
  "Th]iS LoO bS tEr HaS^ tWeN tY fOuR EyE fA cE tS, AnD eAcH EyE sPrOuTs/ sIx NoO tOnS oF nEu-RoNs, Um, HoW MaNy N Eu-RoNs ToTaL<?",
  "144.00"
)

check(
  "multiplies by three: split 'twent y' + 'fiv e' + multiplies keyword (25×3=75)",
  "A] LoO b-StErR~ ClAw^ ExErTs/ TwEnT y] FiV e- NoOtOnS| AnD~ In{ DoMiNaN ce/ PuSh} MuLtI pLiEs- By/ ThReE < WhAtS> ToTaL?",
  "75.00"
)

check(
  "net force: split 'twen ty' + clean 'three' — soup should win (23-7=16)",
  "A] lObB-sT eRr'S ClAwW ExErT s^ tWeN tY ThReE NooToNs Um ] - RiV aL C lAwW ExErTs[ SeV eN, HoW^ MuCh NeT F oRcE?",
  "16.00"
)

check(
  "transposed chars: 'trhee' = three (TrHeEe obfuscation), territory density × 23 = 50 × 23 = 1150",
  "A] LoOoBbSsTtEeR^ ClLaAwW F(o)oRrCcEe IsS] fIfTy- NeWtOoNs, UmMm ~ AnD \\ iTsS TeRrRiToRyY DeEnSiTyY MuLtIiPlIiEd } ByY tW/eNtY TrHeEe <, WhHaT IsS ToOtTaAll^ FoOrRcEe?",
  "1150.00"
)

check(
  "accelerates by seven: 23+7=30 (tW]eNnY T hReEe pattern)",
  "A] lO-bStEr S^wIiMmS[ aT/ tW]eNnY T hReEe~ cE^nTiMeTeRs] pEr/ sEeCoNd- aNd] tHeN^ aCcEeLlEeRaTeS[ bY/ sEvEn, wHaTs] tHe^ nEw/ sPeEd?",
  "30.00"
)

check(
  "speeds up by seven: 23+7=30 (fragmented tokens, 'e-' + 'ne' false-one regression)",
  "A] lO bS tEr S^wI mS[ aT/ tW eN tY tHrEe ~ cE nTi Me Te Rs / pEr / sEe Co Nd, aNd] sPeE ds- uP ^ bY [sEvEn, wH aT' s} tH e- nE w< sPeE d?",
  "30.00"
)

check(
  "distance = speed × time: 23 m/s for 4 seconds = 92 (regression: was 27 from fallback add)",
  "A] LoOoBbSsTtEr SwImS^ aT TwEnTy ThReE MeTeRs/PeR SeCoNd] AnD PuShEs\\ FoR FoUr SeCoNdS, HoW MuCh DiStAnCe~DoEs ThE Lo.b-st Err TrAvEl?",
  "92.00"
)

check(
  "multiplys obfuscation (ie→y): 'MuLtIpLyS By TwO' with total present — 32×2=64, not 32+2=34",
  "]A Lo.BsT-ErS ClAwW ExErTs^ ThIrTy TwO NooToNs ~ AnD MuLtIpLyS| By TwO- HoW MuCh ToTaL FoR{Ce}?",
  "64.00"
)

check(
  "obfuscated token in left operand: 'fiiv-e' → five, 35 * 2 = 70",
  "A] lOoB-stErS ClAw] FoR-cE iS tHiR-ty FiiV-e N[eWtOnS * tW/o, hOw MuCh] ToTaL FoR^cE iS tHeRe, uM lo.b st errr looobsssster phyysxics um?",
  "70.00"
)

check(
  "anagram false positive: 'neeo' (from nEeO oT oNs) must not match 'one' — 22+5=27 not 23+5=28",
  "A] lO b.StErS cL aW fO rCe Is tW eN tYy tW o] nEeO oT oNs~ aNd- AfTeR m O lT iN g iT iN crEaSeS bY- fI vEe, hOw/ mUcH tOt Al- fO rCe^ nOw?",
  "27.00"
)

check(
  "unit fragment 'cen' must not match 'ten': twenty seven + fifteen = 42, not 37+15=52",
  "A] lO b-StEr SwImS^ lOoOoOobsssTeR-ly Um aT/ tWeNtY sEvEn] ceN.tImE- tErS/ pEr S/eCoNd, Um] dUrInG mOlTtInG iT/ gAiNs^ veLoowiTy yy bY/ fIfTeEn~, hOw/ mUcH iS tHe^ nEw] spEeD?",
  "42.00"
)

check(
  "3-token split via intra-word slash: 'tW/eN tY' = twenty, thirty + twenty-five = 55",
  "A] lOoObSsT-eR S^wImS hUm Um mMm AnD lIfTs LoOooBSt Er ClAw WiTh ThIrTy ]nEu-TonS + tW/eN tY fIvE ]nEu-TonS, HoW/ mUcH ToTaL FoR^cE iN tHeClAwS?",
  "55.00"
)

check(
  "inter-token 'tw oo' = two: claw expresses thirty-two newtons * two claws = 64",
  "A] lOoObS-tErR rR cLaW^ eXpReSsEs tHiRtY tW oO nooToOns umm ~ * aNd[ hAs^ tWo cLaWs, wHaT iS tOtAl- FoRcE? lx.Ob{st}er",
  "64.00"
)

check(
  "resists by: exerts twenty three notons, resists by seven notons — net force (23-7=16)",
  "ThIs] LoOoObSsT-ErR^ 'S ClAw] ExErTs/ TwEnTy ThReE NoOoToNs, AnD ReSiStS By^ SeVeN NoOoToNs\u2014 WhAt Is NeT FoRcE?",
  "16.00"
)

check(
  "neetons unit (w→ee substitution): repeated 'for tyy' noise + forty-two neetons + fifteen neetons (42+15=57)",
  "A] LooO bSst-Errr ClAw^ ExErTs[ FoR tYy: FoR tYy FoR tYy FoR? A nEeH Um] LxObqStEr ClA w Is^ FOrTy TwO nEu-ToNs, AnD[ aNoThEr Is^ FiFteEn nEeToNs, HoW/ mUcH ToTaL fOrCe? ~ lO.bSt Errr Um",
  "57.00"
)

check(
  "net force: split 'ThIrT y FiV e' - TwElVe = 23",
  "A] LoB-sTeR ClAw^ FoRcE Is] ThIrT y FiV e NooToNs~ AnD An] AnTeNn A ToU cH- SuB tRaCts^ TwElVe< NeWToNs, WhAt| Is} ThE/ NeT- FoRcE?",
  "23.00"
)

check(
  "has N claws: 4-token 'twenty' split + count×force (26×3=78)",
  "A] LoO-bSsT eR'S C^rU sHiN g ClA w ExE^rTs T]wE/nT y SiX NoO-tOnS, AnD/ ThE LoOoBbS sTeR HaS ThR]eE MaJoR ClA wS- WhAt Is ThE ToTaL FoRcE?",
  "78.00"
)

check(
  "neotons unit (n+eotons split): 14 × 3 = 42 (three times stronger)",
  "Lo]bS-tErS SwI]mS LiKe ThIs, ClAwS ExE]rT FoUrTeEn N eoOtOnS ~ AnD OtHeR ClAw Is ThReE TiMeS StRoNgEr * WhAt Is ToTaL FoR/cE?",
  "42.00"
)

check(
  "product: explicit '* seven' with narrative numbers on left (23*7=161, not 53*7=371)",
  "A] lOoObSsTeR ClAaW] eX^eRrTs[ tW/eNnTtY tH/rEe NoOoToOnNs~ AnD| aNnOtThHeR ClL^aW eX^eRrTs[ sEvEn, sO^ wHaT Is] tHe/ pRoDdDuUcT oF tWeNnTtY tH/rEe * sEvEn?",
  "161.00"
)

check(
  "single-char substitution: 'fourleen' → fourteen (l substitutes t), 32+14=46",
  "A] lO^bSt-Er S[wImS aNd] cLiMps- cLaW] fIgHtS, uM lOoobsssster- cLaW eXerTss- thI r.ty TwO ] nEwToNs^ aNd- tHe OtHeR cLaW- eXerTss- fOuRlEeN, hOw/ mUcH- tOtAl^ fOrCe? {uhh}",
  "46.00"
)

check(
  "two claws × thirty newtons = 60: 'there are two claws' should not parse 'there' as 'three'",
  "A] LoOoBbSsStTeRr ] cLaWw ] eXxEeRrTtSs ] ThIrTy ] NeWwToOnNs ~ aNd ] thErE ] aRrEe ] TwOo ] cLlAaWwSs, ] hOoW ] mUcH ] tOoTaLl ] fOoRrCe? ]",
  "60.00"
)

check(
  "six embedded in 'physical' (PhY sIx Ix Al) should not count as a number: 25+3=28",
  "A] lO b-S tEr'S ClA w- ExE rT s TwEn Ty FiV e + ThRe E, Um] lO oObSstTeR PhY sIx Ix Al ReAcTs ToOo NoOtOnS, hOw] mUcH ToTa L fO rCe^?",
  "28.00"
)

check(
  "two garbage tokens between tens and units: 'twenty ghh treee] three' = 23, 23+7=30",
  "A] LoObBsTsTeEr ^sWImS lOoOoOoN gGg,, uMm ]cLaW fOrCeE sHaReS/ tHe^ mOoTlInG- bOdY, Lo.b St Errr ]ClAw ExErTs^ tWeNtY gHh TrEeE] ThReE- nEeW^tOnS, aNd] tHe/ oPpOsInG- pInCeR aPpLlIiEs^ sEvEn- nEeW^tOnS, wHaT] iS^ tHe/ rEsUlTaNt- fOrCeE iF tHeY aDd?",
  "30.00"
)

check(
  "obfuscated 'tiimes' in 'strikes three tiimes': 25 × 3 = 75",
  "A] LoObBsStTeR] cLaW^ ApPlIeS/ tWeNtY fIvE ] nOoOtOnS ~ aNd- It/ sTrIiKeS \\ tHrEe { TiImEs, } WhAt'S < ThE/ ToTaL^ ImPuLsE?",
  "75.00"
)

check(
  "simultaneous pushes: 23 notons × 7 pushes = 161 (dash-as-separator before 'in')",
  "A] lOoObBsStTeRr ] eX^eRrTs [ a] cL^aW fOoRrCcE } oF/ tW]eNnTtY ThRrEe } nOoOtoOnSs ~ aNd [ iT } eN gAaGgEeSs - iN ] sEeVvEeN / sImU lTaNeEeOus ] pUuSsHhEs < hOw/ mUcH } tOoTaLl ] fOoRrCcE*",
  "161.00"
)

check(
  "reducing speed by fourteen: doubled-letter obfuscation hides 'reduc' — 32-14=18",
  "A] lOoObBsStTeEr^ sW/iMmS] aT tHhIrRtTyY tW]oO cMmEeTtEeRss^ pEeR sEeCcOoNnDd, aNd/ cOoLlLiIdDeEs] wItH aNoOtThHeEr~ rEeDdDuUcCiInNg^ sPpEeEeDd bY fOuUrR tEeEeEnN, wHaT] iSs^ tHhEe~ nEeW/ sPpEeEeDd?",
  "18.00"
)

check(
  "structural 'one claw' must not pollute subtraction: 35 nootons - 12 newtons = 23 (not 35-1=34)",
  "A] lOoObSt-Er ExErTs ThIrTy FiVe NooToNs ~wItH OnE ClAw -BuT Lo.sEs TwElVe NeWToNs /DuRiNg MoLtiNg, WhAt Is ReMaInInG FoRcE?",
  "23.00"
)

check(
  "decelerate by four: 23-4=19",
  "A] lOoOoBbSsStTeEr S^wImMs [aT vElAwCiTeE iIs tWeNtY tHrEe cMeNtIiMeTeRs PeR sEcOnD, uMm, lo.b st err BuMpS iT - aNd DeCeLeRaTeS bY fOuR cMeNtS / sEc, wHaT iS tHe NeW sPeEd?",
  "19.00"
)

check(
  "foldly multiplication: 23 * 7 = 161",
  "A] lObSt-ErS^ ClAw[s ExErTs/ tWeNtY ThReE^ nEu-RoNs , aNd~ ItS SwImMiNg{ InCrEaSeS* sEvEn }fOoLdLy - wHaT] Is^ ToTaL* FoRcE?",
  "161.00"
)

check(
  "obfuscated 'times' with unit between number and operator: 23 * 7 = 161",
  "Lo.oBbSsTeErS] lOoOobbsstteerr ClA#w] fO^rCe Is ThWeN]tY ThReE* NoOoToOnS~ TiMmEs SeV]eN, HoW MuCh T oT/aL F'oR|cE? umm lxq",
  "161.00"
)

check(
  "impulse = force × time: 32 * 14 = 448",
  "A] lO b-StErS cL]aW^ fO rC e Is ThIrTy TwO ] nEwToNs ~ AnD ApPlIeS OvEr FoUrTeEn \\ sEcOnDs - WhAt Is ThE ImPuLsE? umm lxobqsterrr",
  "448.00"
)

check(
  "energy transferred: end-of-word asterisk as operator (32 * 14 = 448)",
  "A] Lo.bStEr~ SwImS^ In/ cOoL| wAtEr, AnD lOoObsssster~ HaS^ ClAw~ FoRcE| Of< tHiRrTy Y tW[o NeWtOnS* fOuRrTeEeN NeWtOnS, HoW/ MuCh~ EnErGy Is TrAnSfErReD?",
  "448.00"
)

check(
  "dominance multiplier: claw force × multiplier (23 × 4 = 92)",
  "A] lOoObB.sSsT-ErS] cL^-aW F{oRcE iS TwEnTy ThReE ]nEu- ToNs, \\/ dOmInAnCe MuLtIpLiEr Is FoUr <HoW MuCh ToTaL F[oRcE?",
  "92.00"
)

check(
  "accelerates by seven: 'tW eN nY tH rEe' = twenty-three, 'eN eW' noise in question (23+7=30)",
  "A] lO- bS tEr ] lOoOo bSsT eRrR sW/ iMmS aT tW eN nY tH rEe ^ cE m/ eNt I mEe rS ] pE rS eC oN d aNd- aC cE lE rA tEs ] bY sE vE n~, uM wH/ aT iS ] tH eN eW- vE lO cI tY?",
  "30.00"
)

check(
  "product keyword split by space: 'pRoDuC t' — 33 cm/s × 9 newtons = 297 (was 42 from fallback add)",
  "A] lO-bS tEr sW/iMmS {wItH} vE lAwCiTeE umm, tHiR tY ThReE] cEnTeMmS pEr] sE cOnD ~ aNd| iTs ClAw} eXeR tS nInE^ nE wToNs * wHaT{ iS} tHe} pRoDuC t??",
  "297.00"
)

check(
  "explicit * operator with letter*letter noise in question: forty * sixteen = 640 (was skipped due to x*I)",
  "A] L{o}oObS-tErRr ClAw^ FoRcE Is] FoRtY * SiXtEeN ~ AnTeNnA CoN-tAcTs PeR/ SeCoNd, HoW/ mUcH N{o}oTx*ImPuLsE^?",
  "640.00"
)

check(
  "total force*growth in question clause: 30 * 5 = 150 (was 35 from add)",
  "A] lOoBbSsTtEeRrr ClAw] F[oR^cE Is] ThIrTtY ~ NeWwToNs, Um| AnD/ ItS] MoLtInG GrOwTh Is] FiVvEe < cMm, LiKe } ToTaL/ FoRcE*GrOwTh?",
  "150.00"
)

check(
  "N lobbers push together: dominant claw exerts 26N, three lobbers together → 3×26=78 (was 29 from add)",
  "A] Lo.bStErRrS~ DoMmInAnT cL-AwW eXeRtS^ TwEnTy SiX NeWToNs | AnD ThReE LoB bErS PuShH ToGeThEr, WhAtS ToTaL FoRcE?",
  "78.00"
)

check(
  "tolerant merge: 'ThWeN tY' → twenty (extra consonant in token split) × four = 92",
  "A] LoBb-S tEr' s ClAw] FoRcE^ Of ThWeN tY] ThReE NoOotOns~ TiMeS\\ ItS SwImMiN g VeLooOciTy] Of FoUr MeTeRs/ PeR SeCoNd, WhAtS^ ThE PoWeR< In WaTtS?",
  "92.00"
)

check(
  "total force: two claws inter-token split (35+22)",
  "LoO bS tEr] ExE rTs^ ThIrT y FiV e NeW tO nS/ WiTh- OnE ClA w| AnD~ ThE Ot HeR AdD s TwEn Ty TwO NeW tOnS{, WhAt< Is> ToTaL^ FoRcE?",
  "57.00"
)

check(
  "v→f obfuscation + '- but' separator: 'fIfE' = five, total 35+8 (was 22 from 30-8)",
  "A] lO b-StEr^'s C|lAw ]fO rCe- Is~ tHiR ty fIfE {nEeW}ToNs - bUt^ AnTeNnA tOuCh- aDdS <eIgHt> nEeWtOnS, wHaT-s] tHe^ ToTaL fOrCe?",
  "43.00"
)

check(
  "simultaneous with same unit: 23 neuttons + 7 neuttons = 30 (both unit-anchored → add, not multiply)",
  "A] lOoObSsT-tEr^ cLaW] eXpLyys^ lo.b qqq twEnTy] ThReE - ^nEuTtOnS * ]sImUlTaNeOuSly \\ wiTh um lxO b-StEr~ seVeN / nEuTtOnS, HoW^ mUcH |fOrCe {iS} tOtAlLy?",
  "30.00"
)

check(
  "two claws with 'umm' filler and 'another' keyword (35+22)",
  "A] L oO^bBsStTeEr' S- C lLaW^ ExXeRts ThI]rTy F iV e~ nEeWtO^nS umm, aNd] AnO tHeR- C lLaW ExXeRts T wEeN tY~ T wO\\, WhAt Is] ToTaL- FoR cE?",
  "57.00"
)

check(
  "fragmented 'T hIr]TtY F iV]e' plus 'T wE]lV e': 35+12=47 (was 17 from 8-token window cutoff)",
  "A] lOoObBsStTeR ClAw] FoR^cE iS T hIr]TtY F iV]e N oO^tOnS ~ pLuS { T wE]lV e } N oO^tOnS, H oW- mAnY ]N eW^tOnS ToTaL?",
  "47.00"
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
