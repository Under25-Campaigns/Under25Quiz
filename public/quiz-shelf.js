import { escapeHtml } from './html.js';
import { listSavedQuizzes, readSavedQuiz, deleteSavedQuiz, saveQuiz } from './saved-quizzes.js';
import { readQuizFile } from './quiz-files.js';

export function openQuizShelf(root, onOpen) {
  root.innerHTML = `<section class="join-wrap builder-wrap"><div class="builder-card saved-card">
    <button type="button" class="back" data-action="home">← Back</button>
    <h1 class="builder-title">My quizzes</h1>
    <p class="saved-intro">Saved in this browser. Import a quiz file to open it on this device.</p>
    <label class="file-pick">Import quiz file
      <input type="file" id="import-quiz" accept=".json,application/json" aria-label="Import quiz file">
    </label>
    <p class="form-error" role="alert"></p>
    <div class="saved-list" aria-live="polite"><p class="subtle">Loading quizzes…</p></div>
  </div></section>`;
  const panel = root.querySelector('.saved-card');
  const list = panel.querySelector('.saved-list');
  const feedback = panel.querySelector('[role="alert"]');
  const picker = panel.querySelector('#import-quiz');
  let entries = [];
  let working = false;

  async function refresh() {
    try {
      entries = await listSavedQuizzes();
      list.innerHTML = entries.length ? entries.map(s => `
        <article class="saved-row">
          <div><h2>${escapeHtml(s.title)}</h2>
            <p>${s.questionCount} question${s.questionCount === 1 ? '' : 's'} · Saved ${escapeHtml(new Date(s.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</p>
          </div>
          <div class="saved-row-actions">
            <button class="btn btn-light" data-open="${s.id}" aria-label="Open ${escapeHtml(s.title)}">Open quiz</button>
            <button class="text-btn" data-delete="${s.id}" aria-label="Delete ${escapeHtml(s.title)}">Delete</button>
          </div>
        </article>`).join('') : '<p class="subtle">No quizzes saved yet. Choose <strong>Save quiz</strong> in the builder to keep one here.</p>';
    } catch (err) {
      list.textContent = err.message + ' You can still import a quiz file.';
    }
  }

  panel.addEventListener('click', async event => {
    const button = event.target.closest('[data-open], [data-delete]');
    if (!button || working) return;
    const summary = entries.find(s => s.id === Number(button.dataset.open ?? button.dataset.delete));
    if (!summary) return;
    feedback.textContent = '';
    working = true;
    try {
      if (button.hasAttribute('data-open')) {
        const entry = await readSavedQuiz(summary.id);
        if (panel.isConnected) onOpen(entry);
      } else if (window.confirm('Delete “' + summary.title + '” from this browser?')) {
        await deleteSavedQuiz(summary);
        await refresh();
      }
    } catch (err) {
      feedback.textContent = err.message;
      await refresh();
    } finally { working = false; }
  });

  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file || working) return;
    working = true;
    picker.disabled = true;
    feedback.textContent = '';
    try {
      const quiz = await readQuizFile(file);
      let summary = null, message = '';
      try { summary = await saveQuiz(quiz); }
      catch (err) { message = err.message + ' Your file is open for editing.'; }
      if (panel.isConnected) onOpen({ quiz, summary, message });
    } catch (err) { feedback.textContent = err.message; }
    finally {
      working = false;
      picker.disabled = false;
      picker.value = '';
    }
  });
  void refresh();
}
