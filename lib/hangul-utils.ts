// Hangul composition utility functions
// This is a simplified version for demonstration purposes
// In a production environment, you might want to use a library like hangul-js

// Initial consonants (초성)
const CHOSUNG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
]

// Medial vowels (중성)
const JUNGSUNG = [
  "ㅏ",
  "ㅐ",
  "ㅑ",
  "ㅒ",
  "ㅓ",
  "ㅔ",
  "ㅕ",
  "ㅖ",
  "ㅗ",
  "ㅘ",
  "ㅙ",
  "ㅚ",
  "ㅛ",
  "ㅜ",
  "ㅝ",
  "ㅞ",
  "ㅟ",
  "ㅠ",
  "ㅡ",
  "ㅢ",
  "ㅣ",
]

// Final consonants (종성)
const JONGSUNG = [
  "",
  "ㄱ",
  "ㄲ",
  "ㄳ",
  "ㄴ",
  "ㄵ",
  "ㄶ",
  "ㄷ",
  "ㄹ",
  "ㄺ",
  "ㄻ",
  "ㄼ",
  "ㄽ",
  "ㄾ",
  "ㄿ",
  "ㅀ",
  "ㅁ",
  "ㅂ",
  "ㅄ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
]

// Function to check if a character is a Hangul syllable
export function isHangulSyllable(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 0xac00 && code <= 0xd7a3
}

// Function to check if a character is a Hangul jamo
export function isHangulJamo(char: string): boolean {
  const code = char.charCodeAt(0)
  return (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f)
}

// Function to compose a Hangul syllable from jamo
export function composeHangul(chosung: string, jungsung: string, jongsung = ""): string {
  const chosungIndex = CHOSUNG.indexOf(chosung)
  const jungsungIndex = JUNGSUNG.indexOf(jungsung)
  const jongsungIndex = JONGSUNG.indexOf(jongsung)

  if (chosungIndex === -1 || jungsungIndex === -1) {
    return ""
  }

  const code = 0xac00 + chosungIndex * 21 * 28 + jungsungIndex * 28 + jongsungIndex
  return String.fromCharCode(code)
}

// Function to decompose a Hangul syllable into jamo
export function decomposeHangul(syllable: string): { chosung: string; jungsung: string; jongsung: string } {
  if (!isHangulSyllable(syllable)) {
    return { chosung: "", jungsung: "", jongsung: "" }
  }

  const code = syllable.charCodeAt(0) - 0xac00
  const jongsungIndex = code % 28
  const jungsungIndex = ((code - jongsungIndex) / 28) % 21
  const chosungIndex = Math.floor((code - jongsungIndex) / 28 / 21)

  return {
    chosung: CHOSUNG[chosungIndex],
    jungsung: JUNGSUNG[jungsungIndex],
    jongsung: JONGSUNG[jongsungIndex],
  }
}

// Function to process Hangul input with proper composition
export function processHangulInput(input: string, newChar: string): string {
  // This is a simplified implementation
  // In a real application, you would need more complex logic for proper Hangul composition

  if (!input) {
    return newChar
  }

  const lastChar = input.charAt(input.length - 1)

  // If the last character is not a Hangul syllable, just append the new character
  if (!isHangulSyllable(lastChar) && !isHangulJamo(lastChar)) {
    return input + newChar
  }

  // For simplicity, we're just appending characters in this demo
  // A full implementation would handle proper Hangul composition
  return input + newChar
}
