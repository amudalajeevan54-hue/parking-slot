// REPORTS & ANALYTICS JAVASCRIPT

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

// Load Reports Data from MySQL Backend
async function loadReportsData() {
  try {
    const res = await fetch('/api/reports');
    const result = await res.json();

    if (!result.success) {
      showToast(result.message || 'Failed to fetch report data', 'error');
      return;
    }

    const { summary, dailyRevenue, monthlyRevenue, topSlots, vehicleTypeStats } = result.data;

    // KPI Cards
    if (summary) {
      document.getElementById('kpiTotalEntries').textContent = summary.total_entries || 0;
      document.getElementById('kpiTotalExits').textContent = summary.total_exits || 0;
      document.getElementById('kpiOccupiedSlots').textContent = summary.currently_parked || 0;
      document.getElementById('kpiTotalRevenue').textContent = `₹${Number(summary.total_revenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }

    // 1. Daily Revenue Table
    const dailyTbody = document.getElementById('dailyRevenueTableBody');
    if (dailyRevenue && dailyRevenue.length > 0) {
      dailyTbody.innerHTML = dailyRevenue.map(d => `
        <tr>
          <td><strong>${d.formatted_date || d.report_date}</strong></td>
          <td>${d.total_exits} vehicles</td>
          <td><strong style="color: var(--primary);">₹${Number(d.total_revenue).toFixed(2)}</strong></td>
        </tr>
      `).join('');
    } else {
      dailyTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No daily revenue records in the last 30 days.</td></tr>`;
    }

    // 2. Monthly Revenue Table
    const monthlyTbody = document.getElementById('monthlyRevenueTableBody');
    if (monthlyRevenue && monthlyRevenue.length > 0) {
      monthlyTbody.innerHTML = monthlyRevenue.map(m => `
        <tr>
          <td><strong>${m.month_name || m.year_month}</strong></td>
          <td>${m.total_vehicles} vehicles</td>
          <td><strong style="color: var(--status-available);">₹${Number(m.total_revenue).toFixed(2)}</strong></td>
        </tr>
      `).join('');
    } else {
      monthlyTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No monthly revenue records in the last 12 months.</td></tr>`;
    }

    // 3. Most Frequently Used Slots
    const topSlotsTbody = document.getElementById('topSlotsTableBody');
    if (topSlots && topSlots.length > 0) {
      topSlotsTbody.innerHTML = topSlots.map((s, idx) => {
        const isOccupied = s.current_status === 1;
        const statusBadge = isOccupied
          ? `<span class="badge badge-danger">🔴 Occupied</span>`
          : `<span class="badge badge-success">🟢 Available</span>`;

        return `
          <tr>
            <td><strong>#${idx + 1}</strong></td>
            <td><strong>${s.slot_number}</strong></td>
            <td><span class="vehicle-type-tag ${s.vehicle_type}">${s.vehicle_type}</span></td>
            <td>${s.location || 'Main Section'}</td>
            <td>${statusBadge}</td>
            <td><strong>${s.total_uses} times</strong></td>
            <td><strong style="color: var(--primary);">₹${Number(s.total_revenue_generated).toFixed(2)}</strong></td>
          </tr>
        `;
      }).join('');
    } else {
      topSlotsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No slot utilization data recorded yet.</td></tr>`;
    }

    // 4. Vehicle Type Statistics
    const typeTbody = document.getElementById('vehicleTypeTableBody');
    if (vehicleTypeStats && vehicleTypeStats.length > 0) {
      typeTbody.innerHTML = vehicleTypeStats.map(v => `
        <tr>
          <td><span class="vehicle-type-tag ${v.vehicle_type}">${v.vehicle_type}</span></td>
          <td><strong>${v.total_parkings}</strong> parkings</td>
          <td><strong style="color: var(--primary);">₹${Number(v.total_revenue).toFixed(2)}</strong></td>
          <td>₹${Number(v.avg_fee).toFixed(2)} / parking</td>
        </tr>
      `).join('');
    } else {
      typeTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">No vehicle-type statistics available yet.</td></tr>`;
    }

  } catch (err) {
    showToast('Error loading reports: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadReportsData();
});
