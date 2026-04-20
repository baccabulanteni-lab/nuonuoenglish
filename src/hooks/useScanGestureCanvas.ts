import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type * as React from 'react';
import { recognize, GESTURE_TEMPLATES, type Point } from '../utils/gestureRecognizer';
import { pointerEventToCanvas } from '../utils/pointerEventToCanvas';
import type { WordStatus, ModuleMode } from '../types/vocabularyWord';

export type UseScanGestureCanvasParams = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  activeMode: ModuleMode;
  scanCorpusPending: boolean;
  vocabListLength: number;
  isStatusDetermined: boolean;
  lastWordSwitchTime: number;
  /** 由调用方在定义完 applyMarkAndStay 后每轮渲染更新 current */
  onGestureMarkRef: MutableRefObject<(status: WordStatus) => void>;
};

/**
 * 扫词画布：笔迹采集、模糊手势识别、document 级 pointer 监听清理。
 */
export function useScanGestureCanvas({
  canvasRef,
  activeMode,
  scanCorpusPending,
  vocabListLength,
  isStatusDetermined,
  lastWordSwitchTime,
  onGestureMarkRef,
}: UseScanGestureCanvasParams) {
  const strokeDocListenersRef = useRef<{
    move: (ev: PointerEvent) => void;
    end: (ev: PointerEvent) => void;
  } | null>(null);
  const isDrawing = useRef(false);
  const points = useRef<Point[]>([]);

  type BitmapStroke = { pts: { x: number; y: number }[]; gray: boolean };
  /** 当前词上多段笔迹；仅 clearCanvas（切词）时清空，识别失败保留 */
  const bitmapStrokesRef = useRef<BitmapStroke[]>([]);

  const lineStyleForGray = (canvas: HTMLCanvasElement, gray: boolean) => {
    const rw = Math.max(canvas.clientWidth, 1e-6);
    const scale = canvas.width / rw;
    // 扫词主笔：与顶部循环日圆点同色 #b58361；判档后：深灰绿 #3a4740
    const baseCss = gray ? 2.75 : 3.35;
    const lineWidth = Math.max(baseCss * scale, gray ? 5.5 : 7);
    /** 与界面循环日圆点同色（用户截图取色 ≈ #B58361） */
    const morandiYellowMain = '#b58361';
    const afterMarkStroke = '#3a4740';
    return {
      lineWidth,
      strokeStyle: gray ? afterMarkStroke : morandiYellowMain,
      fillStyle: gray ? afterMarkStroke : morandiYellowMain,
      globalAlpha: gray ? 0.8 : 0.9,
    };
  };

  const redrawAllBitmapStrokes = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const strokes = bitmapStrokesRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (strokes.length === 0) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const s of strokes) {
      const pts = s.pts;
      if (pts.length === 0) continue;
      const st = lineStyleForGray(canvas, s.gray);
      ctx.strokeStyle = st.strokeStyle;
      ctx.fillStyle = st.fillStyle;
      ctx.lineWidth = st.lineWidth;
      ctx.globalAlpha = st.globalAlpha;

      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, st.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      points.current = [];
      bitmapStrokesRef.current = [];
    }
  };

  const analyzeGesture = () => {
    // 循环复习：仅作书写/涂写，不触发任何手势分类识别
    if (activeMode === 'review') {
      points.current = [];
      return;
    }
    if (isStatusDetermined) return;
    if (points.current.length < 5) return;

    const result = recognize(points.current, GESTURE_TEMPLATES);

    const xs = points.current.map((p) => p.x);
    const ys = points.current.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const now = Date.now();
    const strokeStartTime = points.current[0]?.timestamp || 0;

    if (strokeStartTime < lastWordSwitchTime || now - lastWordSwitchTime < 500) {
      clearCanvas();
      return;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    const start = points.current[0];
    const end = points.current[points.current.length - 1];
    let pathLen = 0;
    for (let i = 1; i < points.current.length; i++) {
      const a = points.current[i - 1];
      const b = points.current[i];
      pathLen += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const chordLen = Math.hypot(end.x - start.x, end.y - start.y);
    /** 越接近 1 越像直线；弧形勾 / U 形会明显变小 */
    const straightness = chordLen / Math.max(pathLen, 1e-6);

    const distStartEnd = Math.sqrt(Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2));
    const isClosed = distStartEnd < Math.max(width, height) * 0.6;

    const THRESHOLD = 0.65;
    const mark = (s: WordStatus) => onGestureMarkRef.current(s);

    // 勾的特征：路径中必然存在一个「最低点」（即 dip），且该点应明显低于（Y更大）终点
    const dipY = Math.max(...ys);
    // 勾形特征：最低点比终点低（上扬高度）
    const checkmarkMidDip = dipY - end.y;

    if (result.score > THRESHOLD) {
      if (result.name === 'circle') {
        // 约定：画圈 = 生词（判定闭合度与宽高比）
        if (isClosed && width > 15 && height > 15) {
          mark('new');
        }
      } else if (result.name === 'checkmark') {
        // ⚠️ checkmark 模板与横线容易混淆，需要几何二次过滤：
        // 「横线」特征：宽扁、直线度高、终点不明显高于起点
        // 「勾」特征：有明显的「先下折后右上扬」，终点比中段高（checkmarkMidDip > 0）
        const ySpan = Math.abs(start.y - end.y);
        const underlineYtol = Math.max(20, width * 0.25, height * 0.9);
        // 横线判断：放宽直线度（0.72）和高度容差（60），允许略斜的自然横划
        const isHorizontalUnderline =
          width > 28 &&
          height < 60 &&
          width > height * 1.3 &&
          straightness > 0.72 &&
          ySpan < underlineYtol;
        // 勾的强制条件：终点必须明显比路径中段高（先折下再上扬）
        const hasCheckmarkUpturn = checkmarkMidDip > Math.max(8, height * 0.2);

        if (isHorizontalUnderline) {
          mark('familiar_70');
        } else if (hasCheckmarkUpturn && height > 10 && width > 10) {
          mark('familiar_100');
        }
      } else if (result.name === 'underline') {
        // 约定：下划线 = 七分熟
        if (width > 20) mark('familiar_70');
      }
    } else {
      // 低置信保洁：针对快速挥动手势增加特定形状保底
      if (isClosed && width > 15 && height > 15) {
        mark('new');
      } else if (width > 35 && height < width * 0.8) {
        // 低置信：略斜横划仍可七分熟；要求终点上扬特征才认定全熟（防止横线误判）
        const ySp = Math.abs(start.y - end.y);
        const yTol = Math.max(20, width * 0.25, height * 0.9);
        if (straightness > 0.72 && height < 60 && width > height * 1.3 && ySp < yTol) {
          mark('familiar_70');
        } else if (checkmarkMidDip > Math.max(8, height * 0.2) || straightness < 0.72) {
          // 勾的「先下后上」特征或明显弯曲 = 全熟
          mark('familiar_100');
        }
      } else if (height > 30 && width > 15 && checkmarkMidDip > Math.max(8, height * 0.2)) {
        // 中段明显低于终点（勾形） = 全熟
        mark('familiar_100');
      }
    }
  };

  useEffect(() => {
    return () => {
      const l = strokeDocListenersRef.current;
      if (l) {
        document.removeEventListener('pointermove', l.move);
        document.removeEventListener('pointerup', l.end);
        document.removeEventListener('pointercancel', l.end);
        strokeDocListenersRef.current = null;
      }
    };
  }, []);

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current!;
    const { cssX, cssY, drawX, drawY } = pointerEventToCanvas(e, canvas);

    // 循环复习只写不识别：不记录点位，避免误触发分类与内存增长
    if (!isStatusDetermined && activeMode !== 'review') {
      const pts = points.current;
      const last = pts[pts.length - 1];
      // 增加距离阈值过滤，减少静止/堆积点对几何识别（如中点/重心计算）的干扰
      if (!last || Math.hypot(last.x - cssX, last.y - cssY) > 0.5) {
        pts.push({ x: cssX, y: cssY, timestamp: Date.now() });
      }
    }

    const strokes = bitmapStrokesRef.current;
    const cur = strokes[strokes.length - 1];
    if (!cur) return;
    const pts = cur.pts;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - drawX, last.y - drawY) < 0.4) return;
    pts.push({ x: drawX, y: drawY });
    redrawAllBitmapStrokes();
  };

  const stopDrawing = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;

    if (!isStatusDetermined) {
      const gesturePointCount = points.current.length;
      analyzeGesture();
      // 扫词：误点 / 过短一笔（不进入手势识别）不保留笔迹，避免孤立小圆点；复习模式不采集 points，不此处 pop
      if (
        activeMode === 'scan' &&
        gesturePointCount > 0 &&
        gesturePointCount < 5 &&
        bitmapStrokesRef.current.length > 0
      ) {
        bitmapStrokesRef.current.pop();
        redrawAllBitmapStrokes();
      }
    }
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (activeMode === 'dictation') return;
    if (scanCorpusPending || vocabListLength === 0) return;
    const elTarget = e.target as HTMLElement | null;
    if (elTarget?.closest('button')) return;
    if (isDrawing.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    isDrawing.current = true;
    if (e.pointerType === 'touch') {
      e.preventDefault();
    }
    const pid = e.pointerId;
    const { cssX, cssY, drawX, drawY } = pointerEventToCanvas(e, canvas);

    if (!isStatusDetermined && activeMode !== 'review') {
      points.current = [{ x: cssX, y: cssY, timestamp: Date.now() }];
    }

    bitmapStrokesRef.current.push({ pts: [{ x: drawX, y: drawY }], gray: isStatusDetermined });
    redrawAllBitmapStrokes();

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      draw(ev as unknown as React.PointerEvent<HTMLCanvasElement>);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      strokeDocListenersRef.current = null;
      stopDrawing();
    };
    strokeDocListenersRef.current = { move, end };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  };

  return { clearCanvas, startDrawing };
}
