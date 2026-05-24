const KA = "ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
const HEX = "0123456789ABCDEF";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;:',.<>?/`~";
const CHARS = KA + HEX + SYMBOLS + KA;

function randChar(): string {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}

interface Drop {
  x: number;
  y: number;
  speed: number;
  length: number;
  chars: string[];
  tick: number;
  brightness: number;
}

export function generateMatrixRainFrame(width: number, height: number, drops: Drop[]): { frame: string; drops: Drop[] } {
  if (drops.length === 0) {
    const count = Math.max(4, Math.floor(width / 6));
    for (let i = 0; i < count; i++) {
      drops.push({
        x: Math.floor(Math.random() * width),
        y: -Math.floor(Math.random() * height),
        speed: 1 + Math.floor(Math.random() * 3),
        length: 3 + Math.floor(Math.random() * 12),
        chars: [],
        tick: 0,
        brightness: 0.3 + Math.random() * 0.7,
      });
    }
  }

  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(" "));
  const gridAlpha: number[][] = Array.from({ length: height }, () => Array(width).fill(0));

  for (const drop of drops) {
    drop.tick++;
    if (drop.tick % drop.speed === 0) {
      drop.y++;
      drop.chars.unshift(randChar());
      if (drop.chars.length > drop.length) drop.chars.pop();
    }

    for (let i = 0; i < drop.chars.length; i++) {
      const row = drop.y - i;
      if (row >= 0 && row < height && drop.x >= 0 && drop.x < width) {
        grid[row][drop.x] = i === 0 && drop.brightness > 0.7
          ? drop.chars[i]
          : i === 1 ? randChar() : drop.chars[i];
        const alpha = i === 0 ? drop.brightness : Math.max(0.05, drop.brightness - i * 0.08);
        gridAlpha[row][drop.x] = Math.max(gridAlpha[row][drop.x], alpha);
      }
    }

    if (drop.y - drop.length > height) {
      drop.y = -drop.length;
      drop.x = Math.floor(Math.random() * width);
      drop.speed = 1 + Math.floor(Math.random() * 3);
      drop.length = 3 + Math.floor(Math.random() * 12);
      drop.brightness = 0.3 + Math.random() * 0.7;
      drop.chars = [];
    }
  }

  let frame = "";
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = grid[row][col];
      const a = gridAlpha[row][col];
      if (c === " ") {
        frame += " ";
      } else if (a > 0.7) {
        frame += c;
      } else if (a > 0.4) {
        frame += c;
      } else if (a > 0.15) {
        frame += c;
      } else {
        frame += " ";
      }
    }
    if (row < height - 1) frame += "\n";
  }

  return { frame, drops };
}

export function renderMatrixRain(runId: string, width = 40, height = 5): string {
  let hash = 0;
  for (let i = 0; i < runId.length; i++) {
    hash = ((hash << 5) - hash) + runId.charCodeAt(i);
    hash |= 0;
  }

  const SEED = (n: number) => {
    let h = hash + n;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };

  const rows: string[] = [];
  const dropPositions = new Set<number>();
  const dropCount = Math.max(3, Math.floor(width / 8));

  for (let i = 0; i < dropCount; i++) {
    dropPositions.add(SEED(i * 7) % width);
  }

  for (let row = 0; row < height; row++) {
    let line = "";
    for (let col = 0; col < width; col++) {
      if (dropPositions.has(col)) {
        const offset = (row + SEED(col * 13) % 8) % (height + 4);
        const headPos = SEED(col * 17 + row * 3) % (height + 4);
        const dropLen = 2 + (SEED(col * 19) % 6);

        if (offset <= headPos) {
          const distFromHead = headPos - offset;
          if (distFromHead === 0 && offset < height) {
            line += CHARS.charAt(SEED(col * 23 + row * 7) % CHARS.length);
          } else if (distFromHead <= dropLen && offset < height) {
            const char = CHARS.charAt(SEED(col * 29 + row * 11) % CHARS.length);
            if (distFromHead === 1) line += char;
            else if (distFromHead <= 3) line += char;
            else line += " ";
          } else {
            line += " ";
          }
        } else {
          line += " ";
        }
      } else {
        line += " ";
      }
    }
    rows.push(line);
  }

  return rows.join("\n");
}
