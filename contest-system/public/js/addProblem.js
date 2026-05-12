// ─── SHARED ADD-PROBLEM MODULE (CUSTOM ONLY) ───────────────────────────────
// Used by: create-contest.html and manager.html
// External problems removed. Only custom problems supported.

(function () {

  // ── FORM HTML ─────────────────────────────────────────────────────────────
  window.getAddProblemFormHTML = function () {
    return `
      <div id="add-problem-form" class="add-problem-form">
        <div class="form-section-title">Add Custom Problem</div>

        <div class="form-group">
          <label>Problem Title <span class="required">*</span></label>
          <input type="text" id="prob-title" placeholder="e.g. Two Sum" maxlength="200" />
          <small id="prob-title-error" class="field-error"></small>
        </div>

        <div class="form-group">
          <label>Problem Statement <span class="required">*</span></label>
          <textarea id="prob-statement" rows="6"
            placeholder="Describe the problem clearly. Markdown supported."></textarea>
          <small id="prob-statement-error" class="field-error"></small>
        </div>

        <div class="form-group">
          <label>Input Format <span class="required">*</span></label>
          <textarea id="prob-input-format" rows="3"
            placeholder="Describe what the input looks like."></textarea>
          <small id="prob-input-error" class="field-error"></small>
        </div>

        <div class="form-group">
          <label>Output Format <span class="required">*</span></label>
          <textarea id="prob-output-format" rows="3"
            placeholder="Describe what the output should look like."></textarea>
          <small id="prob-output-error" class="field-error"></small>
        </div>

        <div class="form-row">
          <div class="form-group half">
            <label>Time Limit (ms)</label>
            <input type="number" id="prob-time-limit" value="2000" min="100" max="10000" />
          </div>
          <div class="form-group half">
            <label>Memory Limit (MB)</label>
            <input type="number" id="prob-memory-limit" value="256" min="16" max="1024" />
          </div>
        </div>

        <div class="form-group">
          <label>Constraints <small>(optional)</small></label>
          <input type="text" id="prob-constraints"
            placeholder="e.g. 1 ≤ N ≤ 10^5, Time: 2s, Memory: 256MB" />
        </div>

        <div class="form-group">
          <label>Hints <small>(optional — max 5, shown on demand to participants)</small></label>
          <div id="hints-container"></div>
          <button type="button" class="btn-secondary btn-sm" onclick="addHintRow()">
            + Add Hint
          </button>
        </div>

        <div class="form-group">
          <label>Sample Test Cases <span class="required">*</span></label>
          <small>Visible to participants. At least one required.</small>
          <div id="sample-cases-container">
            <div class="test-case-row">
              <div class="tc-pair">
                <div class="tc-col">
                  <label>Input</label>
                  <textarea class="tc-input" rows="3"
                    placeholder="Sample input"></textarea>
                </div>
                <div class="tc-col">
                  <label>Expected Output</label>
                  <textarea class="tc-output" rows="3"
                    placeholder="Expected output"></textarea>
                </div>
              </div>
              <button type="button" class="btn-remove-tc"
                onclick="removeSampleCase(this)">✕</button>
            </div>
          </div>
          <button type="button" class="btn-secondary btn-sm" onclick="addSampleCase()">
            + Add Sample Case
          </button>
          <small id="prob-samples-error" class="field-error"></small>
        </div>

        <div class="form-group">
          <label>Hidden Test Cases — CSV Upload <small>(optional)</small></label>
          <div class="csv-format-box">
            <strong>CSV format:</strong>
            <code>is_hidden,input,expected_output</code><br/>
            Example rows:<br/>
            <code>true,"5","25"</code><br/>
            <code>true,"1\n2","3"</code> — use <code>\n</code> for newlines<br/>
            First row must be the header. Max 100 rows per upload.
          </div>
          <input type="file" id="prob-csv-file" accept=".csv" />
          <span id="csv-upload-result"></span>
        </div>

        <div class="form-actions">
          <button type="button" id="add-prob-btn" onclick="submitAddProblem()">
            Add Problem
          </button>
          <button type="button" class="btn-secondary" onclick="cancelAddProblem()">
            Cancel
          </button>
        </div>

        <div id="add-prob-loading" style="display:none" class="loading-text">
          ⏳ Adding problem...
        </div>
        <div id="add-prob-error" class="field-error" style="display:none;font-size:14px"></div>
      </div>
    `;
  };

  // ── HINTS ─────────────────────────────────────────────────────────────────
  window.addHintRow = function () {
    const container = document.getElementById('hints-container');
    if (container.children.length >= 5) {
      showFieldError('add-prob-error', 'Maximum 5 hints allowed.');
      return;
    }
    const n   = container.children.length + 1;
    const row = document.createElement('div');
    row.className = 'hint-row';
    row.innerHTML = `
      <input type="text" class="hint-input"
        placeholder="Hint ${n} — reveal to participants on demand" />
      <button type="button" class="btn-remove-hint"
        onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(row);
  };

  function getHints () {
    return [...document.querySelectorAll('.hint-input')]
      .map(el => el.value.trim())
      .filter(v => v.length > 0);
  }

  // ── SAMPLE TEST CASES ─────────────────────────────────────────────────────
  window.addSampleCase = function () {
    const container = document.getElementById('sample-cases-container');
    const row       = document.createElement('div');
    row.className   = 'test-case-row';
    row.innerHTML   = `
      <div class="tc-pair">
        <div class="tc-col">
          <label>Input</label>
          <textarea class="tc-input" rows="3"></textarea>
        </div>
        <div class="tc-col">
          <label>Expected Output</label>
          <textarea class="tc-output" rows="3"></textarea>
        </div>
      </div>
      <button type="button" class="btn-remove-tc"
        onclick="removeSampleCase(this)">✕</button>
    `;
    container.appendChild(row);
  };

  window.removeSampleCase = function (btn) {
    const rows = document.querySelectorAll('.test-case-row');
    if (rows.length <= 1) {
      showFieldError('add-prob-error', 'At least one sample test case is required.');
      return;
    }
    btn.closest('.test-case-row').remove();
    clearError('add-prob-error');
  };

  function getSampleCases () {
    return [...document.querySelectorAll('.test-case-row')].map(row => ({
      input:           row.querySelector('.tc-input').value,
      expected_output: row.querySelector('.tc-output').value
    })).filter(r => r.input.trim() !== '' || r.expected_output.trim() !== '');
  }

  // ── VALIDATION ────────────────────────────────────────────────────────────
  function showFieldError (id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent    = msg;
    el.style.display  = 'block';
  }
  function clearError (id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }
  function clearAllErrors () {
    ['add-prob-error','prob-title-error','prob-statement-error',
     'prob-input-error','prob-output-error','prob-samples-error']
      .forEach(clearError);
  }

  function validateForm () {
    clearAllErrors();
    let ok = true;

    const title = document.getElementById('prob-title').value.trim();
    if (!title) {
      showFieldError('prob-title-error', 'Title is required.');
      ok = false;
    }

    const statement = document.getElementById('prob-statement').value.trim();
    if (!statement) {
      showFieldError('prob-statement-error', 'Statement is required.');
      ok = false;
    }

    const inputFmt = document.getElementById('prob-input-format').value.trim();
    if (!inputFmt) {
      showFieldError('prob-input-error', 'Input format is required.');
      ok = false;
    }

    const outputFmt = document.getElementById('prob-output-format').value.trim();
    if (!outputFmt) {
      showFieldError('prob-output-error', 'Output format is required.');
      ok = false;
    }

    const samples = getSampleCases();
    if (samples.length === 0) {
      showFieldError('prob-samples-error', 'At least one sample test case is required.');
      ok = false;
    }

    return ok;
  }

  // ── LOADING STATE ─────────────────────────────────────────────────────────
  function setLoading (on) {
    const btn = document.getElementById('add-prob-btn');
    if (btn) {
      btn.disabled    = on;
      btn.textContent = on ? 'Adding...' : 'Add Problem';
    }
    const loader = document.getElementById('add-prob-loading');
    if (loader) loader.style.display = on ? 'block' : 'none';
  }

  // ── SUBMIT ────────────────────────────────────────────────────────────────
  window.submitAddProblem = async function () {
    if (!validateForm()) return;

    const contestId = window.currentContestId;
    if (!contestId) {
      showFieldError('add-prob-error', 'No contest ID. Save contest first.');
      return;
    }

    setLoading(true);
    clearError('add-prob-error');

    const body = {
      title:            document.getElementById('prob-title').value.trim(),
      statement:        document.getElementById('prob-statement').value.trim(),
      input_format:     document.getElementById('prob-input-format').value.trim(),
      output_format:    document.getElementById('prob-output-format').value.trim(),
      constraints_text: document.getElementById('prob-constraints').value.trim(),
      time_limit_ms:    parseInt(document.getElementById('prob-time-limit').value)   || 2000,
      memory_limit_mb:  parseInt(document.getElementById('prob-memory-limit').value) || 256,
      hints:            getHints(),
      sample_cases:     getSampleCases()
    };

    try {
      const res  = await fetch(`/api/contests/${contestId}/problems`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok) {
        setLoading(false);
        showFieldError('add-prob-error', data.error || 'Failed to add problem.');
        return;
      }

      // Handle CSV upload for hidden test cases
      const csvFile = document.getElementById('prob-csv-file')?.files[0];
      if (csvFile && data.id) {
        const csvText = await csvFile.text();
        const csvRes  = await fetch(
          `/api/contests/${contestId}/problems/${data.id}/testcases/bulk`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ csv: csvText })
          }
        );
        const csvData = await csvRes.json();
        if (csvRes.ok) {
          const resultEl = document.getElementById('csv-upload-result');
          if (resultEl) {
            resultEl.textContent =
              `✓ ${csvData.inserted} hidden test cases loaded`;
            resultEl.style.color = 'green';
          }
        }
      }

      setLoading(false);

      // Notify host page
      if (typeof window.onProblemAdded === 'function') {
        window.onProblemAdded(data);
      }

    } catch (err) {
      setLoading(false);
      showFieldError('add-prob-error', 'Network error: ' + err.message);
    }
  };

  // ── CANCEL ────────────────────────────────────────────────────────────────
  window.cancelAddProblem = function () {
    const form = document.getElementById('add-problem-form');
    if (form) form.style.display = 'none';
    clearAllErrors();
  };

})();
