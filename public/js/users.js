// USERS MANAGEMENT JAVASCRIPT

let usersList = [];
let searchTimeout = null;

function checkAuth() {
  const userJson = localStorage.getItem('parking_user');
  if (!userJson) {
    window.location.href = 'index.html';
    return null;
  }
  const user = JSON.parse(userJson);
  document.getElementById('sidebarUserName').textContent = user.user_name || 'Staff Member';
  document.getElementById('sidebarUserRole').textContent = (user.role || 'STAFF').toUpperCase();
  document.getElementById('sidebarAvatar').textContent = (user.user_name || 'U').charAt(0).toUpperCase();
  return user;
}

function logoutUser() {
  localStorage.removeItem('parking_user');
  window.location.href = 'index.html';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    loadUsers();
  }, 350);
}

function handleRoleChange() {
  const role = document.getElementById('userRole').value;
  const pwdGroup = document.getElementById('passwordGroup');
  const pwdHint = document.getElementById('passwordHint');
  if (role === 'customer') {
    pwdHint.textContent = 'Optional for customers (not needed for basic parking records).';
  } else {
    pwdHint.textContent = 'Required for Admin and Staff to login to this system.';
  }
}

// Load Users from MySQL Backend
async function loadUsers() {
  const search = document.getElementById('userSearch').value.trim();
  const role = document.getElementById('roleFilter').value;
  const tbody = document.getElementById('usersTableBody');

  try {
    let url = '/api/users?';
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (role) url += `role=${encodeURIComponent(role)}&`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to fetch users', 'error');
      return;
    }

    usersList = data.users;
    document.getElementById('userCountText').textContent = usersList.length;

    if (usersList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 32px;">No users found matching your search.</td></tr>`;
      return;
    }

    tbody.innerHTML = usersList.map(u => {
      let roleBadge = '<span class="badge badge-secondary">Customer</span>';
      if (u.role === 'admin') {
        roleBadge = '<span class="badge badge-primary">⭐ Administrator</span>';
      } else if (u.role === 'staff') {
        roleBadge = '<span class="badge badge-success">🛡️ Security Staff</span>';
      }

      return `
        <tr>
          <td><strong>#${u.user_id}</strong></td>
          <td><strong>${u.user_name}</strong></td>
          <td>${u.phone || '<span style="color:var(--text-light);">-</span>'}</td>
          <td>${u.email || '<span style="color:var(--text-light);">-</span>'}</td>
          <td>${roleBadge}</td>
          <td>
            <div class="actions-cell">
              <button class="btn btn-secondary btn-sm" onclick="openEditUserModal(${u.user_id})" title="Edit User">
                ✏️ Edit
              </button>
              <button class="btn btn-secondary btn-sm" style="color: #ef4444;" onclick="deleteUser(${u.user_id}, '${u.user_name}')" title="Delete User">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    showToast('Network error while loading users: ' + err.message, 'error');
  }
}

// User Modal Handling
function openUserModal() {
  document.getElementById('userForm').reset();
  document.getElementById('editUserId').value = '';
  document.getElementById('userModalTitle').textContent = 'Add New System User';
  document.getElementById('userRole').value = 'staff';
  document.getElementById('passwordLabel').textContent = 'Login Password';
  document.getElementById('passwordHint').textContent = 'Required for Admin and Staff logins.';
  document.getElementById('userPassword').required = false;
  document.getElementById('userModal').classList.add('active');
}

function openEditUserModal(userId) {
  const user = usersList.find(u => u.user_id === userId);
  if (!user) return;

  document.getElementById('editUserId').value = user.user_id;
  document.getElementById('userName').value = user.user_name;
  document.getElementById('userPhone').value = user.phone || '';
  document.getElementById('userEmail').value = user.email || '';
  document.getElementById('userRole').value = user.role || 'staff';
  document.getElementById('userPassword').value = '';
  document.getElementById('passwordLabel').textContent = 'New Password (leave blank to keep current)';
  document.getElementById('passwordHint').textContent = 'Only enter if you wish to reset or change user password.';

  document.getElementById('userModalTitle').textContent = `Edit User: ${user.user_name}`;
  document.getElementById('userModal').classList.add('active');
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('active');
}

// Save User (CREATE / UPDATE)
async function handleSaveUser(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveUser');
  const editId = document.getElementById('editUserId').value;

  btn.disabled = true;
  btn.textContent = 'Saving...';

  const payload = {
    user_name: document.getElementById('userName').value.trim(),
    phone: document.getElementById('userPhone').value.trim(),
    email: document.getElementById('userEmail').value.trim(),
    role: document.getElementById('userRole').value,
    password: document.getElementById('userPassword').value
  };

  try {
    const isEdit = Boolean(editId);
    const url = isEdit ? `/api/users/${editId}` : '/api/users';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'User saved successfully!', 'success');
      closeUserModal();
      loadUsers();
    } else {
      showToast(result.message || 'Failed to save user', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save User';
  }
}

// Delete User
async function deleteUser(userId, userName) {
  if (!confirm(`Are you sure you want to delete user "${userName}"?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'User deleted successfully.', 'success');
      loadUsers();
    } else {
      showToast(result.message || 'Failed to delete user', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadUsers();
});
