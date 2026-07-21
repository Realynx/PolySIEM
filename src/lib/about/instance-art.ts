const ASCII_FONT: Record<string, string> = {
  A: ".###./#...#/#####/#...#/#...#",
  B: "####./#...#/####./#...#/####.",
  C: ".####/#..../#..../#..../.####",
  D: "####./#...#/#...#/#...#/####.",
  E: "#####/#..../####./#..../#####",
  F: "#####/#..../####./#..../#....",
  G: ".####/#..../#.###/#...#/.###.",
  H: "#...#/#...#/#####/#...#/#...#",
  I: "#####/..#../..#../..#../#####",
  J: "..###/...#./...#./#..#./.##..",
  K: "#...#/#..#./###../#..#./#...#",
  L: "#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#..##/#...#",
  O: ".###./#...#/#...#/#...#/.###.",
  P: "####./#...#/####./#..../#....",
  Q: ".###./#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/####./#..#./#...#",
  S: ".####/#..../.###./....#/####.",
  T: "#####/..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#.#.#/##.##/#...#",
  X: "#...#/.#.#./..#../.#.#./#...#",
  Y: "#...#/.#.#./..#../..#../..#..",
  Z: "#####/...#./..#../.#.../#####",
  "0": ".###./#..##/#.#.#/##..#/.###.",
  "1": "..#../.##../..#../..#../.###.",
  "2": ".###./#...#/...#./..#../#####",
  "3": "####./....#/.###./....#/####.",
  "4": "#..#./#..#./#####/...#./...#.",
  "5": "#####/#..../####./....#/####.",
  "6": ".###./#..../####./#...#/.###.",
  "7": "#####/...#./..#../.#.../.#...",
  "8": ".###./#...#/.###./#...#/.###.",
  "9": ".###./#...#/.####/....#/.###.",
  "-": "...../...../#####/...../.....",
  _: "...../...../...../...../#####",
  ".": "...../...../...../..##./..##.",
  " ": ".../.../.../.../...",
  "?": ".###./#...#/...#./...../..#..",
};

export interface InstanceArtStyle {
  name: string;
  pixel: string;
  gap: string;
  signature: (name: string) => string;
  colorClass: string;
  shadowColor: string;
}

export const INSTANCE_ART_STYLES: readonly InstanceArtStyle[] = [
  {
    name: "solid block",
    pixel: "#",
    gap: "  ",
    signature: (name) => `└─ ${name} // HOMELAB`,
    colorClass: "text-primary",
    shadowColor: "var(--primary)",
  },
  {
    name: "phosphor",
    pixel: "@",
    gap: "  ",
    signature: (name) => `> ${name.toUpperCase()} :: HOMELAB`,
    colorClass: "text-chart-2",
    shadowColor: "var(--chart-2)",
  },
  {
    name: "dot matrix",
    pixel: "o",
    gap: "  ",
    signature: (name) => `[ ${name} · HOMELAB ]`,
    colorClass: "text-chart-3",
    shadowColor: "var(--chart-3)",
  },
  {
    name: "circuit",
    pixel: "+",
    gap: "  ",
    signature: (name) => `╰─ ${name} / HOMELAB`,
    colorClass: "text-chart-4",
    shadowColor: "var(--chart-4)",
  },
  {
    name: "classic terminal",
    pixel: "*",
    gap: "  ",
    signature: (name) => `${name} :: HOMELAB`,
    colorClass: "text-chart-5",
    shadowColor: "var(--chart-5)",
  },
];

export interface RenderedInstanceArt {
  rows: string[];
  width: number;
  signature: string;
}

function normalizeInstanceName(instanceName: string): string {
  return (
    Array.from(instanceName, (character) => {
      const codePoint = character.codePointAt(0) ?? 32;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
      .join("")
      .replace(/\s+/g, " ")
      .trim() || "PolySIEM"
  );
}

export function renderInstanceArt(
  instanceName: string,
  style: InstanceArtStyle,
): RenderedInstanceArt {
  const name = normalizeInstanceName(instanceName);
  const glyphs = Array.from(name.toUpperCase(), (character) =>
    (ASCII_FONT[character] ?? ASCII_FONT["?"]).split("/"),
  );
  const rows = Array.from({ length: 5 }, (_, row) =>
    glyphs
      .map((glyph) =>
        Array.from(glyph[row] ?? "", (pixel) => (pixel === "#" ? style.pixel : " ")).join(""),
      )
      .join(style.gap)
      .trimEnd(),
  );
  const width = Math.max(...rows.map((row) => row.length));

  return {
    rows: rows.map((row) => row.padEnd(width, " ")),
    width,
    signature: style.signature(name),
  };
}

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, `${minutes}m`]
    .filter(Boolean)
    .join(" ");
}
