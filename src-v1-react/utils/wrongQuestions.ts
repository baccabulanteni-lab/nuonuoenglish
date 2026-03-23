import { Question } from '../constants';

export interface WrongQuestion {
  id: string;
  type: 'grammar' | 'reading';
  data: any;
  timestamp: number;
}

export const saveWrongQuestion = (type: 'grammar' | 'reading', data: any) => {
  const existing = localStorage.getItem('wrong_questions');
  let questions: WrongQuestion[] = existing ? JSON.parse(existing) : [];
  
  // Create a unique ID based on question text
  const id = btoa(unescape(encodeURIComponent(data.text))).substring(0, 20);
  
  // Check if already exists
  if (questions.find(q => q.id === id)) return;
  
  questions.push({
    id,
    type,
    data,
    timestamp: Date.now()
  });
  
  localStorage.setItem('wrong_questions', JSON.stringify(questions));
};

export const getWrongQuestions = (): WrongQuestion[] => {
  const existing = localStorage.getItem('wrong_questions');
  return existing ? JSON.parse(existing) : [];
};

export const removeWrongQuestion = (id: string) => {
  const existing = localStorage.getItem('wrong_questions');
  if (!existing) return;
  let questions: WrongQuestion[] = JSON.parse(existing);
  questions = questions.filter(q => q.id !== id);
  localStorage.setItem('wrong_questions', JSON.stringify(questions));
};
