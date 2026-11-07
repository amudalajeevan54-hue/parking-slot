// VEHICLES MANAGEMENT JAVASCRIPT

let vehiclesList = [];
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
    loadVehicles();
  }, 350);
}

// Load Vehicles from MySQL Backend
async function loadVehicles() {
  const search = document.getElementById('searchInput').value.trim();
  const type = document.getElementById('typeFilter').value;
  const tbody = document.getElementById('vehiclesTableBody');

  try {
    let url = '/api/vehicles?';
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (type) url += `type=${encodeURIComponent(type)}&`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to fetch vehicles', 'error');
      return;
    }

    vehiclesList = data.vehicles;
    document.getElementById('vehicleCountText').textContent = vehiclesList.length;

    if (vehiclesList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">No vehicles found matching your criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = vehiclesList.map(v => {
      const isParked = v.is_parked > 0;
      const statusBadge = isParked
        ? `<span class="badge badge-danger">● Parked in Slot ${v.current_slot || 'Assigned'}</span>`
        : `<span class="badge badge-secondary">○ Not Parked</span>`;

      return `
        <tr>
          <td>#${v.vehicle_id}</td>
          <td><strong style="letter-spacing: 0.5px;">${v.vehicle_number}</strong></td>
          <td><span class="vehicle-type-tag ${v.vehicle_type}">${v.vehicle_type}</span></td>
          <td>${v.vehicle_model || '<span style="color:var(--text-light);">N/A</span>'}</td>
          <td><strong>${v.owner_name || 'Unassigned'}</strong></td>
          <td>${v.owner_phone || '<span style="color:var(--text-light);">-</span>'}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="actions-cell">
              <button class="btn btn-secondary btn-sm" onclick="openEditVehicleModal(${v.vehicle_id})" title="Edit Vehicle">
                ✏️ Edit
              </button>
              <button class="btn btn-secondary btn-sm" style="color: #ef4444;" onclick="deleteVehicle(${v.vehicle_id}, '${v.vehicle_number}')" title="Delete Vehicle">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    showToast('Network error while loading vehicles: ' + err.message, 'error');
  }
}

// Modal Handling
function openVehicleModal() {
  document.getElementById('vehicleForm').reset();
  document.getElementById('editVehicleId').value = '';
  document.getElementById('modalTitle').textContent = 'Register New Vehicle';
  document.getElementById('vehicleModal').classList.add('active');
}

function openEditVehicleModal(id) {
  const vehicle = vehiclesList.find(v => v.vehicle_id === id);
  if (!vehicle) return;

  document.getElementById('editVehicleId').value = vehicle.vehicle_id;
  document.getElementById('vehNumber').value = vehicle.vehicle_number;
  document.getElementById('vehType').value = vehicle.vehicle_type;
  document.getElementById('vehModel').value = vehicle.vehicle_model || '';
  document.getElementById('ownerName').value = vehicle.owner_name || '';
  document.getElementById('ownerPhone').value = vehicle.owner_phone || '';
  document.getElementById('ownerEmail').value = vehicle.owner_email || '';

  document.getElementById('modalTitle').textContent = `Edit Vehicle: ${vehicle.vehicle_number}`;
  document.getElementById('vehicleModal').classList.add('active');
}

function closeVehicleModal() {
  document.getElementById('vehicleModal').classList.remove('active');
}

// Create or Update Vehicle (CRUD: CREATE / UPDATE)
async function handleSaveVehicle(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveVehicle');
  const editId = document.getElementById('editVehicleId').value;

  btn.disabled = true;
  btn.textContent = 'Saving...';

  const payload = {
    vehicle_number: document.getElementById('vehNumber').value.trim().toUpperCase(),
    vehicle_type: document.getElementById('vehType').value,
    vehicle_model: document.getElementById('vehModel').value.trim(),
    owner_name: document.getElementById('ownerName').value.trim(),
    phone: document.getElementById('ownerPhone').value.trim(),
    email: document.getElementById('ownerEmail').value.trim()
  };

  try {
    const isEdit = Boolean(editId);
    const url = isEdit ? `/api/vehicles/${editId}` : '/api/vehicles';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Vehicle saved successfully!', 'success');
      closeVehicleModal();
      loadVehicles();
    } else {
      showToast(result.message || 'Failed to save vehicle', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Vehicle';
  }
}

// Delete Vehicle (CRUD: DELETE)
async function deleteVehicle(id, vehicleNumber) {
  if (!confirm(`Are you sure you want to delete vehicle ${vehicleNumber}? This action cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/vehicles/${id}`, { method: 'DELETE' });
    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Vehicle deleted successfully.', 'success');
      loadVehicles();
    } else {
      showToast(result.message || 'Failed to delete vehicle', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadVehicles();
});
