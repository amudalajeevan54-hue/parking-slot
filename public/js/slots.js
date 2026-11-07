// PARKING SLOTS MANAGEMENT & VISUAL GRID JAVASCRIPT

let slotsList = [];
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
    loadSlots();
  }, 350);
}

// Load Slots from MySQL Backend
async function loadSlots() {
  const search = document.getElementById('slotSearch').value.trim();
  const status = document.getElementById('statusFilter').value;
  const type = document.getElementById('typeFilter').value;
  const grid = document.getElementById('slotsGrid');

  try {
    let url = '/api/slots?';
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (status !== '') url += `status=${encodeURIComponent(status)}&`;
    if (type) url += `type=${encodeURIComponent(type)}&`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to fetch slots', 'error');
      return;
    }

    slotsList = data.slots;

    // Calculate Counts
    const availCount = slotsList.filter(s => s.status === 0).length;
    const occCount = slotsList.filter(s => s.status === 1).length;
    document.getElementById('countAvail').textContent = availCount;
    document.getElementById('countOccupied').textContent = occCount;
    document.getElementById('countTotal').textContent = slotsList.length;

    if (slotsList.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--text-muted);">No parking slots match the selected filters.</div>`;
      return;
    }

    grid.innerHTML = slotsList.map(slot => {
      const isOccupied = slot.status === 1;
      const statusClass = isOccupied ? 'occupied' : 'available';
      const statusLabel = isOccupied ? '🔴 Occupied' : '🟢 Available';

      let vehicleDetailsHtml = '';
      if (isOccupied && slot.vehicle_number) {
        const entryTime = slot.entry_time ? new Date(slot.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : 'Unknown';
        vehicleDetailsHtml = `
          <div class="slot-vehicle-info">
            <div class="veh-num">${slot.vehicle_number}</div>
            <div class="veh-time">Parked at: ${entryTime}</div>
            ${slot.owner_name ? `<div style="font-size:10px; color:var(--text-light); margin-top:2px;">Owner: ${slot.owner_name}</div>` : ''}
          </div>
        `;
      }

      return `
        <div class="slot-card ${statusClass}">
          <div>
            <div class="slot-header">
              <span class="slot-number">${slot.slot_number}</span>
              <span class="slot-indicator">${statusLabel}</span>
            </div>
            <div class="slot-type-badge">${getVehicleTypeIcon(slot.vehicle_type)} ${slot.vehicle_type}</div>
            <div class="slot-location">📍 ${slot.location || 'Section A'}</div>
            ${vehicleDetailsHtml}
          </div>

          <div class="slot-actions">
            ${isOccupied ? `
              <button class="btn btn-danger btn-sm" onclick="quickExitSlot(${slot.record_id}, '${slot.vehicle_number}', '${slot.slot_number}')" title="Process Exit & Billing">
                🏁 Exit & Bill
              </button>
            ` : `
              <button class="btn btn-success btn-sm" onclick="openQuickParkModal(${slot.slot_id}, '${slot.slot_number}', '${slot.vehicle_type}')" title="Assign Vehicle">
                🚗 Park Vehicle
              </button>
            `}
            <button class="btn btn-secondary btn-sm" onclick="openEditSlotModal(${slot.slot_id})" title="Edit Slot Details">
              ✏️
            </button>
            <button class="btn btn-secondary btn-sm" style="color: #ef4444;" onclick="deleteSlot(${slot.slot_id}, '${slot.slot_number}')" title="Delete Slot">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    showToast('Network error while loading parking slots: ' + err.message, 'error');
  }
}

function getVehicleTypeIcon(type) {
  switch (type) {
    case 'Bike': return '🏍️';
    case 'Car': return '🚗';
    case 'Bus': return '🚌';
    case 'Truck': return '🚚';
    default: return '🚙';
  }
}

// ==========================================
// SLOT CRUD (CREATE & EDIT)
// ==========================================
function openSlotModal() {
  document.getElementById('slotForm').reset();
  document.getElementById('editSlotId').value = '';
  document.getElementById('slotModalTitle').textContent = 'Create Parking Slot';
  document.getElementById('slotModal').classList.add('active');
}

function openEditSlotModal(slotId) {
  const slot = slotsList.find(s => s.slot_id === slotId);
  if (!slot) return;

  document.getElementById('editSlotId').value = slot.slot_id;
  document.getElementById('slotNumber').value = slot.slot_number;
  document.getElementById('slotVehType').value = slot.vehicle_type;
  document.getElementById('slotLocation').value = slot.location || '';
  document.getElementById('slotStatus').value = slot.status !== undefined ? slot.status : 0;

  document.getElementById('slotModalTitle').textContent = `Edit Slot: ${slot.slot_number}`;
  document.getElementById('slotModal').classList.add('active');
}

function closeSlotModal() {
  document.getElementById('slotModal').classList.remove('active');
}

async function handleSaveSlot(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveSlot');
  const editId = document.getElementById('editSlotId').value;

  btn.disabled = true;
  btn.textContent = 'Saving...';

  const payload = {
    slot_number: document.getElementById('slotNumber').value.trim().toUpperCase(),
    vehicle_type: document.getElementById('slotVehType').value,
    location: document.getElementById('slotLocation').value.trim(),
    status: parseInt(document.getElementById('slotStatus').value, 10)
  };

  try {
    const isEdit = Boolean(editId);
    const url = isEdit ? `/api/slots/${editId}` : '/api/slots';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Slot saved successfully!', 'success');
      closeSlotModal();
      loadSlots();
    } else {
      showToast(result.message || 'Failed to save slot', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Slot';
  }
}

// Delete Slot (CRUD: DELETE)
async function deleteSlot(slotId, slotNumber) {
  if (!confirm(`Are you sure you want to delete parking slot ${slotNumber}?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/slots/${slotId}`, { method: 'DELETE' });
    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Slot deleted successfully.', 'success');
      loadSlots();
    } else {
      showToast(result.message || 'Failed to delete slot', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ==========================================
// QUICK PARK (ENTRY) MODAL FOR SELECTED SLOT
// ==========================================
function openQuickParkModal(slotId, slotNumber, vehicleType) {
  document.getElementById('quickParkForm').reset();
  document.getElementById('qpSlotId').value = slotId;
  document.getElementById('qpSlotName').textContent = slotNumber;
  document.getElementById('qpVehType').value = vehicleType;
  document.getElementById('quickParkModal').classList.add('active');
}

function closeQuickParkModal() {
  document.getElementById('quickParkModal').classList.remove('active');
}

async function handleQuickPark(e) {
  e.preventDefault();
  const btn = document.getElementById('btnConfirmQuickPark');
  btn.disabled = true;
  btn.textContent = 'Assigning...';

  const payload = {
    vehicle_number: document.getElementById('qpVehNumber').value.trim().toUpperCase(),
    vehicle_type: document.getElementById('qpVehType').value,
    vehicle_model: document.getElementById('qpVehModel').value.trim(),
    owner_name: document.getElementById('qpOwnerName').value.trim(),
    phone: document.getElementById('qpPhone').value.trim(),
    slot_id: document.getElementById('qpSlotId').value
  };

  try {
    const res = await fetch('/api/records/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Vehicle parked successfully!', 'success');
      closeQuickParkModal();
      loadSlots();
    } else {
      showToast(result.message || 'Failed to park vehicle', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Assign Slot';
  }
}

// ==========================================
// QUICK EXIT & BILLING
// ==========================================
async function quickExitSlot(recordId, vehicleNumber, slotNumber) {
  if (!recordId) {
    showToast('No active record ID found for this occupied slot.', 'warning');
    return;
  }

  if (!confirm(`Process exit for vehicle ${vehicleNumber} parked in slot ${slotNumber}? The parking fee will be automatically computed and the slot released.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/records/exit/${recordId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();

    if (result.success) {
      showToast(`Exit completed for ${vehicleNumber}! Fee: ₹${result.receipt.parking_fee} (Duration: ${result.receipt.duration})`, 'success');
      loadSlots();
    } else {
      showToast(result.message || 'Failed to process exit', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ==========================================
// RATES CONFIGURATION MODAL
// ==========================================
async function openRatesModal() {
  const container = document.getElementById('ratesList');
  container.innerHTML = '<div>Loading current rates...</div>';
  document.getElementById('ratesModal').classList.add('active');

  try {
    const res = await fetch('/api/rates');
    const data = await res.json();

    if (data.success) {
      container.innerHTML = data.rates.map(r => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: #f8fafc; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">${getVehicleTypeIcon(r.vehicle_type)}</span>
            <strong>${r.vehicle_type}</strong>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>₹</span>
            <input type="number" id="rateInput_${r.vehicle_type}" value="${r.hourly_rate}" min="1" step="5" style="width: 80px; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-weight: bold;">
            <span>/ hr</span>
            <button class="btn btn-primary btn-sm" onclick="saveRate('${r.vehicle_type}')">Update</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    container.innerHTML = '<div style="color:red;">Error loading rates.</div>';
  }
}

function closeRatesModal() {
  document.getElementById('ratesModal').classList.remove('active');
}

async function saveRate(vehicleType) {
  const val = document.getElementById(`rateInput_${vehicleType}`).value;
  try {
    const res = await fetch(`/api/rates/${vehicleType}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hourly_rate: val })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, 'success');
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    showToast('Error updating rate: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadSlots();
});
