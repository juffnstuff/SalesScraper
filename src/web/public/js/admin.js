/**
 * Admin User Management — /admin/users
 *
 * Renders the users table, wires up the New / Edit / Reset-password / Delete
 * actions, and surfaces temporary passwords via a one-time modal.
 */

let allUsers = [];

document.addEventListener('DOMContentLoaded', () => {
  loadUsers();

  document.getElementById('newUserForm').addEventListener('submit', createUser);
  document.getElementById('editUserForm').addEventListener('submit', saveEdit);
  document.getElementById('copyTempPasswordBtn').addEventListener('click', copyTempPassword);
});

async function loadUsers() {
  const body = document.getElementById('usersTableBody');
  try {
    const resp = await fetch('/api/admin/users');
    const data = await resp.json();
    if (!data.success) {
      body.innerHTML = `<tr><td colspan="7" class="text-danger py-4">${escapeHtml(data.error || 'Load failed')}</td></tr>`;
      return;
    }
    allUsers = data.users || [];
    renderUsers();
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" class="text-danger py-4">${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderUsers() {
  const body = document.getElementById('usersTableBody');
  if (allUsers.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No users.</td></tr>`;
    return;
  }
  body.innerHTML = allUsers.map(u => {
    const roleBadge = roleBadgeHtml(u.role);
    const lastLogin = u.lastLogin
      ? `${new Date(u.lastLogin).toLocaleString()}<br><small class="text-muted">${escapeHtml(u.lastLoginIp || '')}</small>`
      : '<small class="text-muted">Never</small>';
    const mustChange = u.mustChangePassword ? ' <span class="badge bg-warning text-dark" style="font-size:0.6rem;">Must change password</span>' : '';
    return `<tr>
      <td><code>${escapeHtml(u.username)}</code></td>
      <td>${escapeHtml(u.name)}${mustChange}</td>
      <td>${escapeHtml(u.email || '')}</td>
      <td>${roleBadge}</td>
      <td>${escapeHtml(u.repId || '')}</td>
      <td>${lastLogin}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary" title="Edit" onclick="openEdit('${cssSafe(u.username)}')">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-warning" title="Reset password" onclick="resetPassword('${cssSafe(u.username)}')">
          <i class="bi bi-key"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="deleteUser('${cssSafe(u.username)}')">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function roleBadgeHtml(role) {
  const map = {
    admin:     '<span class="badge bg-warning text-dark">Admin</span>',
    sales_rep: '<span class="badge bg-info">Sales Rep</span>',
    viewer:    '<span class="badge bg-secondary">Viewer</span>'
  };
  return map[role] || `<span class="badge bg-light text-dark">${escapeHtml(role)}</span>`;
}

async function createUser(e) {
  e.preventDefault();
  const err = document.getElementById('newUserError');
  err.classList.add('d-none');

  const body = {
    username: document.getElementById('newUsername').value.trim(),
    name: document.getElementById('newName').value.trim(),
    email: document.getElementById('newEmail').value.trim(),
    role: document.getElementById('newRole').value,
    repId: document.getElementById('newRepId').value
  };
  if (!body.username || !body.name) {
    err.textContent = 'Username and full name are required.';
    err.classList.remove('d-none');
    return;
  }

  try {
    const resp = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!data.success) {
      err.textContent = data.error || 'Create failed';
      err.classList.remove('d-none');
      return;
    }
    bootstrap.Modal.getInstance(document.getElementById('newUserModal')).hide();
    document.getElementById('newUserForm').reset();
    await loadUsers();
    showTempPassword(data.username, data.tempPassword);
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('d-none');
  }
}

function openEdit(username) {
  const u = allUsers.find(x => x.username === username);
  if (!u) return;
  document.getElementById('editUsername').value = u.username;
  document.getElementById('editUsernameLabel').textContent = u.username;
  document.getElementById('editName').value = u.name || '';
  document.getElementById('editEmail').value = u.email || '';
  document.getElementById('editRole').value = u.role || 'sales_rep';
  document.getElementById('editRepId').value = u.repId || '';
  document.getElementById('editUserError').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('editUserModal')).show();
}

async function saveEdit(e) {
  e.preventDefault();
  const err = document.getElementById('editUserError');
  err.classList.add('d-none');
  const username = document.getElementById('editUsername').value;
  const body = {
    name: document.getElementById('editName').value.trim(),
    email: document.getElementById('editEmail').value.trim(),
    role: document.getElementById('editRole').value,
    repId: document.getElementById('editRepId').value
  };

  try {
    const resp = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!data.success) {
      err.textContent = data.error || 'Save failed';
      err.classList.remove('d-none');
      return;
    }
    bootstrap.Modal.getInstance(document.getElementById('editUserModal')).hide();
    await loadUsers();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('d-none');
  }
}

async function resetPassword(username) {
  const ok = confirm(`Reset password for "${username}"?\n\nA new temporary password will be generated and shown to you once. The user must change it on next login.`);
  if (!ok) return;
  try {
    const resp = await fetch(`/api/admin/users/${encodeURIComponent(username)}/reset-password`, {
      method: 'POST'
    });
    const data = await resp.json();
    if (!data.success) {
      alert(`Reset failed: ${data.error}`);
      return;
    }
    await loadUsers();
    showTempPassword(data.username, data.tempPassword);
  } catch (e) {
    alert(`Reset failed: ${e.message}`);
  }
}

async function deleteUser(username) {
  const ok = confirm(`Delete user "${username}"?\n\nThis cannot be undone. Their historical activity (assignments, pushes) stays intact, but they can no longer log in.`);
  if (!ok) return;
  try {
    const resp = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: 'DELETE'
    });
    const data = await resp.json();
    if (!data.success) {
      alert(`Delete failed: ${data.error}`);
      return;
    }
    await loadUsers();
  } catch (e) {
    alert(`Delete failed: ${e.message}`);
  }
}

function showTempPassword(username, tempPassword) {
  document.getElementById('tempPasswordUser').textContent = username;
  document.getElementById('tempPasswordValue').value = tempPassword;
  document.getElementById('copyStatus').textContent = '';
  new bootstrap.Modal(document.getElementById('tempPasswordModal')).show();
}

async function copyTempPassword() {
  const input = document.getElementById('tempPasswordValue');
  try {
    await navigator.clipboard.writeText(input.value);
    document.getElementById('copyStatus').textContent = 'Copied!';
  } catch {
    // Fallback for older browsers / non-HTTPS
    input.select();
    document.execCommand('copy');
    document.getElementById('copyStatus').textContent = 'Copied.';
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssSafe(str) {
  return String(str).replace(/[^a-zA-Z0-9._-]/g, '');
}
