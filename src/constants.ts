export interface Question {
  id?: string;
  topicId: string; // Legacy field for compatibility
  topicIds?: string[];
  catId?: string;
  text: string;
  options: string[];
  answer: number;
  tag: string;
  source?: string;
  keyPoint: string;
  knowledgeId?: string;
}

export interface GrammarTopic {
  id: string;
  name: string;
  enName: string;
  desc: string;
  icon: string;
  category: string;
  questionCount?: number;
}

export interface KnowledgePoint {
  id?: string;
  title: string;
  enTitle: string;
  coreConcept: string;
  formula?: {
    label: string;
    items: { condition: string; structure: string }[];
  }[];
  examples: { en: string; cn: string; tips?: string }[];
  content?: string;
}

export interface ReadingArticle {
  id: string;
  source?: string;
  article: { id: string; text: string; highlightIds?: number[] }[];
  questions: { id: number; text: string; options: string[]; answer: number; evidenceId?: string; analysis?: string }[];
}

export const READING_DATA: ReadingArticle = {
  id: 'r1',
  article: [
    { id: 'p1', text: "The concept of 'minimalism' has gained significant traction in recent years. It is not merely about owning fewer possessions, but rather about intentionally choosing what adds value to one's life. " },
    { id: 'p2', text: "Many students find themselves overwhelmed by the sheer volume of study materials. By applying minimalist principles to their study habits, they can reduce anxiety and improve focus. ", highlightIds: [1] },
    { id: 'p3', text: "This approach involves curating the best resources, eliminating distractions, and focusing on deep, meaningful learning sessions instead of superficial multitasking.", highlightIds: [2] }
  ],
  questions: [
    { id: 1, text: "According to the passage, applying minimalist principles to study habits can help students to:", options: ["Buy more books", "Reduce anxiety and improve focus", "Multitask better", "Ignore their exams"], answer: 1, evidenceId: 'p2' },
    { id: 2, text: "What does the minimalist approach to learning prioritize?", options: ["Superficial reading", "Owning fewer pens", "Deep, meaningful learning sessions", "Taking frequent breaks"], answer: 2, evidenceId: 'p3' }
  ]
};
