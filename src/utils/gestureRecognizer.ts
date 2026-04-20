
export interface Point {
  x: number;
  y: number;
  timestamp?: number;
}

const NUM_POINTS = 64;
const SQUARE_SIZE = 250.0;
const ORIGIN = { x: 0, y: 0 };

export function resample(points: Point[], n: number): Point[] {
  const I = pathLength(points) / (n - 1);
  let D = 0.0;
  const newPoints: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i - 1], points[i]);
    if (D + d >= I) {
      const qx = points[i - 1].x + ((I - D) / d) * (points[i].x - points[i - 1].x);
      const qy = points[i - 1].y + ((I - D) / d) * (points[i].y - points[i - 1].y);
      const q = { x: qx, y: qy };
      newPoints.push(q);
      points.splice(i, 0, q);
      D = 0.0;
    } else {
      D += d;
    }
  }
  if (newPoints.length === n - 1) {
    newPoints.push(points[points.length - 1]);
  }
  return newPoints;
}

export function rotateToZero(points: Point[]): Point[] {
  const c = centroid(points);
  const theta = Math.atan2(c.y - points[0].y, c.x - points[0].x);
  return rotateBy(points, -theta);
}

export function rotateBy(points: Point[], theta: number): Point[] {
  const c = centroid(points);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const newPoints: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const qx = (points[i].x - c.x) * cos - (points[i].y - c.y) * sin + c.x;
    const qy = (points[i].x - c.x) * sin + (points[i].y - c.y) * cos + c.y;
    newPoints.push({ x: qx, y: qy });
  }
  return newPoints;
}

export function scaleTo(points: Point[], size: number): Point[] {
  const B = boundingBox(points);
  const newPoints: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const qx = points[i].x * (size / B.width);
    const qy = points[i].y * (size / B.height);
    newPoints.push({ x: qx, y: qy });
  }
  return newPoints;
}

export function translateTo(points: Point[], pt: Point): Point[] {
  const c = centroid(points);
  const newPoints: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const qx = points[i].x + pt.x - c.x;
    const qy = points[i].y + pt.y - c.y;
    newPoints.push({ x: qx, y: qy });
  }
  return newPoints;
}

function centroid(points: Point[]): Point {
  let x = 0.0, y = 0.0;
  for (let i = 0; i < points.length; i++) {
    x += points[i].x;
    y += points[i].y;
  }
  return { x: x / points.length, y: y / points.length };
}

function boundingBox(points: Point[]) {
  let minX = +Infinity, maxX = -Infinity, minY = +Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    minX = Math.min(minX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxX = Math.max(maxX, points[i].x);
    maxY = Math.max(maxY, points[i].y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function pathLength(points: Point[]): number {
  let d = 0.0;
  for (let i = 1; i < points.length; i++) {
    d += distance(points[i - 1], points[i]);
  }
  return d;
}

function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pathDistance(pts1: Point[], pts2: Point[]): number {
  let d = 0.0;
  for (let i = 0; i < pts1.length; i++) {
    d += distance(pts1[i], pts2[i]);
  }
  return d / pts1.length;
}

export function recognize(points: Point[], templates: { name: string, points: Point[] }[]): { name: string, score: number } {
  // Let's resample, rotate, scale and translate
  const resampled = resample(points, NUM_POINTS);
  const rotated = rotateToZero(resampled);
  const scaled = scaleTo(rotated, SQUARE_SIZE);
  const translated = translateTo(scaled, ORIGIN);
  
  let bestScore = -1;
  let bestName = "unknown";
  
  for (const template of templates) {
    const d = pathDistance(translated, template.points);
    const score = 1.0 - d / (0.5 * Math.sqrt(SQUARE_SIZE * SQUARE_SIZE + SQUARE_SIZE * SQUARE_SIZE));
    if (score > bestScore) {
      bestScore = score;
      bestName = template.name;
    }
  }
  
  return { name: bestName, score: bestScore };
}

// Pre-defined templates with variations for better accuracy
export const GESTURE_TEMPLATES = [
  // Circles
  {
    name: "circle",
    points: resample(Array.from({ length: 32 }, (_, i) => {
      const angle = (i / 31) * Math.PI * 2;
      return { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 };
    }), NUM_POINTS)
  },
  {
    name: "circle", // Counter-clockwise
    points: resample(Array.from({ length: 32 }, (_, i) => {
      const angle = (i / 31) * Math.PI * 2;
      return { x: Math.cos(-angle) * 100, y: Math.sin(-angle) * 100 };
    }), NUM_POINTS)
  },
  {
    name: "circle", // Oval horizontal
    points: resample(Array.from({ length: 32 }, (_, i) => {
      const angle = (i / 31) * Math.PI * 2;
      return { x: Math.cos(angle) * 150, y: Math.sin(angle) * 80 };
    }), NUM_POINTS)
  },

  // Underlines — 只保留真正水平/略斜的横线，不要有弯折
  {
    name: "underline", // Standard L-to-R
    points: resample([{ x: 0, y: 0 }, { x: 200, y: 0 }], NUM_POINTS)
  },
  {
    name: "underline", // R-to-L
    points: resample([{ x: 200, y: 0 }, { x: 0, y: 0 }], NUM_POINTS)
  },
  {
    name: "underline", // 略向右下斜（最常见手写横线）
    points: resample([{ x: 0, y: 0 }, { x: 200, y: 25 }], NUM_POINTS)
  },
  {
    name: "underline", // 略向右上斜
    points: resample([{ x: 0, y: 0 }, { x: 200, y: -25 }], NUM_POINTS)
  },

  // Checkmarks — 必须有明显的「先下折、后右上扬」折线特征，与横线区别拉大
  {
    name: "checkmark", // 标准 √：左上→右下→右上，折角明显
    points: resample([{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 180, y: -30 }], NUM_POINTS)
  },
  {
    name: "checkmark", // 较短的勾，右侧上扬更陡
    points: resample([{ x: 0, y: 0 }, { x: 35, y: 90 }, { x: 130, y: -10 }], NUM_POINTS)
  },
  {
    name: "checkmark", // 圆润版，带平滑过渡
    points: resample([{ x: 0, y: 0 }, { x: 30, y: 50 }, { x: 60, y: 80 }, { x: 100, y: 40 }, { x: 180, y: -40 }], NUM_POINTS)
  },
  {
    name: "checkmark", // 粗勾（折点靠右）
    points: resample([{ x: 0, y: 10 }, { x: 60, y: 100 }, { x: 200, y: -20 }], NUM_POINTS)
  },
  {
    name: "checkmark", // 反方向勾（右→中→左上）
    points: resample([{ x: 180, y: -30 }, { x: 50, y: 80 }, { x: 0, y: 0 }], NUM_POINTS)
  },
].map(t => ({
  ...t,
  points: translateTo(scaleTo(t.points, SQUARE_SIZE), ORIGIN)
}));
