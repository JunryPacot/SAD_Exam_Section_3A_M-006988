/* Scholarship Monitoring and Academic Compliance - browser client.
   All rules and access control live in Supabase (RLS + SQL functions);
   this file only calls them and displays results. */
(() => {
  const cfg = window.APP_CONFIG || {};
  const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const app = document.querySelector('#app');
  const msgBox = document.querySelector('#msg');

  const state = {
    me: null, programs: [], assignments: [], subs: [],
    tab: 'dashboard', term: '2026-2027|1', q: '', fProgram: '', fCompliance: '',
    openId: null, editId: null
  };

  // ---------- helpers ----------
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const manila = ts => ts ? new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (Manila)' : '';
  const showMsg = (text, type = 'error') => { msgBox.textContent = text; msgBox.className = type; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const clearMsg = () => { msgBox.className = ''; msgBox.textContent = ''; };
  const num = v => (v === '' || v == null) ? null : Number(v);
  const colors = { Verified:'ok', Pending:'warn', Returned:'bad', Compliant:'ok', 'With Deficiency':'bad', Approved:'ok', Held:'warn' };
  const badge = (t, empty = 'Not set') => `<span class="badge b-${colors[t] || 'none'}">${esc(t || empty)}</span>`;
  const termLabel = k => { const [y, s] = k.split('|'); return `AY ${y} Semester ${s}`; };

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) { showMsg(error.message); return { error }; }
    return { data };
  }

  // ---------- data loading ----------
  async function loadData() {
    const isStaff = state.me.role === 'staff';
    const [p, a, s] = await Promise.all([
      sb.from('programs').select('*').order('id'),
      sb.from('assignments').select('*, profiles(full_name, student_id, email)'),
      sb.from('submissions').select('*, profiles(full_name, student_id)').order('academic_year').order('semester')
    ]);
    for (const r of [p, a, s]) if (r.error) { showMsg(r.error.message); return; }
    state.programs = p.data; state.assignments = a.data; state.subs = s.data;
    if (isStaff && !termKeys().includes(state.term)) state.term = termKeys()[0] || state.term;
  }
  const termKeys = () => {
    const k = new Set(state.subs.map(x => `${x.academic_year}|${x.semester}`));
    k.add('2026-2027|1');
    return [...k].sort();
  };
  const programOf = scholarId => {
    const a = state.assignments.find(x => x.scholar_id === scholarId);
    return a ? state.programs.find(p => p.id === a.program_id) : null;
  };

  // ---------- auth ----------
  async function boot() {
    clearMsg();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderLogin();
    const { error: claimError } = await sb.rpc('claim_profile');
    if (claimError) {
      showMsg(claimError.message);
      await sb.auth.signOut();
      return renderLogin();
    }
    const { data: me, error } = await sb.from('profiles').select('*').eq('auth_user_id', session.user.id).maybeSingle();
    if (error) { showMsg(error.message); return renderLogin(); }
    if (!me) {
      showMsg('No scholar or staff profile is registered for ' + session.user.email + '. Ask the Scholarship Office.');
      await sb.auth.signOut(); return renderLogin();
    }
    state.me = me;
    document.querySelector('#who').textContent = `${me.full_name} (${me.role === 'staff' ? 'Scholarship Staff' : 'Scholar'})`;
    document.querySelector('#logout').style.display = '';
    await loadData();
    render();
  }

  function renderLogin() {
    document.querySelector('#who').textContent = '';
    document.querySelector('#logout').style.display = 'none';
    app.innerHTML = `
      <form class="panel login" id="loginForm">
        <h2>Log in</h2>
        <p><label for="em">Email</label><input id="em" type="email" required autocomplete="username"></p>
        <p><label for="pw">Password</label><input id="pw" type="password" required autocomplete="current-password"></p>
        <button type="submit">Log in</button>
      </form>`;
    document.querySelector('#loginForm').onsubmit = async e => {
      e.preventDefault(); clearMsg();
      const { error } = await sb.auth.signInWithPassword({
        email: document.querySelector('#em').value.trim(), password: document.querySelector('#pw').value });
      if (error) return showMsg(error.message);
      boot();
    };
  }
  document.querySelector('#logout').onclick = async () => { await sb.auth.signOut(); state.me = null; renderLogin(); };

  // ---------- routing ----------
  function render() { state.me.role === 'staff' ? renderStaff() : renderScholar(); }

  // =====================================================================
  // SCHOLAR
  // =====================================================================
  function renderScholar() {
    const prog = programOf(state.me.id);
    const editing = state.subs.find(s => s.id === state.editId);
    const years = ['2025-2026', '2026-2027', '2027-2028'];
    const v = editing || {};
    app.innerHTML = `
      <div class="panel">
        <h2>My scholarship</h2>
        <p>${prog ? `Program: <b>${esc(prog.name)}</b> &middot; Deadline: ${esc(manila(prog.deadline))}` : 'You are not assigned to a program yet.'}</p>
      </div>
      <form class="panel" id="subForm">
        <h2>${editing ? `Correct and resubmit: AY ${esc(editing.academic_year)} Semester ${esc(editing.semester)}` : 'Submit semester academic summary'}</h2>
        ${editing ? `<p class="muted">Returned because: ${esc(editing.return_reason)}</p>` : ''}
        <div class="grid">
          <div><label for="ay">Academic year</label>
            <select id="ay" ${editing ? 'disabled' : ''}>${years.map(y => `<option ${y === (v.academic_year || '2026-2027') ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
          <div><label for="sem">Semester</label>
            <select id="sem" ${editing ? 'disabled' : ''}><option value="1" ${v.semester == 1 || !v.semester ? 'selected' : ''}>1</option><option value="2" ${v.semester == 2 ? 'selected' : ''}>2</option></select></div>
          <div><label for="gwa">GWA (1.00 to 5.00)</label><input id="gwa" type="number" step="0.01" value="${esc(v.gwa)}"></div>
          <div><label for="units">Enrolled units</label><input id="units" type="number" step="1" value="${esc(v.enrolled_units)}"></div>
          <div><label for="failed">Failed subjects</label><input id="failed" type="number" step="1" value="${esc(v.failed_count ?? 0)}"></div>
          <div><label for="inc">Incomplete grades</label><input id="inc" type="number" step="1" value="${esc(v.incomplete_count ?? 0)}"></div>
          <div><label for="drop">Dropped subjects</label><input id="drop" type="number" step="1" value="${esc(v.dropped_count ?? 0)}"></div>
          <div><label for="ref">Grade-document reference</label><input id="ref" type="text" value="${esc(v.evidence_ref)}" placeholder="e.g. GR-2026-A01"></div>
        </div>
        <p class="row"><button type="submit">${editing ? 'Resubmit' : 'Submit'}</button>
          ${editing ? '<button type="button" class="secondary" id="cancelEdit">Cancel</button>' : ''}</p>
      </form>
      <div class="panel"><h2>My submissions</h2>${scholarTable()}</div>
      <div id="detail"></div>`;

    document.querySelector('#subForm').onsubmit = async e => {
      e.preventDefault(); clearMsg();
      const vals = { gwa: num(gwa.value), units: num(units.value), failed: num(failed.value), inc: num(inc.value), drop: num(drop.value) };
      for (const k of ['units', 'failed', 'inc', 'drop'])
        if (vals[k] === null || !Number.isInteger(vals[k]) || vals[k] < 0) return showMsg('Enter a nonnegative whole number for ' + ({ units:'enrolled units', failed:'failed subjects', inc:'incomplete grades', drop:'dropped subjects' })[k]);
      if (vals.gwa === null || vals.gwa < 1 || vals.gwa > 5) return showMsg('GWA must be between 1.00 and 5.00');
      let r;
      if (editing) {
        r = await rpc('resubmit_semester', { p_id: editing.id, p_gwa: vals.gwa, p_units: vals.units, p_failed: vals.failed, p_inc: vals.inc, p_drop: vals.drop, p_ref: ref.value });
      } else {
        r = await rpc('submit_semester', { p_year: ay.value, p_sem: Number(sem.value), p_gwa: vals.gwa, p_units: vals.units, p_failed: vals.failed, p_inc: vals.inc, p_drop: vals.drop, p_ref: ref.value });
      }
      if (r.error) return;
      showMsg(editing ? 'Resubmitted. Status is back to Pending verification.' : 'Submission received and recorded.', 'success');
      state.editId = null; await loadData(); renderScholar();
    };
    const c = document.querySelector('#cancelEdit'); if (c) c.onclick = () => { state.editId = null; renderScholar(); };
    bindActions();
    if (state.openId) renderDetail(state.openId);
  }

  function scholarTable() {
    if (!state.subs.length) return '<p class="muted">No submissions yet. Use the form above.</p>';
    return `<div class="tablewrap"><table><thead><tr><th>Term</th><th>Received</th><th>Submission status</th><th>Academic compliance</th><th>Award decision</th><th></th></tr></thead><tbody>
      ${state.subs.map(s => `<tr>
        <td>AY ${esc(s.academic_year)} Sem ${esc(s.semester)}</td><td>${esc(manila(s.submitted_at))}</td>
        <td>${badge(s.verification_status)}${s.verification_status === 'Returned' ? `<div class="muted">${esc(s.return_reason)}</div>` : ''}</td>
        <td>${badge(s.compliance_result, 'Not evaluated')}</td><td>${badge(s.renewal_decision, 'No decision')}</td>
        <td class="row"><button class="secondary" data-act="open" data-id="${s.id}">History</button>
          ${s.verification_status === 'Returned' ? `<button data-act="edit" data-id="${s.id}">Correct and resubmit</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // =====================================================================
  // STAFF
  // =====================================================================
  function renderStaff() {
    const tabs = [['dashboard', 'Dashboard'], ['scholars', 'Scholars'], ['policies', 'Policies']];
    app.innerHTML = `<nav class="tabs">${tabs.map(([k, l]) => `<button data-act="tab" data-id="${k}" class="${state.tab === k ? 'active' : ''}">${l}</button>`).join('')}</nav>
      <div id="tabBody"></div><div id="detail"></div>`;
    const body = document.querySelector('#tabBody');
    if (state.tab === 'dashboard') body.innerHTML = dashboardHtml();
    if (state.tab === 'scholars') body.innerHTML = scholarsHtml();
    if (state.tab === 'policies') body.innerHTML = policiesHtml();
    bindActions(); bindStaffControls();
    if (state.openId && state.tab === 'dashboard') renderDetail(state.openId);
  }

  function dashboardHtml() {
    const inTerm = state.subs.filter(s => `${s.academic_year}|${s.semester}` === state.term);
    const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
    const scholars = state.assignments.filter(a => a.profiles);
    const term = state.term;
    let rows = scholars.map(a => {
      const s = inTerm.find(x => x.scholar_id === a.scholar_id);
      return { a, s, prog: state.programs.find(p => p.id === a.program_id) };
    });
    const q = state.q.trim().toLowerCase();
    if (q) rows = rows.filter(r => r.a.profiles.student_id.toLowerCase().includes(q) || r.a.profiles.full_name.toLowerCase().includes(q));
    if (state.fProgram) rows = rows.filter(r => String(r.prog.id) === state.fProgram);
    if (state.fCompliance) rows = rows.filter(r => state.fCompliance === 'none' ? !(r.s && r.s.compliance_result) : (r.s && r.s.compliance_result === state.fCompliance));
    rows.sort((x, y) => x.a.profiles.student_id.localeCompare(y.a.profiles.student_id));
    return `
      <div class="panel row"><div style="min-width:220px"><label for="term">Selected semester</label>
        <select id="term">${termKeys().map(k => `<option value="${k}" ${k === term ? 'selected' : ''}>${termLabel(k)}</option>`).join('')}</select></div></div>
      <div class="stats">
        ${stat(scholars.length, 'Total assigned scholars')}
        ${stat(inTerm.filter(s => s.verification_status === 'Pending').length, 'Pending verification')}
        ${stat(inTerm.filter(s => s.compliance_result === 'Compliant').length, 'Compliant')}
        ${stat(inTerm.filter(s => s.compliance_result === 'With Deficiency').length, 'With deficiency')}
      </div>
      <div class="panel">
        <div class="grid" style="margin-bottom:12px">
          <div><label for="q">Search student ID or name</label><input id="q" value="${esc(state.q)}" placeholder="e.g. A04"></div>
          <div><label for="fp">Program</label><select id="fp"><option value="">All programs</option>
            ${state.programs.map(p => `<option value="${p.id}" ${String(p.id) === state.fProgram ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div><label for="fc">Compliance</label><select id="fc">
            ${[['', 'All'], ['Compliant', 'Compliant'], ['With Deficiency', 'With Deficiency'], ['none', 'Not evaluated']].map(([v, l]) => `<option value="${v}" ${v === state.fCompliance ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div class="tablewrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Program</th><th>Submission</th><th>Compliance</th><th>Renewal</th><th></th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.a.profiles.student_id)}</td><td>${esc(r.a.profiles.full_name)}</td><td>${esc(r.prog.name)}</td>
          <td>${r.s ? badge(r.s.verification_status) : '<span class="muted">No submission</span>'}</td>
          <td>${r.s ? badge(r.s.compliance_result, 'Not evaluated') : ''}</td>
          <td>${r.s ? badge(r.s.renewal_decision, 'No decision') : ''}</td>
          <td>${r.s ? `<button class="secondary" data-act="open" data-id="${r.s.id}">Review</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="7" class="muted">No scholars match the search or filters.</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  function scholarsHtml() {
    return `
      <form class="panel" id="regForm"><h2>Register scholar and assign program</h2>
        <div class="grid">
          <div><label for="rid">Student ID</label><input id="rid" required></div>
          <div><label for="rname">Full name</label><input id="rname" required></div>
          <div><label for="rem">Login email</label><input id="rem" type="email" required></div>
          <div><label for="rprog">Program</label><select id="rprog">${state.programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        </div>
        <p><button type="submit">Register scholar</button></p>
        <p class="muted">The scholar's Supabase Auth login must use this same email.</p>
      </form>
      <div class="panel"><h2>Assigned scholars</h2><div class="tablewrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Program</th></tr></thead><tbody>
        ${state.assignments.filter(a => a.profiles).sort((x, y) => x.profiles.student_id.localeCompare(y.profiles.student_id)).map(a =>
          `<tr><td>${esc(a.profiles.student_id)}</td><td>${esc(a.profiles.full_name)}</td><td>${esc(a.profiles.email)}</td><td>${esc(state.programs.find(p => p.id === a.program_id)?.name)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  function policiesHtml() {
    return `<div class="panel"><h2>Policy records</h2>
      <p class="muted">Evaluation reads these stored values. Nothing is hard-coded in the evaluation function.</p>
      <div class="tablewrap"><table><thead><tr><th>Program</th><th>Max GWA</th><th>Min units</th><th>Failed allowed</th><th>INC allowed</th><th>Dropped allowed</th><th>Deadline</th></tr></thead><tbody>
      ${state.programs.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(Number(p.max_gwa).toFixed(2))}</td><td>${p.min_units}</td><td>${p.max_failed}</td><td>${p.max_incomplete}</td><td>${p.max_dropped}</td><td>${esc(manila(p.deadline))}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  function bindStaffControls() {
    const t = document.querySelector('#term'); if (t) t.onchange = () => { state.term = t.value; state.openId = null; renderStaff(); };
    const q = document.querySelector('#q');
    if (q) q.oninput = () => { state.q = q.value; const pos = q.selectionStart; renderStaff(); const n = document.querySelector('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    const fp = document.querySelector('#fp'); if (fp) fp.onchange = () => { state.fProgram = fp.value; renderStaff(); };
    const fc = document.querySelector('#fc'); if (fc) fc.onchange = () => { state.fCompliance = fc.value; renderStaff(); };
    const reg = document.querySelector('#regForm');
    if (reg) reg.onsubmit = async e => {
      e.preventDefault(); clearMsg();
      const r = await rpc('register_scholar', { p_student_id: rid.value, p_name: rname.value, p_email: rem.value, p_program_id: Number(rprog.value) });
      if (r.error) return;
      showMsg('Scholar registered and assigned.', 'success'); await loadData(); renderStaff();
    };
  }

  // =====================================================================
  // SHARED: submission detail + history (staff actions only for staff)
  // =====================================================================
  async function renderDetail(id) {
    const s = state.subs.find(x => x.id === id); const box = document.querySelector('#detail');
    if (!s || !box) return;
    const prog = programOf(s.scholar_id);
    const staff = state.me.role === 'staff';
    const { data: log } = await sb.from('audit_log').select('*, profiles(full_name, role)').eq('submission_id', id).order('created_at').order('id');
    const checks = s.check_details || [];
    box.innerHTML = `
      <div class="panel"><h2>${esc(s.profiles?.student_id || '')} ${esc(s.profiles?.full_name || 'My submission')}: AY ${esc(s.academic_year)} Semester ${esc(s.semester)}</h2>
        <div class="statuses">
          <div><small>Submission status</small>${badge(s.verification_status)}</div>
          <div><small>Academic compliance</small>${badge(s.compliance_result, 'Not evaluated')}</div>
          <div><small>Award decision (renewal)</small>${badge(s.renewal_decision, 'No decision')}</div>
        </div>
        <p>GWA <b>${esc(Number(s.gwa).toFixed(2))}</b> &middot; Units <b>${s.enrolled_units}</b> &middot; Failed <b>${s.failed_count}</b> &middot; INC <b>${s.incomplete_count}</b> &middot; Dropped <b>${s.dropped_count}</b></p>
        <p>Grade-document reference: <b>${esc(s.evidence_ref)}</b><br>Submitted: ${esc(manila(s.submitted_at))}${s.resubmitted_at ? `<br>Resubmitted: ${esc(manila(s.resubmitted_at))}` : ''}${prog ? `<br>Program: ${esc(prog.name)}` : ''}</p>
        ${s.return_reason && s.verification_status === 'Returned' ? `<p>Return reason: ${esc(s.return_reason)}</p>` : ''}
        ${checks.length ? `<h3>Policy checks</h3><div class="tablewrap"><table><thead><tr><th>Check</th><th>Required</th><th>Actual</th><th>Result</th></tr></thead><tbody>
          ${checks.map(c => `<tr><td>${esc(c.check)}</td><td>${esc(c.rule)}</td><td>${esc(c.actual)}</td><td class="${c.passed ? 'pass' : 'fail'}">${c.passed ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table></div>
          ${s.deficiency_reasons?.length ? `<h3>Deficiency reasons</h3><ul class="clean">${s.deficiency_reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}` : ''}
        ${s.decision_note ? `<p>Decision note: ${esc(s.decision_note)}</p>` : ''}
        ${staff ? staffActions(s) : ''}
        <h3>History</h3>
        <div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Change</th><th>Note</th></tr></thead><tbody>
          ${(log || []).map(l => `<tr><td>${esc(manila(l.created_at))}</td><td>${esc(l.profiles?.full_name || 'Scholarship staff')}</td><td>${esc(l.action)}</td>
            <td>${esc(l.from_value || '')}${l.from_value && l.to_value ? ' &rarr; ' : ''}${esc(l.to_value || '')}</td><td>${esc(l.note || '')}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    box.querySelectorAll('[data-sact]').forEach(b => b.onclick = () => staffAction(b.dataset.sact, s.id));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function staffActions(s) {
    return `<h3>Staff actions</h3>
      <div class="row" style="margin-bottom:8px">
        <button class="good" data-sact="verify" ${s.verification_status !== 'Pending' ? 'disabled' : ''}>Mark Verified</button>
        <button class="danger" data-sact="return" ${s.verification_status !== 'Pending' ? 'disabled' : ''}>Return for correction</button>
        <button data-sact="evaluate">Evaluate compliance</button>
      </div>
      <label for="reason">Reason (required when returning)</label><input id="reason" placeholder="e.g. Grade document unreadable">
      <div class="row" style="margin:12px 0 8px">
        <button class="good" data-sact="approve">Approve renewal</button>
        <button class="danger" data-sact="hold">Hold renewal</button>
      </div>
      <label for="dnote">Decision note (required when holding)</label><textarea id="dnote"></textarea>`;
  }

  async function staffAction(kind, id) {
    clearMsg();
    const reason = document.querySelector('#reason')?.value || '';
    const note = document.querySelector('#dnote')?.value || '';
    let r, ok;
    if (kind === 'verify') { r = await rpc('verify_submission', { p_id: id, p_status: 'Verified', p_reason: null }); ok = 'Marked Verified.'; }
    if (kind === 'return') { r = await rpc('verify_submission', { p_id: id, p_status: 'Returned', p_reason: reason }); ok = 'Returned to the scholar with your reason.'; }
    if (kind === 'evaluate') { r = await rpc('evaluate_submission', { p_id: id }); ok = r.data ? 'Evaluation result: ' + r.data.result : ''; }
    if (kind === 'approve') { r = await rpc('decide_renewal', { p_id: id, p_decision: 'Approved', p_note: note }); ok = 'Renewal approved.'; }
    if (kind === 'hold') { r = await rpc('decide_renewal', { p_id: id, p_decision: 'Held', p_note: note }); ok = 'Renewal held.'; }
    if (r.error) return;
    showMsg(ok, 'success');
    await loadData(); state.openId = id; renderStaff();
  }

  // ---------- shared action binding ----------
  function bindActions() {
    app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act, id = b.dataset.id;
      if (act === 'tab') { state.tab = id; state.openId = null; renderStaff(); }
      if (act === 'open') { state.openId = id; renderDetail(id); }
      if (act === 'edit') { state.editId = id; state.openId = null; renderScholar(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  }

  boot();
})();
