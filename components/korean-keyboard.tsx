"use client"

import { useState } from "react"
import Keyboard from "react-simple-keyboard"
import "react-simple-keyboard/build/css/index.css"
import hangul from "hangul-js"
import "./keyboard-styles.css"

// Korean keyboard layout configuration
const koreanLayout = {
  default: [
    "ㅂ ㅈ ㄷ ㄱ ㅅ ㅛ ㅕ ㅑ ㅐ ㅔ",
    "ㅁ ㄴ ㅇ ㄹ ㅎ ㅗ ㅓ ㅏ ㅣ",
    "{shift} ㅋ ㅌ ㅊ ㅍ ㅠ ㅜ ㅡ {pre}",
    "{space} {dot} {enterText}",
  ],
  shift: [
    "ㅃ ㅉ ㄸ ㄲ ㅆ ㅛ ㅕ ㅑ ㅒ ㅖ",
    "ㅁ ㄴ ㅇ ㄹ ㅎ ㅗ ㅓ ㅏ ㅣ",
    "{shift} ㅋ ㅌ ㅊ ㅍ ㅠ ㅜ ㅡ {pre}",
    "{space} {dot} {enterText}",
  ],
}

interface KoreanKeyboardProps {
  text: string
  setText: (text: string) => void
  onEnter?: () => void
  disabled?: boolean
}

export default function KoreanKeyboard({ text, setText, onEnter, disabled = false }: KoreanKeyboardProps) {
  const [layoutName, setLayoutName] = useState("default") // default, shift

  const onKeyPress = (key: string) => {
    if (disabled) return

    if (key === "{pre}") {
      // Handle backspace
      const res = text.slice(0, -1)
      setText(res)
    } else if (key === "{shift}") {
      // Toggle between default and shift layouts
      setLayoutName((prev) => (prev === "default" ? "shift" : "default"))
    } else if (key === "{enterText}") {
      // Handle enter key
      if (onEnter) onEnter()
    } else if (key === "{dot}") {
      // Add a period
      setText(text + ".")
    } else if (key === "{space}") {
      // Add a space
      setText(text + " ")
    } else {
      // Handle Hangul composition using hangul-js
      setText(hangul.assemble(hangul.disassemble(text + key)))
    }
  }

  return (
    <div className={`korean-keyboard-wrapper ${disabled ? "opacity-70 pointer-events-none" : ""}`}>
      <Keyboard
        layoutName={layoutName}
        layout={koreanLayout}
        onKeyPress={onKeyPress}
        display={{
          "{enterText}": "Enter",
          "{shift}": "↑",
          "{space}": " ",
          "{dot}": ".",
          "{pre}": "←",
        }}
        buttonTheme={[
          {
            class: "enter-key",
            buttons: "{enterText}",
          },
          {
            class: "space-key",
            buttons: "{space}",
          },
          {
            class: "dot-key",
            buttons: "{dot}",
          },
          {
            class: "shift-key",
            buttons: "{shift}",
          },
          {
            class: "pre-key",
            buttons: "{pre}",
          },
        ]}
      />
    </div>
  )
}
