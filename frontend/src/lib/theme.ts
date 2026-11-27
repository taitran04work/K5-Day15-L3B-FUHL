import { createContext } from "react"

export type ThemeMode = "light" | "dark"

export const ThemeContext = createContext<{
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}>({ mode: "light", setMode: () => undefined })
