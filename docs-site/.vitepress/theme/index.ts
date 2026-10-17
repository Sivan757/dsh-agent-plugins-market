import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './custom.css'

// The default theme carries the search, dark mode and code styling. The
// guide pages carry their language switch inside the page: the layout slots
// receive no page identity at prerender time, so a slot component cannot
// know which page it sits on (see scripts/lib/rewrite-guide.mjs).
const theme: Theme = {
  extends: DefaultTheme
}

export default theme
