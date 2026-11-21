export const quizRules = Object.freeze({
  maxQuestions: 50,
  optionCount: 4,
  maxPrompt: 240,
  maxOption: 120,
  defaultSeconds: 20,
  minSeconds: 5,
  maxSeconds: 300,
  defaultMultiplier: 1,
  maxMultiplier: 10,
  maxImageBytes: 192 * 1024,
  maxImageSide: 1440,
  maxSourceBytes: 12 * 1024 * 1024,
  pageSize: 10
});

export function validSeconds(value) {
  return Number.isInteger(value) && value >= quizRules.minSeconds && value <= quizRules.maxSeconds;
}

export function validMultiplier(value) {
  return Number.isFinite(value) && value >= 0 && value <= quizRules.maxMultiplier
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}
