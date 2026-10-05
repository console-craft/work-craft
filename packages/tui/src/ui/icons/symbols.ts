export const symbols = {
  // Lines
  horizontal: "─",
  vertical: "│",
  horizontalHeavy: "━",
  verticalHeavy: "┃",
  horizontalDashed: "┄",
  horizontalDashedHeavy: "┅",
  verticalDashed: "┆",
  verticalDashedHeavy: "┇",
  horizontalDoubleDashed: "╌",
  horizontalDoubleDashedHeavy: "╍",
  verticalDoubleDashed: "╎",
  verticalDoubleDashedHeavy: "╏",
  horizontalDotted: "┈",
  horizontalDottedHeavy: "┉",
  verticalDotted: "┊",
  verticalDottedHeavy: "┋",

  // Arrows
  arrowLeft: "←",
  arrowRight: "→",
  arrowUp: "↑",
  arrowDown: "↓",
  arrowLeftRight: "↔",
  arrowUpDown: "↕",
  arrowUpLeft: "↖",
  arrowUpRight: "↗",
  arrowDownLeft: "↙",
  arrowDownRight: "↘",
  arrowLongLeft: "⟵",
  arrowLongRight: "⟶",
  arrowLongLeftRight: "⟷",
  arrowLongDoubleLeft: "⟸",
  arrowLongDoubleRight: "⟹",
  arrowLongDoubleLeftRight: "⟺",
  arrowLongFromBarLeft: "⟻",
  arrowLongFromBarRight: "⟼",

  // Triangles
  triangleLeft: "◂",
  triangleRight: "▸",
  triangleUp: "▴",
  triangleDown: "▾",
  triangleLeftFilled: "◀",
  triangleRightFilled: "▶",
  triangleUpFilled: "▲",
  triangleDownFilled: "▼",

  // Bullets
  bullet: "•",
  bulletHollow: "◦",
  dot: "·",
  ellipsis: "…",
  verticalEllipsis: "⋮",

  // Circles
  circle: "○",
  circleFilled: "●",
  circleDot: "◉",

  // Squares
  square: "□",
  squareFilled: "■",
  squareSmall: "▫",
  squareSmallFilled: "▪",
  squareChecked: "▣",
  squareIndeterminate: "☒",

  // Diamonds
  diamond: "◇",
  diamondFilled: "◆",

  // Checks / crosses
  check: "✓",
  checkHeavy: "✔",
  cross: "×",
  crossHeavy: "✖",
  crossBig: "❌",
  info: "i",
  exclamation: "⚠",

  // Box drawing
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  teeLeft: "├",
  teeRight: "┤",
  teeUp: "┴",
  teeDown: "┬",
  crossLine: "┼",
  roundedTopLeft: "╭",
  roundedTopRight: "╮",
  roundedBottomLeft: "╰",
  roundedBottomRight: "╯",

  // Shading
  shadeLight: "░",
  shadeMedium: "▒",
  shadeDark: "▓",

  // Horizontal progress blocks
  block1of8: "▏",
  block2of8: "▎",
  block3of8: "▍",
  block4of8: "▌",
  block5of8: "▋",
  block6of8: "▊",
  block7of8: "▉",
  blockFull: "█",

  // Vertical progress / charts
  bar1of8: "▁",
  bar2of8: "▂",
  bar3of8: "▃",
  bar4of8: "▄",
  bar5of8: "▅",
  bar6of8: "▆",
  bar7of8: "▇",
  barFull: "█",

  // Keyboard
  keyCommand: "⌘",
  keyOption: "⌥",
  keyControl: "⌃",
  keyShift: "⇧",
  keyEnter: "↵",
  keyBackspace: "⌫",
  keyDelete: "⌦",
  keyEscape: "⎋",
  keyTab: "⇥",
} as const;

export type SymbolName = keyof typeof symbols;
