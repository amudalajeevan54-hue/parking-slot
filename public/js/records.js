// PARKING RECORDS JAVASCRIPT

let recordsList = [];
let allAvailableSlots = [];
let searchTimeout = null;
let currentActiveRecordForExit = null;

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
    loadRecords();
  }, 350);
}

// Load Parking Records from MySQL
async function loadRecords() {
  const search = document.getElementById('recordSearch').value.trim();
  const status = document.getElementById('statusFilter').value;
  const startDate = document.getElementById('startDateFilter').value;
  const endDate = document.getElementById('endDateFilter').value;
  const tbody = document.getElementById('recordsTableBody');

  try {
    let url = '/api/records?';
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (status) url += `status=${encodeURIComponent(status)}&`;
    if (startDate) url += `start_date=${encodeURIComponent(startDate)}&`;
    if (endDate) url += `end_date=${encodeURIComponent(endDate)}&`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to fetch records', 'error');
      return;
    }

    recordsList = data.records;
    document.getElementById('recordCountText').textContent = recordsList.length;

    if (recordsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 32px;">No parking records found matching your query.</td></tr>`;
      return;
    }

    tbody.innerHTML = recordsList.map(rec => {
      const isParked = rec.status === 'parked';
      const statusBadge = isParked
        ? `<span class="badge badge-danger">● Active Parked</span>`
        : `<span class="badge badge-success">✓ Completed</span>`;

      const entryTimeFormatted = rec.entry_time ? new Date(rec.entry_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-';
      const exitTimeFormatted = rec.exit_time ? new Date(rec.exit_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '<span style="color: #f59e0b; font-weight: 600;">Currently In</span>';
      const feeFormatted = rec.parking_fee ? `₹${Number(rec.parking_fee).toFixed(2)}` : '-';

      return `
        <tr>
          <td><strong>#${rec.record_id}</strong></td>
          <td>
            <strong>${rec.vehicle_number || 'Unregistered'}</strong>
            ${rec.owner_name ? `<div style="font-size: 11px; color: var(--text-muted);">${rec.owner_name}</div>` : ''}
          </td>
          <td><span class="vehicle-type-tag ${rec.vehicle_type}">${rec.vehicle_type || 'Car'}</span></td>
          <td><strong>${rec.slot_number || 'Slot N/A'}</strong></td>
          <td style="font-size: 12.5px;">${entryTimeFormatted}</td>
          <td style="font-size: 12.5px;">${exitTimeFormatted}</td>
          <td style="font-size: 12.5px; font-weight: 600;">${rec.duration}</td>
          <td><strong style="color: ${isParked ? 'var(--text-muted)' : 'var(--primary)'};">${feeFormatted}</strong></td>
          <td>${statusBadge}</td>
          <td>
            <div class="actions-cell">
              ${isParked ? `
                <button class="btn btn-success btn-sm" onclick="openExitModal('${rec.vehicle_number}')" title="Process Exit & Billing">
                  🏁 Exit
                </button>
              ` : ''}
              <button class="btn btn-secondary btn-sm" style="color: #ef4444;" onclick="deleteRecord(${rec.record_id})" title="Delete Record">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    showToast('Network error while loading records: ' + err.message, 'error');
  }
}

// Delete Record
async function deleteRecord(recordId) {
  if (!confirm(`Are you sure you want to delete parking record #${recordId}? If the vehicle is currently parked, this will also free the slot.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/records/${recordId}`, { method: 'DELETE' });
    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Record deleted successfully.', 'success');
      loadRecords();
    } else {
      showToast(result.message || 'Failed to delete record', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// Export Records to CSV
function exportRecordsToCSV() {
  if (!recordsList || recordsList.length === 0) {
    showToast('No records available to export.', 'warning');
    return;
  }

  const headers = ['Record ID', 'Vehicle Number', 'Vehicle Type', 'Vehicle Model', 'Slot Number', 'Owner Name', 'Owner Phone', 'Entry Time', 'Exit Time', 'Duration', 'Parking Fee (INR)', 'Status'];

  const rows = recordsList.map(r => [
    r.record_id,
    `"${r.vehicle_number || ''}"`,
    `"${r.vehicle_type || ''}"`,
    `"${r.vehicle_model || ''}"`,
    `"${r.slot_number || ''}"`,
    `"${r.owner_name || ''}"`,
    `"${r.owner_phone || ''}"`,
    `"${r.entry_time || ''}"`,
    `"${r.exit_time || ''}"`,
    `"${r.duration || ''}"`,
    r.parking_fee ? Number(r.parking_fee).toFixed(2) : '0.00',
    `"${r.status || ''}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' +
    [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `parking_records_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Parking records exported to CSV successfully!', 'success');
}

// ==========================================
// ENTRY MODAL HANDLING
// ==========================================
async function openEntryModal() {
  document.getElementById('entryForm').reset();
  await loadAvailableSlotsForEntry();
  document.getElementById('entryModal').classList.add('active');
}

function closeEntryModal() {
  document.getElementById('entryModal').classList.remove('active');
}

async function loadAvailableSlotsForEntry() {
  const slotSelect = document.getElementById('entrySlotId');
  slotSelect.innerHTML = `<option value="">Loading slots...</option>`;

  try {
    const res = await fetch(`/api/slots?status=0`);
    const data = await res.json();
    if (data.success) {
      allAvailableSlots = data.slots;
      filterAvailableSlots();
    }
  } catch (err) {
    slotSelect.innerHTML = `<option value="">Error loading slots</option>`;
  }
}

function filterAvailableSlots() {
  const selectedType = document.getElementById('entryVehType').value;
  const slotSelect = document.getElementById('entrySlotId');
  const matching = allAvailableSlots.filter(s => s.vehicle_type.toLowerCase() === selectedType.toLowerCase());

  if (matching.length === 0) {
    slotSelect.innerHTML = `<option value="">No available ${selectedType} slots!</option>`;
    document.getElementById('entrySlotHint').textContent = `⚠️ No free slots for ${selectedType}.`;
    document.getElementById('entrySlotHint').style.color = '#ef4444';
  } else {
    slotSelect.innerHTML = `<option value="">-- Select Available ${selectedType} Slot (${matching.length} free) --</option>` +
      matching.map(s => `<option value="${s.slot_id}">${s.slot_number} - ${s.location} (${s.vehicle_type})</option>`).join('');
    document.getElementById('entrySlotHint').textContent = `Found ${matching.length} available slots for ${selectedType}.`;
    document.getElementById('entrySlotHint').style.color = '#10b981';
  }
}

async function handleVehicleEntry(e) {
  e.preventDefault();
  const btn = document.getElementById('btnConfirmEntry');
  btn.disabled = true;
  btn.textContent = 'Recording Entry...';

  const payload = {
    vehicle_number: document.getElementById('entryVehNumber').value.trim().toUpperCase(),
    vehicle_type: document.getElementById('entryVehType').value,
    vehicle_model: document.getElementById('entryVehModel').value.trim(),
    owner_name: document.getElementById('entryOwnerName').value.trim(),
    phone: document.getElementById('entryPhone').value.trim(),
    slot_id: document.getElementById('entrySlotId').value
  };

  try {
    const res = await fetch('/api/records/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Vehicle entry recorded successfully!', 'success');
      closeEntryModal();
      loadRecords();
    } else {
      showToast(result.message || 'Failed to record entry', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Park Vehicle';
  }
}

// ==========================================
// EXIT MODAL HANDLING
// ==========================================
function openExitModal(prefillNumber = '') {
  document.getElementById('exitSearchVeh').value = prefillNumber;
  document.getElementById('exitPreviewArea').style.display = 'none';
  document.getElementById('btnConfirmExit').style.display = 'none';
  document.getElementById('btnPrintReceipt').style.display = 'none';
  currentActiveRecordForExit = null;
  document.getElementById('exitModal').classList.add('active');
  if (prefillNumber) {
    searchParkedVehicleForExit();
  }
}

function closeExitModal() {
  document.getElementById('exitModal').classList.remove('active');
}

async function searchParkedVehicleForExit() {
  const vehNum = document.getElementById('exitSearchVeh').value.trim();
  if (!vehNum) {
    showToast('Please enter a vehicle registration number to search.', 'warning');
    return;
  }

  try {
    const res = await fetch(`/api/records/search-active?vehicle_number=${encodeURIComponent(vehNum)}`);
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'No parked vehicle found', 'error');
      document.getElementById('exitPreviewArea').style.display = 'none';
      document.getElementById('btnConfirmExit').style.display = 'none';
      document.getElementById('btnPrintReceipt').style.display = 'none';
      currentActiveRecordForExit = null;
      return;
    }

    const rec = data.record;
    currentActiveRecordForExit = rec;

    // Populate receipt preview
    document.getElementById('recVehNumber').textContent = rec.vehicle_number;
    document.getElementById('recVehType').textContent = `${rec.vehicle_type} (${rec.vehicle_model || 'Standard'})`;
    document.getElementById('recSlotNumber').textContent = `${rec.slot_number} (${rec.slot_location})`;
    document.getElementById('recEntryTime').textContent = new Date(rec.entry_time).toLocaleString();
    document.getElementById('recExitTime').textContent = new Date().toLocaleString() + ' (Now)';
    document.getElementById('recDuration').textContent = `${rec.calculationPreview.durationString} (Billable: ${rec.calculationPreview.billableHours} hr${rec.calculationPreview.billableHours > 1 ? 's' : ''})`;
    document.getElementById('recHourlyRate').textContent = `₹${rec.calculationPreview.hourlyRate.toFixed(2)} / hr`;
    document.getElementById('recTotalFee').textContent = `₹${rec.calculationPreview.fee.toFixed(2)}`;

    document.getElementById('exitPreviewArea').style.display = 'block';
    document.getElementById('btnConfirmExit').style.display = 'inline-flex';
    document.getElementById('btnPrintReceipt').style.display = 'inline-flex';
    document.getElementById('btnConfirmExit').textContent = `Complete Exit & Pay ₹${rec.calculationPreview.fee.toFixed(2)}`;

  } catch (err) {
    showToast('Error searching parked vehicle: ' + err.message, 'error');
  }
}

async function confirmVehicleExit() {
  if (!currentActiveRecordForExit) return;

  const btn = document.getElementById('btnConfirmExit');
  btn.disabled = true;
  btn.textContent = 'Processing Exit...';

  try {
    const res = await fetch(`/api/records/exit/${currentActiveRecordForExit.record_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();

    if (result.success) {
      showToast(result.message || 'Vehicle exited successfully!', 'success');
      closeExitModal();
      loadRecords();
    } else {
      showToast(result.message || 'Failed to process exit', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadRecords();
});
