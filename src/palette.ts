// Single source of truth for Fleet Plaza colors (3D + matching CSS vars in style.css).
export const PALETTE = {
  bg: 0xeaf0f5,
  floorCenter: "#ffffff",
  floorEdge: "#e9f0f6",
  commons: 0xeff4f8,
  padTop: 0xfcfdfe,
  accent: 0x1d3a55,
  accentHover: 0x2c5278,
  busy: 0x2e78d2,
  idle: 0x3fbf6f,
  stale: 0x9aa7b2,
  danger: 0xd2543e,
  keyLight: 0xfff9f2,
  text: "#16222e",
  textSecondary: "#5b6b7a",
} as const;
