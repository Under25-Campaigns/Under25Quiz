// Keep small titles and dates separate from the question pictures when listing saves.
function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open('quiz-night-saved-quizzes', 1); }
    catch { return reject(new Error('This browser could not open My quizzes.')); }
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('summaries', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('contents');
    };
    request.onerror = () => reject(new Error('This browser could not open My quizzes.'));
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other Quiz Night tabs and try opening My quizzes again.'));
    };
    request.onsuccess = () => {
      if (blocked) return request.result.close();
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transaction(stores, mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value, error;
      const result = data => { value = data; };
      const abort = message => { error = new Error(message); tx.abort(); };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => {
        const message = tx.error?.name === 'QuotaExceededError'
          ? 'Browser storage is full.' : 'This browser could not access the saved quiz.';
        reject(error || new Error(message));
      };
      action(tx, result, abort);
    });
  } finally { db.close(); }
}

export function listSavedQuizzes() {
  return transaction(['summaries'], 'readonly', (tx, result) => {
    const read = tx.objectStore('summaries').getAll();
    read.onsuccess = () => result(read.result.sort((a, b) => b.savedAt - a.savedAt || b.id - a.id));
  });
}

export function readSavedQuiz(id) {
  return transaction(['summaries', 'contents'], 'readonly', (tx, result, abort) => {
    const summary = tx.objectStore('summaries').get(id);
    const content = tx.objectStore('contents').get(id);
    content.onsuccess = () => {
      if (!summary.result || !content.result) return abort('This quiz is no longer saved in this browser.');
      result({ summary: summary.result, quiz: content.result });
    };
  });
}

// Check an editor's revision inside the write transaction so two tabs cannot overwrite each other.
function checkRevision(store, summary, abort, proceed) {
  const read = store.get(summary.id);
  read.onsuccess = () => {
    if (read.result?.revision !== summary.revision) {
      return abort('This saved quiz changed in another tab. Reopen it for the latest version.');
    }
    proceed();
  };
}

export function saveQuiz(quiz, previous = null) {
  return transaction(['summaries', 'contents'], 'readwrite', (tx, result, abort) => {
    const summaries = tx.objectStore('summaries');
    function write() {
      const summary = {
        title: quiz.title.trim() || 'My Quiz', questionCount: quiz.questions.length,
        savedAt: Date.now(), revision: (previous?.revision || 0) + 1
      };
      if (previous) summary.id = previous.id;
      const put = summaries.put(summary);
      put.onsuccess = () => {
        summary.id = put.result;
        tx.objectStore('contents').put(quiz, summary.id);
        result(summary);
      };
    }
    if (previous) checkRevision(summaries, previous, abort, write);
    else write();
  });
}

export function deleteSavedQuiz(summary) {
  return transaction(['summaries', 'contents'], 'readwrite', (tx, _result, abort) => {
    const summaries = tx.objectStore('summaries');
    checkRevision(summaries, summary, abort, () => {
      summaries.delete(summary.id);
      tx.objectStore('contents').delete(summary.id);
    });
  });
}
