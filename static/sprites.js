// Pixel-art sprites drawn as SVG <rect>s, so Session Replay can record them (it can't see <canvas>).
// Each map row is a string; each character is one pixel, looked up in PALETTE ('.' = transparent).
const PALETTE = {
  K: "#1b1b2f", // outline
  W: "#ffffff", // fur
  G: "#cfd0dc", // fur shading / ear
  P: "#8a3ffc", // collar
  p: "#4b1f87", // collar tag
  R: "#ff6b8b", // tongue
  B: "#f6efdc", // bone
  O: "#b5651d", // squirrel
  o: "#e8a96b", // squirrel belly
  H: "#5a3825", // hair
  S: "#f1c27d", // skin
  D: "#2b4c8c", // jeans
  T: "#8a3ffc", // shirt
};

const DOG_TOP = [
  "..........KKKKK.....",
  ".........KWWWWWK....",
  "........KWWWWWWWK...",
  ".......KGGWWWKWWWK..",
  ".......KGGWWWWWWWWKK",
  ".......KGGWWWWWWWWWK",
  "........KGWWWWWKRRK.",
  ".........KPPPPPKKK..",
  ".K......KWPpPWWK....",
  "KWK.KKKKWWWWWWWK....",
  ".KWKWWWWWWWWWWGK....",
  "..KWWWWWWWWWWWGK....",
  "...KWWWWWWWWWGGK....",
];

const DOG_LEGS = {
  stand: [
    "...KWKKKKKKKKWWK....",
    "...KWK......KWK.....",
    "...KKK......KKK.....",
  ],
  runA: [
    "...KWKKKKKKKKWWK....",
    "..KWK........KWK....",
    ".KK...........KK....",
  ],
  runB: [
    "....KWKKKKKKWWK.....",
    ".....KWK..KWK.......",
    "......KK..KK........",
  ],
  jump: [
    "..KWKKKKKKKKKKWK....",
    ".KWK..........KWK...",
    "KK..............KK..",
  ],
};

const SPRITES = {
  bone: [
    ".KK......KK.",
    "KBBKKKKKKBBK",
    ".KBBBBBBBBK.",
    "KBBKKKKKKBBK",
    ".KK......KK.",
  ],
  squirrel: [
    "..KKK.......",
    ".KOOOK......",
    "KOOooOK.....",
    "KOOooOK..KK.",
    "KOOooOK.KOOK",
    ".KOOOK.KOKOK",
    "..KOOKKOOOOK",
    "..KOOOOOOOK.",
    "...KOOOOOOK.",
    "...KOoooOK..",
    "...KOK.KOK..",
    "...KK..KK...",
  ],
  human: [
    "...KKKKK....",
    "..KHHHHHK...",
    "..KHSSSSK...",
    "..KSSKSSK...",
    "..KSSSSSK...",
    "...KSSSK....",
    "..KTTTTTK...",
    ".KTTTTTTTK..",
    ".KSTTTTTSK..",
    ".KSTTTTTSK..",
    "..KTTTTTK...",
    "..KDDDDDK...",
    "..KDDKDDK...",
    "..KDDKDDK...",
    "..KDDKDDK...",
    "..KKK.KKK...",
  ],
  humanThrow: [
    "...KKKKK....",
    "..KHHHHHK.KK",
    "..KHSSSSKKSK",
    "..KSSKSSKSK.",
    "..KSSSSSKSK.",
    "...KSSSKKSK.",
    "..KTTTTTKTK.",
    ".KTTTTTTTK..",
    ".KSTTTTTK...",
    ".KSTTTTTK...",
    "..KTTTTTK...",
    "..KDDDDDK...",
    "..KDDKDDK...",
    "..KDDKDDK...",
    "..KDDKDDK...",
    "..KKK.KKK...",
  ],
};
for (const [name, legs] of Object.entries(DOG_LEGS)) SPRITES[`dog_${name}`] = DOG_TOP.concat(legs);

function spriteSVG(name, px) {
  const map = SPRITES[name];
  const w = map[0].length, h = map.length;
  let rects = "";
  map.forEach((row, y) => {
    // merge horizontal runs of the same color to keep the DOM small
    for (let x = 0; x < w; ) {
      const c = row[x];
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      if (c !== ".") rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PALETTE[c]}"/>`;
      x += run;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`;
}
