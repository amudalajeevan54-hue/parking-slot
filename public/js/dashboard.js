// DASHBOARD JAVASCRIPT - PARKING SLOT MANAGEMENT SYSTEM

let currentActiveRecordForExit = null;
let allAvailableSlots = [];

// Check Authentication
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
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('mobile-open');
}

// Live Clock
function updateClock() {
  const clockEl = document.getElementById('clockTime');
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' | ' + now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
setInterval(updateClock, 1000);
updateClock();

// Toast Notifications
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

// Load Dashboard Data from Express Backend
async function loadDashboardData() {
  try {
    const res = await fetch('/api/dashboard');
    const result = await res.json();
    if (!result.success) {
      showToast(result.message || 'Failed to fetch dashboard data', 'error');
      return;
    }

    const d = result.data;

    // Stat Cards
    document.getElementById('statTotalSlots').textContent = d.total_slots;
    document.getElementById('statAvailableSlots').textContent = d.available_slots;
    document.getElementById('statOccupiedSlots').textContent = d.occupied_slots;
    document.getElementById('statCurrentlyParked').textContent = d.currently_parked;
    document.getElementById('statTotalVehicles').textContent = d.total_vehicles;
    document.getElementById('statTodayEntries').textContent = d.today_entries;
    document.getElementById('statTodayExits').textContent = d.today_exits;
    document.getElementById('statTotalRevenue').textContent = `₹${d.total_revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('statTodayRevenue').textContent = `Today: ₹${d.today_revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // Calculate Availability %
    const totalSlots = d.total_slots || 1;
    const occupiedSlots = d.occupied_slots || 0;
    const occPct = Math.round((occupiedSlots / totalSlots) * 100);
    const availPct = 100 - occPct;

    document.getElementById('statAvailablePct').textContent = `${availPct}% available capacity`;
    document.getElementById('donutPctText').textContent = `${occPct}%`;
    document.getElementById('legendAvailable').textContent = `${d.available_slots} slots`;
    document.getElementById('legendOccupied').textContent = `${d.occupied_slots} slots`;

    // SVG Donut Circle animation
    // Radius = 65, circumference = 2 * PI * 65 ≈ 408.4
    const circumference = 408.4;
    const offset = circumference - (occPct / 100) * circumference;
    const donutPath = document.getElementById('donutOccupiedPath');
    if (donutPath) {
      donutPath.style.strokeDashoffset = offset;
    }

    // Vehicle Type Breakdown
    const typeBreakdownEl = document.getElementById('typeStatsBreakdown');
    if (typeBreakdownEl && d.typeStats) {
      typeBreakdownEl.innerHTML = d.typeStats.map(t => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span>${t.vehicle_type}:</span>
          <span><strong>${t.occupied || 0}</strong> occ / <strong>${t.available || 0}</strong> avail</span>
        </div>
      `).join('');
    }

    // 7-Day Revenue Trend Chart
    renderRevenueChart(d.last7DaysRevenue);

    // Recent Activities Table
    renderRecentActivities(d.recentActivities);

    // Recently Registered Vehicles
    renderRecentVehicles(d.recentVehicles);

  } catch (err) {
    console.error('Error loading dashboard:', err);
    showToast('Network error while loading dashboard: ' + err.message, 'error');
  }
}

// Render Revenue Bar Chart
function renderRevenueChart(daysData) {
  const container = document.getElementById('revenueBarChart');
  if (!container) return;

  if (!daysData || daysData.length === 0) {
    container.innerHTML = `
      <div style="margin: auto; text-align: center; color: var(--text-muted);">
        <p>No completed exits in the last 7 days yet.</p>
        <span style="font-size: 11px;">Completed vehicle exits will automatically chart here.</span>
      </div>`;
    return;
  }

  const maxRev = Math.max(...daysData.map(d => Number(d.daily_revenue)), 50);

  container.innerHTML = daysData.map(item => {
    const rev = Number(item.daily_revenue);
    const heightPct = Math.max(12, Math.round((rev / maxRev) * 100));
    return `
      <div class="chart-bar-group">
        <div class="chart-bar" style="height: ${heightPct}%;">
          <div class="chart-bar-tooltip">₹${rev.toFixed(2)} (${item.total_exits} exits)</div>
        </div>
        <div class="chart-bar-label">${item.display_date}</div>
      </div>
    `;
  }).join('');
}

// Render Recent Activities Table
function renderRecentActivities(activities) {
  const tbody = document.getElementById('recentActivitiesTable');
  if (!tbody) return;

  if (!activities || activities.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No recent parking records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = activities.map(act => {
    const isParked = act.status === 'parked';
    const statusBadge = isParked
      ? `<span class="badge badge-danger">● Active Parked</span>`
      : `<span class="badge badge-success">✓ Completed</span>`;

    const entryTimeFormatted = act.entry_time ? new Date(act.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '-';
    const exitTimeFormatted = act.exit_time ? new Date(act.exit_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '<span style="color: #f59e0b; font-weight:600;">Currently In</span>';
    const feeDisplay = act.parking_fee ? `₹${Number(act.parking_fee).toFixed(2)}` : '-';

    return `
      <tr>
        <td><strong>${act.slot_number || '-'}</strong></td>
        <td>
          <strong>${act.vehicle_number || 'Unknown'}</strong>
          ${act.vehicle_model ? `<div style="font-size: 11px; color: var(--text-muted);">${act.vehicle_model}</div>` : ''}
        </td>
        <td><span class="vehicle-type-tag ${act.vehicle_type}">${act.vehicle_type || 'Car'}</span></td>
        <td style="font-size: 12.5px;">${entryTimeFormatted}</td>
        <td style="font-size: 12.5px;">${exitTimeFormatted}</td>
        <td><strong>${feeDisplay}</strong></td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

// Render Recently Registered Vehicles
function renderRecentVehicles(vehicles) {
  const listEl = document.getElementById('recentVehiclesList');
  if (!listEl) return;

  if (!vehicles || vehicles.length === 0) {
    listEl.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 12px;">No vehicles registered yet.</div>`;
    return;
  }

  listEl.innerHTML = vehicles.map(v => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: #f8fafc; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
      <div>
        <div style="font-weight: 700; font-size: 13px;">${v.vehicle_number}</div>
        <div style="font-size: 11.5px; color: var(--text-muted);">${v.vehicle_model || 'Standard'} • ${v.owner_name || 'Guest'}</div>
      </div>
      <span class="vehicle-type-tag ${v.vehicle_type}">${v.vehicle_type}</span>
    </div>
  `).join('');
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
  const type = document.getElementById('entryVehType').value;
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
    document.getElementById('entrySlotHint').textContent = `⚠️ No free slots for ${selectedType}. Please release a slot or add new slots.`;
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
      loadDashboardData();
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
      currentActiveRecordForExit = null;
      return;
    }

    const rec = data.record;
    currentActiveRecordForExit = rec;

    // Populate receipt preview
    document.getElementById('recVehNumber').textContent = rec.vehicle_number;
    document.getElementById('recVehType').textContent = `${rec.vehicle_type} (${rec.vehicle_model || 'Model N/A'})`;
    document.getElementById('recSlotNumber').textContent = `${rec.slot_number} (${rec.slot_location})`;
    document.getElementById('recEntryTime').textContent = new Date(rec.entry_time).toLocaleString();
    document.getElementById('recExitTime').textContent = new Date().toLocaleString() + ' (Now)';
    document.getElementById('recDuration').textContent = `${rec.calculationPreview.durationString} (Billable: ${rec.calculationPreview.billableHours} hr${rec.calculationPreview.billableHours > 1 ? 's' : ''})`;
    document.getElementById('recHourlyRate').textContent = `₹${rec.calculationPreview.hourlyRate.toFixed(2)} / hour`;
    document.getElementById('recTotalFee').textContent = `₹${rec.calculationPreview.fee.toFixed(2)}`;

    document.getElementById('exitPreviewArea').style.display = 'block';
    document.getElementById('btnConfirmExit').style.display = 'inline-flex';
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
      loadDashboardData();
    } else {
      showToast(result.message || 'Failed to process exit', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadDashboardData();
});
