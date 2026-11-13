const VERSIONS = [
  { version: 1, size: 21, dataBytes: 19, ecBytes: 7, align: [] },
  { version: 2, size: 25, dataBytes: 34, ecBytes: 10, align: [6, 18] },
  { version: 3, size: 29, dataBytes: 55, ecBytes: 15, align: [6, 22] },
  { version: 4, size: 33, dataBytes: 80, ecBytes: 20, align: [6, 26] },
];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = x;
  EXP[i + 255] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) {
    x ^= 0x11d;
  }
}

function gfMul(a, b) {
  if (a === 0 || b === 0) {
    return 0;
  }
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const buffer = new Uint8Array(data.length + ecCount);
  buffer.set(data);
  for (let i = 0; i < data.length; i++) {
    const coeff = buffer[i];
    if (coeff !== 0) {
      for (let j = 0; j < gen.length; j++) {
        buffer[i + j] ^= gfMul(gen[j], coeff);
      }
    }
  }
  return Array.from(buffer.slice(data.length));
}

function buildData(bytes, spec) {
  const bits = [];
  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const byte of bytes) {
    pushBits(byte, 8);
  }

  const capacityBits = spec.dataBytes * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    codewords.push(byte);
  }

  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < spec.dataBytes) {
    codewords.push(pads[padIndex % 2]);
    padIndex++;
  }

  return codewords.concat(rsEncode(codewords, spec.ecBytes));
}

function formatBits(mask) {
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) {
      rem ^= 0x537 << i;
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function createMatrix(size, alignCenters) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(null));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFixed = (r, c, value) => {
    grid[r][c] = value ? 1 : 0;
    fixed[r][c] = true;
  };

  const drawFinder = (row, col) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) {
          continue;
        }
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFixed(r, c, inOuter && (onBorder || inCore));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFixed(6, i, i % 2 === 0);
    setFixed(i, 6, i % 2 === 0);
  }

  for (const rCenter of alignCenters) {
    for (const cCenter of alignCenters) {
      if (fixed[rCenter][cCenter]) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const onEdge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
          const atCenter = dr === 0 && dc === 0;
          setFixed(rCenter + dr, cCenter + dc, onEdge || atCenter);
        }
      }
    }
  }

  setFixed(size - 8, 8, 1);

  for (let i = 0; i < 9; i++) {
    if (!fixed[8][i]) {
      setFixed(8, i, 0);
    }
    if (!fixed[i][8]) {
      setFixed(i, 8, 0);
    }
  }
  for (let i = size - 8; i < size; i++) {
    setFixed(8, i, 0);
  }
  for (let i = size - 7; i < size; i++) {
    setFixed(i, 8, 0);
  }

  return { grid, fixed };
}

function applyMask(baseGrid, fixed, size, codewords, maskIndex) {
  const grid = baseGrid.map((row) => row.slice());
  const maskFn = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ][maskIndex];

  const bits = [];
  for (const byte of codewords) {
    for (let b = 7; b >= 0; b--) {
      bits.push((byte >> b) & 1);
    }
  }

  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) {
      rightCol--;
    }
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (const c of [rightCol, rightCol - 1]) {
        if (fixed[r][c]) {
          continue;
        }
        const bit = bitIdx < bits.length ? bits[bitIdx++] : 0;
        grid[r][c] = bit ^ (maskFn(r, c) ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const fmt = formatBits(maskIndex);
  for (let i = 0; i <= 5; i++) {
    grid[8][i] = (fmt >> (14 - i)) & 1;
  }
  grid[8][7] = (fmt >> 8) & 1;
  grid[8][8] = (fmt >> 7) & 1;
  grid[7][8] = (fmt >> 6) & 1;
  for (let i = 9; i < 15; i++) {
    grid[14 - i][8] = (fmt >> (14 - i)) & 1;
  }
  for (let i = 0; i < 7; i++) {
    grid[size - 1 - i][8] = (fmt >> (14 - i)) & 1;
  }
  for (let i = 7; i < 15; i++) {
    grid[8][size - 15 + i] = (fmt >> (14 - i)) & 1;
  }

  return grid;
}

function penaltyScore(grid) {
  const size = grid.length;
  let score = 0;
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) {
        run++;
      } else {
        if (run >= 5) {
          score += run - 2;
        }
        run = 1;
      }
    }
    if (run >= 5) {
      score += run - 2;
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === grid[r - 1][c]) {
        run++;
      } else {
        if (run >= 5) {
          score += run - 2;
        }
        run = 1;
      }
    }
    if (run >= 5) {
      score += run - 2;
    }
  }
  return score;
}

export function encodeQR(text) {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSIONS.find((v) => bytes.length + 2 <= v.dataBytes);
  if (!spec) {
    throw new Error("URL muito longa para QR offline");
  }

  const codewords = buildData(bytes, spec);
  const { grid: baseGrid, fixed } = createMatrix(spec.size, spec.align);

  let bestGrid = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(baseGrid, fixed, spec.size, codewords, mask);
    const score = penaltyScore(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestGrid = candidate;
    }
  }
  return bestGrid;
}

export function renderQR(container, text, pixelSize = 180) {
  const matrix = encodeQR(text);
  const modules = matrix.length;
  const quiet = 4;
  const total = modules + quiet * 2;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${total} ${total}`);
  svg.setAttribute("width", String(pixelSize));
  svg.setAttribute("height", String(pixelSize));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR Code do endereço do jogo");

  const bg = document.createElementNS(svgNS, "rect");
  bg.setAttribute("width", String(total));
  bg.setAttribute("height", String(total));
  bg.setAttribute("fill", "#ffffff");
  svg.appendChild(bg);

  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (matrix[r][c] === 1) {
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", String(c + quiet));
        rect.setAttribute("y", String(r + quiet));
        rect.setAttribute("width", "1");
        rect.setAttribute("height", "1");
        rect.setAttribute("fill", "#000000");
        svg.appendChild(rect);
      }
    }
  }

  container.replaceChildren(svg);
}
