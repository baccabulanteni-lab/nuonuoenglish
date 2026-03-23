import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './UI';
import { PenLine, Eraser, Sparkles, RefreshCw, Trash2, Type, Edit } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

// ==========================================
// 专属定制：极简风格 Markdown 渲染引擎
// ==========================================
const renderMarkdown = (text: string) => {
  if (!text) return null;
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const parseBold = (str: string) => {
    let safeStr = str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return safeStr.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>');
  };

  const flushTable = () => {
     if (tableRows.length > 0) {
        const validRows = tableRows.filter(row => !row[0].replace(/\|/g,'').match(/^[-:\s]+$/));
        if (validRows.length > 1) {
            elements.push(
              <div key={`table-${elements.length}`} className="overflow-hidden my-8 border border-gray-100 rounded-2xl shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-[#faf9f6] text-[#b58362] font-serif tracking-widest border-b border-gray-100 whitespace-nowrap">
                        <tr>{validRows[0].map((h, i) => <th key={i} className="px-6 py-4 font-bold">{h.replace(/\*\*/g, '')}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {validRows.slice(1).map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                            {row.map((cell, j) => <td key={j} className="px-6 py-4 text-gray-700 whitespace-nowrap" dangerouslySetInnerHTML={{__html: parseBold(cell)}} />)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                </div>
              </div>
            );
        }
        tableRows = [];
        inTable = false;
     }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('|')) {
       inTable = true;
       const cells = line.split('|').map(c => c.trim()).slice(1, -1);
       if (cells.length > 0) tableRows.push(cells);
       continue;
    } else if (inTable) {
       flushTable();
    }

    if (line.startsWith('### ')) {
       elements.push(<h3 key={i} className="text-lg md:text-xl font-serif font-bold text-gray-800 mt-10 mb-5 flex items-center gap-2.5"><span className="w-1.5 h-4 bg-[#b58362] rounded-full"></span>{line.replace('### ', '')}</h3>);
    } else if (line.includes('预估分数：')) {
       elements.push(
         <div key={i} className="bg-[#fcfbf9] rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm mb-8 mt-2 flex flex-col items-center justify-center gap-3">
            <div className="text-xs tracking-widest text-gray-400 font-medium">ESTIMATED SCORE</div>
            <div className="text-2xl md:text-3xl font-serif text-[#b58362] font-bold text-center leading-relaxed" dangerouslySetInnerHTML={{__html: parseBold(line.replace(/^(1\.\s*)?\*\*预估分数：\*\*\s*/, ''))}} />
         </div>
       );
    } else if (line.match(/^\*\s*\*\*(.*?)\*\*(.*)/)) {
       const typeMatch = line.match(/^\*\s*\*\*(.*?)\*\*(.*)/);
       if (typeMatch) {
         const type = typeMatch[1].replace(/[：:]$/, ''); 
         const content = typeMatch[2];
         const isCorrection = type.includes('修改');
         const isReason = type.includes('理由');
         
         const colorClass = isCorrection ? 'text-[#4a7c59] bg-[#f4f8f4] border border-[#e2efe2]' : isReason ? 'text-[#c98a6c] bg-[#fdf6f0] border border-[#fae5d3]' : 'text-gray-500 bg-gray-50 border border-gray-100';

         elements.push(
           <div key={i} className={`flex gap-3 mb-3 text-sm md:text-base ${type.includes('原句') ? 'mt-8' : ''}`}>
             <span className={`shrink-0 font-medium px-2.5 py-1 rounded-lg text-xs mt-0.5 ${colorClass}`}>
               {type}
             </span>
             <span className="text-gray-700 leading-relaxed flex-1 pt-0.5" dangerouslySetInnerHTML={{__html: parseBold(content)}} />
           </div>
         );
       }
    } else if (line.match(/^[-*] /)) {
       elements.push(<li key={i} className="ml-5 mb-2 text-gray-700 leading-relaxed list-disc marker:text-[#b58362]" dangerouslySetInnerHTML={{__html: parseBold(line.substring(2))}} />);
    } else if (line.match(/^\d+\. /)) {
       elements.push(<li key={i} className="ml-5 mb-2 text-gray-700 leading-relaxed list-decimal marker:text-gray-400" dangerouslySetInnerHTML={{__html: parseBold(line.replace(/^\d+\. /, ''))}} />);
    } else if (line) {
       elements.push(<p key={i} className="mb-4 text-gray-700 leading-loose md:leading-loose text-sm md:text-base font-serif" dangerouslySetInnerHTML={{__html: parseBold(line)}} />);
    }
  }
  flushTable();

  return <div className="pb-10">{elements}</div>;
};

export default function EssayModule() {
  const [text, setText] = useState("");
  const [isGraded, setIsGraded] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [reportData, setReportData] = useState("");
  const [progressStage, setProgressStage] = useState(0);
  const PROGRESS_STAGES = [
    "正在建立 AI 阅卷连接...",
    "正在识别与提取文本内容...",
    "正在逐句排查语法与拼写...",
    "正在匹配专升本高分词汇...",
    "正在生成零错误满分范文..."
  ];

  const [topic, setTopic] = useState("Write an essay about the impact of mobile phones on people's lives. You should write at least 120 words.");
  const [isEditingTopic, setIsEditingTopic] = useState(false);

  const [inputType, setInputType] = useState<'text' | 'handwriting'>('handwriting'); 
  const [activeTool, setActiveTool] = useState<'pen' | 'eraser'>('pen'); 
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const points = useRef<any[]>([]); 
  const hasDrawn = useRef(false); 
  const lastWidth = useRef(0); 

  useEffect(() => {
    if (inputType === 'handwriting' && canvasRef.current && !isGraded) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [inputType, isGraded]);

  const getCoords = (e: any) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    
    let pressure = e.pressure !== undefined ? e.pressure : 0.5;
    if (e.pointerType === 'mouse') pressure = 0.5;

    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      pressure: pressure,
      time: Date.now()
    };
  };

  const getPenWidth = (pressure: number, velocity: number) => {
    const isMobile = window.innerWidth < 768;
    if (activeTool === 'eraser') {
      const baseEraserWidth = isMobile ? 36 : 48;
      const pressureFactor = (pressure === 0.5 || pressure === 0) ? 1 : (0.5 + pressure);
      return baseEraserWidth * pressureFactor;
    }
    
    const baseWidth = isMobile ? 1.4 : 1.6; 
    const maxMultiplier = 1.25; 
    const minMultiplier = 0.85; 

    const vFactor = Math.max(0, Math.min(1, velocity / 5)); 
    const simulatedPressure = 1 - vFactor; 
    
    const finalPressure = (pressure === 0.5 || pressure === 0) ? simulatedPressure : pressure;
    const width = baseWidth * (minMultiplier + (maxMultiplier - minMultiplier) * finalPressure);
    return width * 2; 
  };

  const startDrawing = (e: React.PointerEvent) => {
    isDrawing.current = true;
    hasDrawn.current = true;
    const pt = getCoords(e);
    
    points.current = [pt]; 
    lastWidth.current = getPenWidth(pt.pressure, 0);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, lastWidth.current / 2, 0, Math.PI * 2);
    ctx.fillStyle = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : 'rgba(25,25,28,0.95)';
    ctx.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fill();
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing.current || !canvasRef.current) return;
    const pt = getCoords(e);
    const prevPt = points.current[points.current.length - 1];
    
    const dx = pt.x - prevPt.x;
    const dy = pt.y - prevPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = pt.time - prevPt.time;
    const velocity = dt > 0 ? dist / dt : 0;
    
    points.current.push(pt);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    const targetWidth = getPenWidth(pt.pressure, velocity);
    const currentWidth = lastWidth.current + (targetWidth - lastWidth.current) * 0.25;
    lastWidth.current = currentWidth;

    ctx.lineWidth = currentWidth; 
    ctx.strokeStyle = 'rgba(25,25,28,0.95)'; 
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (activeTool === 'pen') {
      ctx.shadowBlur = 0.3;
      ctx.shadowColor = 'rgba(25,25,28,0.8)';
    } else {
      ctx.shadowBlur = 0;
    }
    
    ctx.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';

    if (points.current.length >= 3) {
      const p0 = points.current[points.current.length - 3];
      const p1 = points.current[points.current.length - 2];
      const p2 = points.current[points.current.length - 1];
      
      const mid1X = (p0.x + p1.x) / 2;
      const mid1Y = (p0.y + p1.y) / 2;
      const mid2X = (p1.x + p2.x) / 2;
      const mid2Y = (p1.y + p2.y) / 2;

      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    isDrawing.current = false;
    points.current = []; 
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn.current = false;
    }
  };

  const handleGrade = async () => {
    if (inputType === 'text' && !text.trim()) {
       setReportData("### 一、 预估分数与整体评价\n**预估分数：0 / 100 分**\n**整体评价：**\n您还没有输入任何内容哦，请先在空白处输入您的作文再点击批阅！");
       setIsGraded(true); return;
    }
    if (inputType === 'handwriting' && !hasDrawn.current) {
       setReportData("### 一、 预估分数与整体评价\n**预估分数：0 / 100 分**\n**整体评价：**\n您还没有在画板上写字哦，拿起画笔写下您的作文再点击批阅吧！");
       setIsGraded(true); return;
    }

    setProgressStage(0);
    setIsAnimating(true);
    
    const progressInterval = setInterval(() => {
      setProgressStage(prev => (prev < PROGRESS_STAGES.length - 1 ? prev + 1 : prev));
    }, 1200);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const systemPrompt = `# Role
你是一位极其专业、严谨且富有鼓励精神的中国“专升本”英语考试阅卷官。你的核心任务是精准指出学生的错误，并提供能够切实【加分】的词汇与句式升级方案。

# 绝对打分公式 (SCORING RUBRIC)
你必须严格按照以下公式计算最终得分（满分100分），保持给分绝对稳定：
- 基础分：满分 100 分。
- 扣分项：每处拼写/标点/大小写错误扣 2 分；每处基础语法错误（时态、单复数、介词等）扣 3 分；每处严重句型错误（中式英语、缺主谓）扣 5 分；偏题或漏要点扣 10 分。
（用 100 减去扣分总和，最低10分）。

# Workflow & Output Format
请严格按照以下 Markdown 格式输出：

### 零、 你的原文
（将学生提交的原始作文内容完整展示在这里。如果是图片手写作文，请输出你识别到的所有英文内容。）

### 一、 预估分数与整体评价
**预估分数：[此处输出通过扣分公式计算出的准确分数] / 100 分**
**整体评价：**
（用一段话，先肯定文章的优点和思路，然后精准点出最大的提分空间是什么。）

### 二、 语法与用词修改建议（精准揪错）
逐句排查错误，保持学生原有的句子骨架。
【重要逻辑】：如果全文没有任何语法错误，请不要硬编错误！直接输出一句：“👏 太棒了！本文没有发现基础语法错误，基本功非常扎实！”
如果有错误，请按以下格式列出（只需列出真正有错的句子）：
* **原句：** [摘录原句]
* **修改：** [提供修改后的正确句子，将修改的部分用 **加粗** 标出]
* **理由：** [用大白话解释语法错误，并说明为什么这样改能得分]

### 三、 专升本加分替换建议（升阶表达）
找出文中表达普通、平淡的词汇。提供的替换词必须是能够【切实加分】的高级表达（以专升本/四级核心加分词汇为主，拒绝生僻怪词）。
| 原基础表达 (普通水平) | 专升本加分替换方案 (高分水平) |
| --- | --- |
| [原词1] | [加分替换词1] |
| [原词2] | [加分替换词2] |

### 四、 满分实战范文 (90分升阶版)
【字数与难度双重红线】（极为重要，必须严格遵守）：
1. **严格字数对标**：提取“User Input (题目要求)”中的字数限制。如果要求至少 120 词，范文必须严格控制在 120-140 词之间。绝不能为了凑字数而啰嗦，也不能字数不达标。
2. **绝对的词汇天花板**：严禁使用雅思、托福或超纲生僻词（例如：绝对不准使用 meticulousness, rejuvenate, profoundly, deteriorating 等词）！词汇难度**最高只能到大学英语四级（CET-4）**水平。

【90分升阶密码（靠句型，不靠难词）】：
既然不能用生僻词，你必须通过以下三种方式将作文提升到 90分+ 的水平：
- **句式多样化**：灵活使用非谓语动词（Doing/Done作状语）、定语从句（which/who/that）、名词性从句等专升本核心语法点，告别清一色的简单句。
- **高级连词**：使用地道的逻辑连接词（如 Furthermore, Consequently, To begin with, On the contrary）来替代普通的 and, so, but。
- **准确的四级搭配**：使用四级范围内的精准词组（如 play a vital role in 替代 is very important）。

【内容重塑】：
完全基于学生的原文思路和结构进行重塑，不脱离原意。正文请使用 **加粗** 显示，并确保段落排版清晰。`;

      const currentTopic = topic.trim() || "无特定题目，请自由发挥，字数不少于120字。";
      
      let contents: any = [];
      
      if (inputType === 'handwriting') {
        const canvas = canvasRef.current!;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvas.width;
        exportCanvas.height = canvas.height;
        const exportCtx = exportCanvas.getContext('2d')!;
        exportCtx.fillStyle = '#ffffff';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        exportCtx.drawImage(canvas, 0, 0);
        
        const dataUrl = exportCanvas.toDataURL('image/png');
        const base64Data = dataUrl.split(',')[1];
        
        contents = [{
          parts: [
            { text: `题目要求：${currentTopic}\n学生作文：见下方附图。（请作为英语考官，首先识别图片中的手写英文作文，然后严格按照设定的 Markdown 四大模块要求进行批改。如果图片中完全没有英文文字或只是乱画，请委婉地给0分并提醒学生好好写字。）` },
            { inlineData: { mimeType: "image/png", data: base64Data } }
          ]
        }];
      } else {
        contents = [{
          parts: [{ text: `题目要求：${currentTopic}\n学生作文：${text}` }]
        }];
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-09-2025",
        contents,
        config: { systemInstruction: systemPrompt }
      });

      if (response.text) {
        setReportData(response.text);
        setIsGraded(true);
      }
    } catch (error) {
      console.error(error);
      setReportData("### 零、 你的原文\n（离线状态，无法获取原文内容）\n\n### 一、 预估分数与整体评价\n**预估分数：0 / 100 分**\n**整体评价：**\n网络似乎开了小差，无法连接到 AI 引擎。请检查您的网络连接并刷新后重试。\n\n### 二、 语法与用词修改建议（精准揪错）\n* **原句：** （无法获取原文内容）\n* **修改：** （需联网后进行智能批改）\n* **理由：** 离线状态下无法使用错题分析功能。\n\n### 三、 专升本加分替换建议（升阶表达）\n| 原基础表达 (普通水平) | 专升本加分替换方案 (高分水平) |\n| --- | --- |\n| bad network | connection timeout |\n\n### 四、 满分实战范文 (90分升阶版)\n**In contemporary society, it is widely acknowledged that internet connection is indispensable...**");
      setIsGraded(true);
    } finally {
      clearInterval(progressInterval);
      setIsAnimating(false);
    }
  };

  const reset = () => { 
    setIsGraded(false); 
    setReportData("");
    hasDrawn.current = false;
  };

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 animate-fade-in relative bg-white md:overflow-y-auto hide-scrollbar min-h-0">
      <div className="flex justify-between items-center mb-3 md:mb-4 shrink-0">
        <h2 className="text-xl md:text-2xl font-serif text-gray-800">智能批改</h2>
        {isGraded ? (
          <button onClick={reset} className="text-xs md:text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 md:gap-2"><RefreshCw size={14}/> 重新输入</button>
        ) : (
          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl shadow-inner border border-gray-100">
            <button onClick={() => setInputType('text')} className={cn("p-1.5 md:p-2 md:px-4 rounded-lg text-xs md:text-sm transition-all font-medium flex items-center gap-1.5", inputType === 'text' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600')}><Type size={14} className="hidden md:block"/> 键盘</button>
            <button onClick={() => setInputType('handwriting')} className={cn("p-1.5 md:p-2 md:px-4 rounded-lg text-xs md:text-sm transition-all font-medium flex items-center gap-1.5", inputType === 'handwriting' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600')}><PenLine size={14} className="hidden md:block"/> 手写</button>
          </div>
        )}
      </div>

      {!isGraded ? (
        <div className="flex-1 flex flex-col md:flex-row relative pb-10 md:pb-2 gap-4 md:gap-6">
          <div className="md:w-[30%] flex flex-col shrink-0">
            <div className="flex justify-between items-end mb-2 md:mb-3">
               <div className="text-xs md:text-sm text-gray-400 tracking-wide font-medium flex items-center gap-2">
                 作文题目 / Topic
                 {!isEditingTopic && (
                   <button 
                     onClick={() => setIsEditingTopic(true)} 
                     className="text-[#b58362] hover:text-[#91674a] transition-colors p-1 rounded-md hover:bg-[#b58362]/10" 
                   >
                     <Edit size={13} strokeWidth={2.5} />
                   </button>
                 )}
               </div>
               {inputType === 'handwriting' && <span className="text-[10px] text-[#b58362] md:hidden">支持手指直接书写</span>}
            </div>

            {isEditingTopic ? (
               <div className="flex flex-col gap-2 animate-fade-in z-20">
                 <textarea
                   value={topic}
                   onChange={(e) => setTopic(e.target.value)}
                   className="w-full text-sm text-gray-700 leading-relaxed bg-white p-4 rounded-2xl border-2 border-[#b58362]/40 focus:border-[#b58362] outline-none font-serif resize-none min-h-[160px] shadow-[0_4px_15px_rgba(181,131,98,0.1)] transition-colors"
                   placeholder="请输入或粘贴您的作文题目及具体要求..."
                   autoFocus
                 />
                 <div className="flex justify-end gap-3 mt-1">
                   <button 
                     onClick={() => setTopic('')} 
                     className="px-4 py-2 bg-gray-100 text-gray-500 text-xs font-medium rounded-xl hover:bg-gray-200 hover:text-gray-700 transition-colors shadow-sm flex items-center gap-1"
                   >
                     <Trash2 size={12} /> 清空
                   </button>
                   <button 
                     onClick={() => setIsEditingTopic(false)} 
                     className="px-5 py-2 bg-gray-900 text-white text-xs font-medium rounded-xl hover:bg-black transition-colors shadow-sm"
                   >
                     保存题目
                   </button>
                 </div>
               </div>
            ) : (
               <div 
                 onClick={() => setIsEditingTopic(true)} 
                 className="cursor-pointer group relative text-sm text-gray-600 leading-relaxed bg-gray-50 p-5 rounded-2xl border border-gray-100 font-serif hover:border-[#b58362]/30 hover:bg-[#faf9f6] transition-all"
               >
                 <p className="line-clamp-4 md:line-clamp-none whitespace-pre-wrap">
                   {topic || "点击输入自定义作文题目..."}
                 </p>
                 <div className="absolute inset-0 bg-black/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="bg-white/95 text-gray-700 text-xs px-3.5 py-1.5 rounded-full font-sans shadow-sm flex items-center gap-1.5 backdrop-blur-sm">
                      <Edit size={12}/> 点击修改题目
                    </span>
                 </div>
               </div>
            )}
          </div>

          <div className="flex-1 md:w-[70%] flex flex-col relative min-h-0">
            {inputType === 'handwriting' && !isGraded && (
               <div className="flex justify-between items-center mb-3 px-1 shrink-0">
                  <span className="text-xs text-[#b58362] font-medium flex items-center gap-1.5">
                     <PenLine size={14}/> 支持手指或触控笔直接书写
                  </span>
                  <div className="flex items-center gap-1 bg-white px-1.5 py-1 rounded-xl shadow-sm border border-gray-100">
                     <button onClick={() => setActiveTool('pen')} className={cn("p-1.5 rounded-lg transition-all", activeTool === 'pen' ? 'bg-[#1a1a1a] text-white shadow-md' : 'text-gray-500 hover:bg-gray-100')}><PenLine size={16}/></button>
                     <button onClick={() => setActiveTool('eraser')} className={cn("p-1.5 rounded-lg transition-all", activeTool === 'eraser' ? 'bg-[#1a1a1a] text-white shadow-md' : 'text-gray-500 hover:bg-gray-100')}><Eraser size={16}/></button>
                     <div className="w-px h-4 bg-gray-200 mx-1"></div>
                     <button onClick={clearCanvas} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"><Trash2 size={16}/></button>
                  </div>
               </div>
            )}

            <div className="relative rounded-2xl border border-gray-100 bg-[#FAF9F5] shadow-inner overflow-hidden flex flex-col min-h-[300px] md:min-h-[450px]">
              {isAnimating && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-[3px] z-40 flex flex-col items-center justify-center pointer-events-none animate-fade-in">
                  <div className="w-12 h-12 rounded-full border-[3px] border-gray-200 border-t-[#b58362] animate-spin mb-5"></div>
                  <div className="text-gray-800 font-serif text-sm md:text-base font-medium mb-3 tracking-widest text-center px-4">
                    {PROGRESS_STAGES[progressStage]}
                  </div>
                  <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden shadow-inner">
                     <div
                       className="h-full bg-[#b58362] transition-all duration-700 ease-out"
                       style={{ width: `${((progressStage + 1) / PROGRESS_STAGES.length) * 100}%` }}
                     ></div>
                  </div>
                </div>
              )}

              {inputType === 'text' ? (
                <textarea value={text} onChange={(e) => setText(e.target.value)} className="w-full h-full min-h-[300px] bg-transparent resize-none outline-none font-serif text-gray-700 text-lg md:text-xl p-6 md:p-8 relative z-10 leading-loose" placeholder="尝试输入您自己的英文作文..." />
              ) : (
                <canvas 
                  ref={canvasRef}
                  onPointerDown={startDrawing}
                  onPointerMove={draw}
                  onPointerUp={stopDrawing}
                  onPointerOut={stopDrawing}
                  className="w-full h-full min-h-[300px] touch-none cursor-crosshair relative z-10"
                />
              )}
            </div>
            
            <div className="flex justify-end mt-4 pb-6 shrink-0">
              <button onClick={handleGrade} disabled={isAnimating} className="w-full md:w-auto md:px-8 py-4 md:py-3 rounded-xl md:rounded-2xl bg-[#1a1a1a] text-white text-sm md:text-base font-medium flex items-center justify-center gap-2 hover:bg-black transition-all shadow-md disabled:opacity-70">
                <Sparkles size={18} className={isAnimating ? "animate-pulse" : ""} /> 
                {isAnimating 
                  ? "AI 批阅中..." 
                  : "AI 智能批阅"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 md:overflow-y-auto hide-scrollbar pb-10 animate-fade-in min-h-0 md:px-12 md:max-w-4xl md:mx-auto w-full">
          {renderMarkdown(reportData)}
        </div>
      )}
    </div>
  );
}
