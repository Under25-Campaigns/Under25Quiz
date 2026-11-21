import { quizRules as rules, validMultiplier, validSeconds } from './quiz-rules.js';
import { escapeHtml } from './html.js';
import { saveQuiz } from './saved-quizzes.js';
import { downloadQuiz } from './quiz-files.js';

function newQuestion() {
  return {
    prompt: '', options: ['', '', '', ''], correct: 0,
    seconds: String(rules.defaultSeconds), multiplier: String(rules.defaultMultiplier),
    imageData: '', imageAlt: '', pictureJob: null, pictureError: ''
  };
}

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the picture.'));
    reader.readAsDataURL(blob);
  });
}

async function preparePicture(file) {
  if (file.size > rules.maxSourceBytes) throw new Error('Choose a picture under 12 MB.');
  const accepted = ['image/jpeg', 'image/png', 'image/webp'];
  if (file.type ? !accepted.includes(file.type) : !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error('Choose a JPG, PNG or WebP picture.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Picture processing is unavailable in this browser.');
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    let side = Math.min(longest, rules.maxImageSide);
    for (let pass = 0; pass < 6; pass++) {
      const scale = side / longest;
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', pass === 0 ? 0.86 : 0.76));
      if (blob && blob.size <= rules.maxImageBytes) return await readDataUrl(blob);
      side = Math.max(1, Math.round(side * 0.75));
    }
    throw new Error('Could not prepare this picture. Try a smaller file.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function questionError(q) {
  if (q.pictureJob) return ['Wait for the picture to finish loading.', '#picture-input'];
  if (!q.prompt.trim() && !q.imageData) return ['Write a prompt or add a picture.', '#question-prompt'];
  const empty = q.options.findIndex(value => !value.trim());
  if (empty !== -1) return ['Fill in all four answers.', `#answer-${empty}`];
  if (!q.seconds.trim() || !validSeconds(Number(q.seconds))) {
    return ['Set a timer between 5 and 300 whole seconds.', '#timer-seconds'];
  }
  if (!q.multiplier.trim() || !validMultiplier(Number(q.multiplier))) {
    return ['Use a multiplier from 0 to 10 with up to two decimal places.', '#point-multiplier'];
  }
  return null;
}

export function openBuilder(root, onBack, onCreate, entry = null) {
  const draft = entry ? {
    title: entry.quiz.title,
    questions: entry.quiz.questions.map(q => ({
      ...newQuestion(), ...q, options: [...q.options], imageData: q.imageData || '',
      seconds: String(q.seconds), multiplier: String(q.multiplier)
    }))
  } : { title: 'My Quiz', questions: [newQuestion()] };
  let current = 0;
  let saved = entry?.summary || null;
  let form;
  let busy = '';
  let errorText = '';
  let feedback = entry?.message || (saved ? 'Saved in My quizzes.' : '');

  function edited() {
    feedback = 'Unsaved changes';
    const status = form?.querySelector('#save-feedback');
    if (status && status.textContent !== feedback) status.textContent = feedback;
  }

  function snapshot() {
    const numberOrBlank = value => value.trim() === '' ? '' : Number(value);
    return {
      title: draft.title,
      questions: draft.questions.map(q => ({
        prompt: q.prompt, options: [...q.options], correct: q.correct,
        seconds: numberOrBlank(q.seconds), multiplier: numberOrBlank(q.multiplier),
        imageData: q.imageData || null, imageAlt: q.imageAlt
      }))
    };
  }

  async function keep(quiz) {
    saved = await saveQuiz(quiz, saved);
    feedback = 'Saved in My quizzes.';
  }

  function pictureMarkup(q) {
    const caption = q.imageData ? 'Replace picture' : 'Add picture';
    return `
      ${q.imageData ? `<figure class="builder-preview"><img src="${escapeHtml(q.imageData)}" alt="Question picture preview"></figure>` : ''}
      <div class="picture-controls">
        <label class="file-pick"><span aria-hidden="true">＋</span> ${caption}
          <input type="file" id="picture-input" aria-label="${caption}" accept="image/jpeg,image/png,image/webp">
        </label>
        ${q.imageData || q.pictureJob ? '<button type="button" class="text-btn" data-builder="remove-picture">Remove picture</button>' : ''}
        <span class="field-help">JPG, PNG or WebP · Up to 12 MB</span>
      </div>
      <div class="picture-status" role="status">${escapeHtml(q.pictureError || (q.pictureJob ? 'Preparing picture…' : ''))}</div>
      ${q.imageData ? `<label class="field-label" for="image-alt">Picture description <span class="optional">(optional)</span></label>
        <input class="field" id="image-alt" data-field="imageAlt" maxlength="180"
          value="${escapeHtml(q.imageAlt)}" placeholder="Describe the picture for players using a screen reader">` : ''}`;
  }

  function updatePicture(q) {
    if (draft.questions[current] !== q || !form?.isConnected) return;
    const area = form.querySelector('#question-media');
    if (area) area.innerHTML = pictureMarkup(q);
  }

  async function choosePicture(q, file) {
    const job = Symbol();
    q.pictureJob = job;
    q.pictureError = '';
    updatePicture(q);
    try {
      const image = await preparePicture(file);
      if (q.pictureJob === job) { q.imageData = image; edited(); }
    } catch (err) {
      if (q.pictureJob === job) {
        q.pictureError = err instanceof DOMException ? 'Could not open this picture. Choose a JPG, PNG or WebP file.' : err.message;
      }
    } finally {
      if (q.pictureJob === job) { q.pictureJob = null; updatePicture(q); }
    }
  }

  function changeField(event) {
    const input = event.target;
    const q = draft.questions[current];
    if (input.id === 'picture-input') {
      if (event.type === 'change' && input.files[0]) void choosePicture(q, input.files[0]);
      return;
    }
    if (input.id === 'quiz-title') draft.title = input.value;
    else if (input.dataset.field) q[input.dataset.field] = input.value;
    else if (input.dataset.option !== undefined) q.options[Number(input.dataset.option)] = input.value;
    else if (input.id === 'correct-answer') q.correct = Number(input.value);
    else return;
    edited();
  }

  function handleButton(event) {
    const button = event.target.closest('[data-builder]');
    if (!button || busy) return;
    errorText = '';
    switch (button.dataset.builder) {
      case 'back': return onBack();
      case 'save': return perform('save');
      case 'download': return perform('download');
      case 'select': current = Number(button.dataset.index); break;
      case 'add':
        if (draft.questions.length >= rules.maxQuestions) return;
        draft.questions.push(newQuestion());
        current = draft.questions.length - 1;
        edited();
        break;
      case 'remove':
        if (draft.questions.length === 1) return;
        draft.questions.splice(current, 1);
        current = Math.min(current, draft.questions.length - 1);
        edited();
        break;
      case 'remove-picture': {
        const q = draft.questions[current];
        Object.assign(q, { imageData: '', imageAlt: '', pictureJob: null, pictureError: '' });
        edited();
        return updatePicture(q);
      }
      default: return;
    }
    render();
  }

  async function perform(action) {
    if (busy) return;
    for (const [index, q] of draft.questions.entries()) {
      const issue = action === 'host' || q.pictureJob ? questionError(q) : null;
      if (issue) {
        current = index;
        errorText = `Question ${index + 1}: ${issue[0]}`;
        render();
        root.querySelector(issue[1])?.focus();
        return;
      }
    }
    busy = action;
    errorText = '';
    render();
    const quiz = snapshot();
    try {
      if (action === 'download') {
        downloadQuiz(quiz);
        feedback = 'Quiz file download started.';
      } else if (action === 'save') {
        await keep(quiz);
      } else {
        let saveWarning = '';
        try { await keep(quiz); }
        catch (err) {
          saveWarning = err.message + ' Use Download quiz file to keep these questions.';
          feedback = saveWarning;
        }
        await onCreate(quiz, saveWarning);
        return;
      }
    } catch (err) {
      errorText = action === 'save' ? err.message + ' You can download a quiz file instead.' : err.message;
    }
    busy = '';
    render();
  }

  function render() {
    const q = draft.questions[current];
    const tabs = draft.questions.map((_, i) => `
      <button type="button" class="q-tab ${i === current ? 'active' : ''}" data-builder="select" data-index="${i}"
        aria-label="Edit question ${i + 1}" aria-pressed="${i === current}">${i + 1}</button>`).join('');
    root.innerHTML = `
      <section class="join-wrap builder-wrap"><form class="builder-card" id="builder-form" novalidate>
        <fieldset class="builder-fields" ${busy ? 'disabled' : ''}>
          <button type="button" class="back" data-builder="back">← Back</button>
          <h1 class="builder-title">Make a quiz</h1>
          <label class="field-label" for="quiz-title">Quiz name</label>
          <input class="field" id="quiz-title" maxlength="60" value="${escapeHtml(draft.title)}">
          <div class="builder-subhead"><span class="field-label">Questions</span>
            <button type="button" class="text-btn" data-builder="remove" ${draft.questions.length === 1 ? 'disabled' : ''}>Remove question</button>
          </div>
          <div class="q-tabs">${tabs}<button type="button" class="add-question" data-builder="add"
            ${draft.questions.length === rules.maxQuestions ? 'disabled' : ''}>＋ Add question</button></div>
          <h2 class="editor-heading">Question ${current + 1}</h2>
          <label class="field-label" for="question-prompt">Question text</label>
          <textarea class="field field-textarea" id="question-prompt" data-field="prompt" maxlength="${rules.maxPrompt}"
            placeholder="Write a question, use a picture, or add both.">${escapeHtml(q.prompt)}</textarea>
          <div id="question-media">${pictureMarkup(q)}</div>
          <div class="answer-builder">${q.options.map((option, i) => `
            <label class="answer-edit"><span aria-hidden="true">${String.fromCharCode(65 + i)}</span>
              <input class="field answer-option" id="answer-${i}" data-option="${i}" maxlength="${rules.maxOption}"
                aria-label="Answer ${String.fromCharCode(65 + i)}" placeholder="Answer ${i + 1}" value="${escapeHtml(option)}">
            </label>`).join('')}</div>
          <div class="round-settings">
            <label for="correct-answer">Correct answer
              <select class="field" id="correct-answer">${q.options.map((_, i) =>
                `<option value="${i}" ${i === q.correct ? 'selected' : ''}>Answer ${String.fromCharCode(65 + i)}</option>`).join('')}</select>
            </label>
            <label for="timer-seconds">Timer (seconds)
              <input class="field" id="timer-seconds" data-field="seconds" type="number" inputmode="numeric"
                min="${rules.minSeconds}" max="${rules.maxSeconds}" step="1" value="${escapeHtml(q.seconds)}">
              <small>5–300 seconds</small>
            </label>
            <label for="point-multiplier">Point multiplier (×)
              <input class="field" id="point-multiplier" data-field="multiplier" type="number" inputmode="decimal"
                min="0" max="${rules.maxMultiplier}" step="0.01" value="${escapeHtml(q.multiplier)}">
              <small>0–10× · 0 for practice</small>
            </label>
          </div>
          <p class="form-error" role="alert">${escapeHtml(errorText)}</p>
          <div class="builder-actions save-actions">
            <button type="button" class="btn btn-light" data-builder="save">${busy === 'save' ? 'Saving…' : 'Save quiz'}</button>
            <button type="button" class="text-btn" data-builder="download">Download quiz file</button>
            <button type="submit" class="btn btn-dark">${busy === 'host' ? 'Creating room…' : 'Create room →'}</button>
          </div>
          <p class="save-feedback" id="save-feedback" role="status">${escapeHtml(feedback)}</p>
        </fieldset>
      </form></section>`;
    form = root.querySelector('form');
    form.addEventListener('input', changeField);
    form.addEventListener('change', changeField);
    form.addEventListener('click', handleButton);
    form.addEventListener('submit', event => { event.preventDefault(); void perform('host'); });
  }
  render();
}
