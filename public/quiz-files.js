import { quizRules as rules } from './quiz-rules.js';

const format = 'quiz-night';
const version = 1;
const jpegPrefix = 'data:image/jpeg;base64,';

export function downloadQuiz(quiz) {
  const file = new Blob([JSON.stringify({ format, version, quiz })], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  const name = quiz.title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '');
  link.download = (name || 'My Quiz') + '.quiz.json';
  link.href = url;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function validText(value, max) {
  return typeof value === 'string' && value.length <= max;
}

function validSetting(value) {
  // Drafts can contain an empty or out-of-range number. Hosting validates the final settings.
  return Number.isFinite(value) || (typeof value === 'string' && (value === '' || Number.isFinite(Number(value))));
}

function validPicture(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || !value.startsWith(jpegPrefix) ||
      value.length > jpegPrefix.length + 4 * Math.ceil(rules.maxImageBytes / 3)) return false;
  const encoded = value.slice(jpegPrefix.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const bytes = atob(encoded);
  return bytes.length >= 4 && bytes.length <= rules.maxImageBytes &&
    bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(2) === 255 &&
    bytes.charCodeAt(bytes.length - 2) === 255 && bytes.charCodeAt(bytes.length - 1) === 217;
}

export async function readQuizFile(file) {
  if (file.size > 16 * 1024 * 1024) throw new Error('Choose a Quiz Night file smaller than 16 MB.');
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { throw new Error('Could not read this file. Choose a .quiz.json file from Quiz Night.'); }
  if (data?.format !== format || data.version !== version) {
    throw new Error('This file format is unsupported. Choose a .quiz.json file from Quiz Night.');
  }
  const quiz = data.quiz;
  if (!validText(quiz?.title, 60) || !Array.isArray(quiz.questions) ||
      quiz.questions.length < 1 || quiz.questions.length > rules.maxQuestions) {
    throw new Error('The saved quiz needs a title field and 1 to 50 questions.');
  }
  const questions = quiz.questions.map((q, index) => {
    if (!validText(q?.prompt, rules.maxPrompt) || !Array.isArray(q.options) || q.options.length !== rules.optionCount ||
        !q.options.every(option => validText(option, rules.maxOption)) || !Number.isInteger(q.correct) ||
        q.correct < 0 || q.correct >= rules.optionCount || !validText(q.imageAlt ?? '', 180) ||
        !validSetting(q.seconds) || !validSetting(q.multiplier) || !validPicture(q.imageData)) {
      throw new Error('Question ' + (index + 1) + ' in this file could not be read.');
    }
    return {
      prompt: q.prompt, options: q.options, correct: q.correct, seconds: q.seconds, multiplier: q.multiplier,
      imageData: q.imageData || null, imageAlt: q.imageAlt || ''
    };
  });
  return { title: quiz.title, questions };
}
