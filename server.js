require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, initializeDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Helper to calculate parking fee safely on backend
function calculateParkingFee(entryTime, exitTime, hourlyRate) {
  const entry = new Date(entryTime);
  const exit = new Date(exitTime);
  const durationMs = Math.max(0, exit.getTime() - entry.getTime());
  const durationMinutes = Math.floor(durationMs / (1000 * 60));
  // Round partial hours up to the next hour. Minimum 1 billable hour.
  const billableHours = Math.max(1, Math.ceil(durationMinutes / 60));
  const fee = billableHours * Number(hourlyRate);

  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  const durationString = `${hours} hr${hours === 1 ? '' : 's'} ${mins} min${mins === 1 ? '' : 's'}`;

  return {
    durationMinutes,
    billableHours,
    durationString,
    hourlyRate: Number(hourlyRate),
    fee: Number(fee.toFixed(2))
  };
}

// ==========================================
// 1. AUTHENTICATION APIS
// ==========================================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Please provide both username/email and password.' });
  }

  try {
    // Find user by username or email
    const [users] = await pool.query(
      'SELECT * FROM users WHERE user_name = ? OR email = ? LIMIT 1',
      [username.trim(), username.trim()]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    const user = users[0];

    // Check password if set, or allow initial match if password matches
    let isValid = false;
    if (user.password) {
      if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
        isValid = await bcrypt.compare(password, user.password);
      } else {
        isValid = (password === user.password);
      }
    } else {
      // In case password is null in existing database, default staff/admin pass check
      if (password === 'admin123' || password === 'staff123') {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid password. Please try again.' });
    }

    // Return sanitized user object
    const sessionUser = {
      user_id: user.user_id,
      user_name: user.user_name,
      email: user.email,
      phone: user.phone,
      role: user.role || 'staff'
    };

    return res.json({
      success: true,
      message: 'Login successful',
      user: sessionUser
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Database error during authentication: ' + err.message });
  }
});

// ==========================================
// 2. DASHBOARD APIS
// ==========================================

app.get('/api/dashboard', async (req, res) => {
  try {
    // Statistics queries
    const [[{ total_slots }]] = await pool.query('SELECT COUNT(*) as total_slots FROM parkingslot');
    const [[{ available_slots }]] = await pool.query('SELECT COUNT(*) as available_slots FROM parkingslot WHERE status = 0');
    const [[{ occupied_slots }]] = await pool.query('SELECT COUNT(*) as occupied_slots FROM parkingslot WHERE status = 1');
    const [[{ reserved_slots }]] = await pool.query('SELECT COUNT(*) as reserved_slots FROM parkingslot WHERE status = 2');
    const [[{ total_vehicles }]] = await pool.query('SELECT COUNT(*) as total_vehicles FROM vehicles');
    const [[{ currently_parked }]] = await pool.query("SELECT COUNT(*) as currently_parked FROM parkingrecords WHERE status = 'parked'");
    
    // Today's entries & exits (using DATE(entry_time) = CURDATE())
    const [[{ today_entries }]] = await pool.query("SELECT COUNT(*) as today_entries FROM parkingrecords WHERE DATE(entry_time) = CURDATE()");
    const [[{ today_exits }]] = await pool.query("SELECT COUNT(*) as today_exits FROM parkingrecords WHERE DATE(exit_time) = CURDATE() AND status = 'completed'");
    
    // Revenue calculations
    const [[{ total_revenue }]] = await pool.query("SELECT COALESCE(SUM(parking_fee), 0) as total_revenue FROM parkingrecords WHERE status = 'completed'");
    const [[{ today_revenue }]] = await pool.query("SELECT COALESCE(SUM(parking_fee), 0) as today_revenue FROM parkingrecords WHERE DATE(exit_time) = CURDATE() AND status = 'completed'");

    // Recent parking activities (last 7)
    const [recentActivities] = await pool.query(`
      SELECT r.record_id, r.entry_time, r.exit_time, r.parking_fee, r.status,
             v.vehicle_number, v.vehicle_type, v.vehicle_model,
             s.slot_number, s.location as slot_location,
             u.user_name as owner_name, u.phone as owner_phone
      FROM parkingrecords r
      LEFT JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      LEFT JOIN parkingslot s ON r.slot_id = s.slot_id
      LEFT JOIN users u ON v.user_id = u.user_id
      ORDER BY r.record_id DESC
      LIMIT 8
    `);

    // Recently registered vehicles (last 5)
    const [recentVehicles] = await pool.query(`
      SELECT v.vehicle_id, v.vehicle_number, v.vehicle_type, v.vehicle_model,
             u.user_name as owner_name, u.phone as owner_phone
      FROM vehicles v
      LEFT JOIN users u ON v.user_id = u.user_id
      ORDER BY v.vehicle_id DESC
      LIMIT 5
    `);

    // Breakdown by vehicle type for slots / parked
    const [typeStats] = await pool.query(`
      SELECT 
        s.vehicle_type,
        COUNT(s.slot_id) as total_slots,
        SUM(CASE WHEN s.status = 0 THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN s.status = 1 THEN 1 ELSE 0 END) as occupied
      FROM parkingslot s
      GROUP BY s.vehicle_type
    `);

    // Revenue in last 7 days
    const [last7DaysRevenue] = await pool.query(`
      SELECT DATE_FORMAT(exit_time, '%Y-%m-%d') as exit_date,
             DATE_FORMAT(exit_time, '%a, %d %b') as display_date,
             COUNT(record_id) as total_exits,
             COALESCE(SUM(parking_fee), 0) as daily_revenue
      FROM parkingrecords
      WHERE status = 'completed' AND exit_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE_FORMAT(exit_time, '%Y-%m-%d'), DATE_FORMAT(exit_time, '%a, %d %b')
      ORDER BY exit_date ASC
    `);

    res.json({
      success: true,
      data: {
        total_slots: Number(total_slots) || 0,
        available_slots: Number(available_slots) || 0,
        occupied_slots: Number(occupied_slots) || 0,
        reserved_slots: Number(reserved_slots) || 0,
        total_vehicles: Number(total_vehicles) || 0,
        currently_parked: Number(currently_parked) || 0,
        today_entries: Number(today_entries) || 0,
        today_exits: Number(today_exits) || 0,
        total_revenue: Number(Number(total_revenue).toFixed(2)) || 0,
        today_revenue: Number(Number(today_revenue).toFixed(2)) || 0,
        recentActivities,
        recentVehicles,
        typeStats,
        last7DaysRevenue
      }
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    res.status(500).json({ success: false, message: 'Database error fetching dashboard stats: ' + err.message });
  }
});

// ==========================================
// 3. VEHICLE MANAGEMENT APIS (CRUD)
// ==========================================

// GET /api/vehicles - Read all vehicles with owner details and optional search
app.get('/api/vehicles', async (req, res) => {
  const { search, type } = req.query;
  try {
    let sql = `
      SELECT v.vehicle_id, v.user_id, v.vehicle_number, v.vehicle_type, v.vehicle_model,
             u.user_name as owner_name, u.phone as owner_phone, u.email as owner_email,
             (SELECT COUNT(*) FROM parkingrecords r WHERE r.vehicle_id = v.vehicle_id AND r.status = 'parked') as is_parked,
             (SELECT s.slot_number FROM parkingrecords r JOIN parkingslot s ON r.slot_id = s.slot_id WHERE r.vehicle_id = v.vehicle_id AND r.status = 'parked' LIMIT 1) as current_slot
      FROM vehicles v
      LEFT JOIN users u ON v.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];

    if (search && search.trim()) {
      sql += ` AND (v.vehicle_number LIKE ? OR v.vehicle_model LIKE ? OR u.user_name LIKE ? OR u.phone LIKE ?)`;
      const queryStr = `%${search.trim()}%`;
      params.push(queryStr, queryStr, queryStr, queryStr);
    }

    if (type && type.trim()) {
      sql += ` AND v.vehicle_type = ?`;
      params.push(type.trim());
    }

    sql += ` ORDER BY v.vehicle_id DESC`;

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, vehicles: rows });
  } catch (err) {
    console.error('Fetch vehicles error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving vehicles: ' + err.message });
  }
});

// GET /api/vehicles/:id - Get single vehicle
app.get('/api/vehicles/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT v.*, u.user_name as owner_name, u.phone as owner_phone, u.email as owner_email
      FROM vehicles v
      LEFT JOIN users u ON v.user_id = u.user_id
      WHERE v.vehicle_id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    res.json({ success: true, vehicle: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database error: ' + err.message });
  }
});

// POST /api/vehicles - Register new vehicle (CREATE)
app.post('/api/vehicles', async (req, res) => {
  const { vehicle_number, vehicle_type, vehicle_model, owner_name, phone, email } = req.body;

  if (!vehicle_number || !vehicle_type) {
    return res.status(400).json({ success: false, message: 'Vehicle number and vehicle type are required.' });
  }

  const cleanNumber = vehicle_number.trim().toUpperCase();
  const cleanType = vehicle_type.trim();
  const cleanModel = (vehicle_model || '').trim();
  const cleanOwner = (owner_name || '').trim();
  const cleanPhone = (phone || '').trim();
  const cleanEmail = (email || '').trim();

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check duplicate vehicle number
    const [existing] = await connection.query('SELECT vehicle_id FROM vehicles WHERE vehicle_number = ?', [cleanNumber]);
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: `Vehicle with registration number ${cleanNumber} already exists!` });
    }

    // Owner handling: find existing user or insert new user
    let assignedUserId = null;
    if (cleanOwner || cleanPhone || cleanEmail) {
      // Check if user exists by phone or email
      let userQuery = 'SELECT user_id FROM users WHERE 1=0';
      const userParams = [];
      if (cleanPhone) {
        userQuery += ' OR phone = ?';
        userParams.push(cleanPhone);
      }
      if (cleanEmail) {
        userQuery += ' OR email = ?';
        userParams.push(cleanEmail);
      }

      const [foundUsers] = await connection.query(userQuery, userParams);
      if (foundUsers.length > 0) {
        assignedUserId = foundUsers[0].user_id;
        // Optionally update user name if empty
        if (cleanOwner) {
          await connection.query('UPDATE users SET user_name = COALESCE(user_name, ?) WHERE user_id = ?', [cleanOwner, assignedUserId]);
        }
      } else {
        // Insert new user
        const [userInsert] = await connection.query(
          'INSERT INTO users (user_name, phone, email, role) VALUES (?, ?, ?, ?)',
          [cleanOwner || 'Vehicle Owner', cleanPhone || null, cleanEmail || null, 'customer']
        );
        assignedUserId = userInsert.insertId;
      }
    }

    // Insert vehicle
    const [result] = await connection.query(
      'INSERT INTO vehicles (user_id, vehicle_number, vehicle_type, vehicle_model) VALUES (?, ?, ?, ?)',
      [assignedUserId, cleanNumber, cleanType, cleanModel]
    );

    await connection.commit();
    res.status(201).json({
      success: true,
      message: 'Vehicle registered successfully!',
      vehicle_id: result.insertId
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Create vehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to register vehicle: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/vehicles/:id - Update vehicle (UPDATE)
app.put('/api/vehicles/:id', async (req, res) => {
  const vehicleId = req.params.id;
  const { vehicle_number, vehicle_type, vehicle_model, owner_name, phone, email } = req.body;

  if (!vehicle_number || !vehicle_type) {
    return res.status(400).json({ success: false, message: 'Vehicle number and type are required.' });
  }

  const cleanNumber = vehicle_number.trim().toUpperCase();
  const cleanType = vehicle_type.trim();
  const cleanModel = (vehicle_model || '').trim();
  const cleanOwner = (owner_name || '').trim();
  const cleanPhone = (phone || '').trim();
  const cleanEmail = (email || '').trim();

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check duplicate vehicle number for other vehicles
    const [existing] = await connection.query(
      'SELECT vehicle_id, user_id FROM vehicles WHERE vehicle_number = ? AND vehicle_id != ?',
      [cleanNumber, vehicleId]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: `Another vehicle with number ${cleanNumber} already exists!` });
    }

    const [currentVeh] = await connection.query('SELECT user_id FROM vehicles WHERE vehicle_id = ?', [vehicleId]);
    if (currentVeh.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    let userId = currentVeh[0].user_id;
    if (userId) {
      // Update existing owner info
      await connection.query(
        'UPDATE users SET user_name = ?, phone = ?, email = ? WHERE user_id = ?',
        [cleanOwner, cleanPhone || null, cleanEmail || null, userId]
      );
    } else if (cleanOwner || cleanPhone || cleanEmail) {
      // Create new user and link
      const [uRes] = await connection.query(
        'INSERT INTO users (user_name, phone, email, role) VALUES (?, ?, ?, ?)',
        [cleanOwner || 'Vehicle Owner', cleanPhone || null, cleanEmail || null, 'customer']
      );
      userId = uRes.insertId;
    }

    await connection.query(
      'UPDATE vehicles SET user_id = ?, vehicle_number = ?, vehicle_type = ?, vehicle_model = ? WHERE vehicle_id = ?',
      [userId, cleanNumber, cleanType, cleanModel, vehicleId]
    );

    await connection.commit();
    res.json({ success: true, message: 'Vehicle updated successfully!' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Update vehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to update vehicle: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/vehicles/:id - Delete vehicle (DELETE)
app.delete('/api/vehicles/:id', async (req, res) => {
  const vehicleId = req.params.id;
  try {
    // Check if vehicle is currently parked
    const [parked] = await pool.query(
      "SELECT record_id FROM parkingrecords WHERE vehicle_id = ? AND status = 'parked'",
      [vehicleId]
    );
    if (parked.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete vehicle because it is currently parked in an active slot. Please process vehicle exit first.'
      });
    }

    // Check if has past parking records
    const [records] = await pool.query('SELECT record_id FROM parkingrecords WHERE vehicle_id = ? LIMIT 1', [vehicleId]);
    if (records.length > 0) {
      // Optional: keep historical records intact by setting vehicle_id to NULL or preventing deletion
      // To prevent breaking foreign key integrity:
      await pool.query('UPDATE parkingrecords SET vehicle_id = NULL WHERE vehicle_id = ?', [vehicleId]);
    }

    const [delResult] = await pool.query('DELETE FROM vehicles WHERE vehicle_id = ?', [vehicleId]);
    if (delResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    res.json({ success: true, message: 'Vehicle record deleted successfully.' });
  } catch (err) {
    console.error('Delete vehicle error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete vehicle: ' + err.message });
  }
});

// ==========================================
// 4. PARKING SLOTS MANAGEMENT APIS (CRUD)
// ==========================================

// GET /api/slots - Read all slots with active parking details and filters
app.get('/api/slots', async (req, res) => {
  const { type, status, search } = req.query;
  try {
    let sql = `
      SELECT s.slot_id, s.slot_number, s.vehicle_type, s.location, s.status,
             r.record_id, r.entry_time,
             v.vehicle_id, v.vehicle_number, v.vehicle_model, v.vehicle_type as parked_vehicle_type,
             u.user_name as owner_name, u.phone as owner_phone
      FROM parkingslot s
      LEFT JOIN parkingrecords r ON s.slot_id = r.slot_id AND r.status = 'parked'
      LEFT JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      LEFT JOIN users u ON v.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];

    if (type && type.trim()) {
      sql += ` AND s.vehicle_type = ?`;
      params.push(type.trim());
    }

    if (status !== undefined && status !== '') {
      sql += ` AND s.status = ?`;
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      sql += ` AND (s.slot_number LIKE ? OR s.location LIKE ? OR v.vehicle_number LIKE ?)`;
      const q = `%${search.trim()}%`;
      params.push(q, q, q);
    }

    sql += ` ORDER BY s.slot_number ASC`;

    const [slots] = await pool.query(sql, params);
    res.json({ success: true, slots });
  } catch (err) {
    console.error('Fetch slots error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving parking slots: ' + err.message });
  }
});

// POST /api/slots - Create new slot (CREATE)
app.post('/api/slots', async (req, res) => {
  const { slot_number, vehicle_type, location, status } = req.body;

  if (!slot_number || !vehicle_type) {
    return res.status(400).json({ success: false, message: 'Slot number and vehicle type are required.' });
  }

  const cleanNum = slot_number.trim().toUpperCase();
  const cleanType = vehicle_type.trim();
  const cleanLoc = (location || 'Main Section').trim();
  const slotStatus = status !== undefined ? parseInt(status, 10) : 0;

  try {
    const [existing] = await pool.query('SELECT slot_id FROM parkingslot WHERE slot_number = ?', [cleanNum]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: `Slot number ${cleanNum} already exists!` });
    }

    const [result] = await pool.query(
      'INSERT INTO parkingslot (slot_number, vehicle_type, location, status) VALUES (?, ?, ?, ?)',
      [cleanNum, cleanType, cleanLoc, slotStatus]
    );

    res.status(201).json({
      success: true,
      message: 'Parking slot created successfully.',
      slot_id: result.insertId
    });
  } catch (err) {
    console.error('Create slot error:', err);
    res.status(500).json({ success: false, message: 'Failed to create slot: ' + err.message });
  }
});

// PUT /api/slots/:id - Update slot (UPDATE)
app.put('/api/slots/:id', async (req, res) => {
  const slotId = req.params.id;
  const { slot_number, vehicle_type, location, status } = req.body;

  if (!slot_number || !vehicle_type) {
    return res.status(400).json({ success: false, message: 'Slot number and vehicle type are required.' });
  }

  const cleanNum = slot_number.trim().toUpperCase();
  const cleanType = vehicle_type.trim();
  const cleanLoc = (location || '').trim();

  try {
    // Check duplicate slot number for other slots
    const [existing] = await pool.query(
      'SELECT slot_id FROM parkingslot WHERE slot_number = ? AND slot_id != ?',
      [cleanNum, slotId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: `Another slot with number ${cleanNum} already exists!` });
    }

    let updateSql = 'UPDATE parkingslot SET slot_number = ?, vehicle_type = ?, location = ?';
    const params = [cleanNum, cleanType, cleanLoc];

    if (status !== undefined) {
      updateSql += ', status = ?';
      params.push(parseInt(status, 10));
    }
    updateSql += ' WHERE slot_id = ?';
    params.push(slotId);

    const [result] = await pool.query(updateSql, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }

    res.json({ success: true, message: 'Slot updated successfully.' });
  } catch (err) {
    console.error('Update slot error:', err);
    res.status(500).json({ success: false, message: 'Failed to update slot: ' + err.message });
  }
});

// DELETE /api/slots/:id - Delete slot (DELETE)
app.delete('/api/slots/:id', async (req, res) => {
  const slotId = req.params.id;
  try {
    // Check if slot is occupied
    const [slot] = await pool.query('SELECT status, slot_number FROM parkingslot WHERE slot_id = ?', [slotId]);
    if (slot.length === 0) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }
    if (slot[0].status === 1) {
      return res.status(400).json({ success: false, message: `Cannot delete slot ${slot[0].slot_number} because it is currently occupied.` });
    }

    // Clean up reference in old parking records to protect integrity
    await pool.query('UPDATE parkingrecords SET slot_id = NULL WHERE slot_id = ?', [slotId]);

    await pool.query('DELETE FROM parkingslot WHERE slot_id = ?', [slotId]);
    res.json({ success: true, message: 'Slot deleted successfully.' });
  } catch (err) {
    console.error('Delete slot error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete slot: ' + err.message });
  }
});

// ==========================================
// 5. PARKING ENTRY & EXIT MANAGEMENT (TRANSACTIONS)
// ==========================================

// POST /api/records/entry - Register vehicle arrival, assign slot
app.post('/api/records/entry', async (req, res) => {
  let { vehicle_id, vehicle_number, vehicle_type, vehicle_model, owner_name, phone, slot_id } = req.body;

  if (!slot_id) {
    return res.status(400).json({ success: false, message: 'Please select an available parking slot.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Resolve or register vehicle if vehicle_id not supplied
    if (!vehicle_id) {
      if (!vehicle_number || !vehicle_type) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Vehicle number and vehicle type are required for entry.' });
      }

      const cleanNum = vehicle_number.trim().toUpperCase();
      const [existingVeh] = await connection.query('SELECT vehicle_id FROM vehicles WHERE vehicle_number = ?', [cleanNum]);

      if (existingVeh.length > 0) {
        vehicle_id = existingVeh[0].vehicle_id;
      } else {
        // Create user if provided
        let newUserId = null;
        if (owner_name || phone) {
          const [uRes] = await connection.query(
            'INSERT INTO users (user_name, phone, role) VALUES (?, ?, ?)',
            [(owner_name || 'Customer').trim(), (phone || '').trim() || null, 'customer']
          );
          newUserId = uRes.insertId;
        }

        const [vRes] = await connection.query(
          'INSERT INTO vehicles (user_id, vehicle_number, vehicle_type, vehicle_model) VALUES (?, ?, ?, ?)',
          [newUserId, cleanNum, vehicle_type.trim(), (vehicle_model || '').trim()]
        );
        vehicle_id = vRes.insertId;
      }
    }

    // 2. Check if vehicle is already parked in any slot!
    const [alreadyParked] = await connection.query(`
      SELECT r.record_id, s.slot_number
      FROM parkingrecords r
      JOIN parkingslot s ON r.slot_id = s.slot_id
      WHERE r.vehicle_id = ? AND r.status = 'parked'
      FOR UPDATE
    `, [vehicle_id]);

    if (alreadyParked.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `This vehicle is already parked in Slot ${alreadyParked[0].slot_number}!`
      });
    }

    // 3. Lock and check parking slot availability
    const [slotRows] = await connection.query(
      'SELECT slot_id, slot_number, vehicle_type, status FROM parkingslot WHERE slot_id = ? FOR UPDATE',
      [slot_id]
    );

    if (slotRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Selected parking slot does not exist.' });
    }

    const slot = slotRows[0];
    if (slot.status === 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Slot ${slot.slot_number} is already occupied! Please choose another slot.`
      });
    }

    // 4. Create parking record with current entry time
    const [recordResult] = await connection.query(`
      INSERT INTO parkingrecords (vehicle_id, slot_id, entry_time, exit_time, parking_fee, status)
      VALUES (?, ?, NOW(), NULL, NULL, 'parked')
    `, [vehicle_id, slot_id]);

    // 5. Update parking slot status to 1 (Occupied)
    await connection.query('UPDATE parkingslot SET status = 1 WHERE slot_id = ?', [slot_id]);

    // Commit transaction
    await connection.commit();

    // Fetch confirmed entry details
    const [confirmed] = await pool.query(`
      SELECT r.record_id, r.entry_time, r.status,
             v.vehicle_number, v.vehicle_type, v.vehicle_model,
             s.slot_number, s.location as slot_location,
             u.user_name as owner_name, u.phone as owner_phone
      FROM parkingrecords r
      JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      JOIN parkingslot s ON r.slot_id = s.slot_id
      LEFT JOIN users u ON v.user_id = u.user_id
      WHERE r.record_id = ?
    `, [recordResult.insertId]);

    res.status(201).json({
      success: true,
      message: `Vehicle ${confirmed[0].vehicle_number} successfully parked in Slot ${confirmed[0].slot_number}!`,
      record: confirmed[0]
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Entry transaction error:', err);
    res.status(500).json({ success: false, message: 'Database transaction error during entry: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/records/search-active - Find currently parked record by vehicle number
app.get('/api/records/search-active', async (req, res) => {
  const { vehicle_number } = req.query;
  if (!vehicle_number || !vehicle_number.trim()) {
    return res.status(400).json({ success: false, message: 'Please provide vehicle number.' });
  }

  const cleanNum = vehicle_number.trim();
  try {
    const [rows] = await pool.query(`
      SELECT r.record_id, r.entry_time, r.status,
             v.vehicle_id, v.vehicle_number, v.vehicle_type, v.vehicle_model,
             s.slot_id, s.slot_number, s.location as slot_location,
             u.user_name as owner_name, u.phone as owner_phone,
             COALESCE(pr.hourly_rate, 20.00) as hourly_rate
      FROM parkingrecords r
      JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      JOIN parkingslot s ON r.slot_id = s.slot_id
      LEFT JOIN users u ON v.user_id = u.user_id
      LEFT JOIN parking_rates pr ON v.vehicle_type = pr.vehicle_type
      WHERE (v.vehicle_number = ? OR v.vehicle_number LIKE ?) AND r.status = 'parked'
      LIMIT 1
    `, [cleanNum, `%${cleanNum}%`]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No active parked record found for vehicle number: ${cleanNum}`
      });
    }

    const record = rows[0];
    const now = new Date();
    const feeCalculation = calculateParkingFee(record.entry_time, now, record.hourly_rate);

    res.json({
      success: true,
      record: {
        ...record,
        currentTime: now.toISOString(),
        calculationPreview: feeCalculation
      }
    });
  } catch (err) {
    console.error('Search active parked vehicle error:', err);
    res.status(500).json({ success: false, message: 'Database error searching vehicle: ' + err.message });
  }
});

// PUT /api/records/exit/:id - Process vehicle exit and calculate parking fee automatically
app.put('/api/records/exit/:id', async (req, res) => {
  const recordId = req.params.id;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Fetch record and lock
    const [records] = await connection.query(`
      SELECT r.record_id, r.vehicle_id, r.slot_id, r.entry_time, r.status,
             v.vehicle_number, v.vehicle_type, v.vehicle_model,
             s.slot_number
      FROM parkingrecords r
      JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      JOIN parkingslot s ON r.slot_id = s.slot_id
      WHERE r.record_id = ? AND r.status = 'parked'
      FOR UPDATE
    `, [recordId]);

    if (records.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Active parking record not found or vehicle has already exited.'
      });
    }

    const record = records[0];
    const exitTime = new Date();

    // 2. Fetch rate from parking_rates
    const [rates] = await connection.query(
      'SELECT hourly_rate FROM parking_rates WHERE vehicle_type = ? LIMIT 1',
      [record.vehicle_type]
    );
    const hourlyRate = rates.length > 0 ? Number(rates[0].hourly_rate) : 20.00;

    // 3. Compute backend fee
    const feeDetails = calculateParkingFee(record.entry_time, exitTime, hourlyRate);

    // 4. Update parking record with exit time, fee, and status = 'completed'
    await connection.query(`
      UPDATE parkingrecords
      SET exit_time = NOW(), parking_fee = ?, status = 'completed'
      WHERE record_id = ?
    `, [feeDetails.fee, recordId]);

    // 5. Release parking slot (status = 0 Available)
    await connection.query('UPDATE parkingslot SET status = 0 WHERE slot_id = ?', [record.slot_id]);

    // Commit transaction
    await connection.commit();

    // Fetch completed record
    const [finalRecord] = await pool.query(`
      SELECT r.record_id, r.entry_time, r.exit_time, r.parking_fee, r.status,
             v.vehicle_number, v.vehicle_type, v.vehicle_model,
             s.slot_number, s.location as slot_location,
             u.user_name as owner_name, u.phone as owner_phone
      FROM parkingrecords r
      JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      JOIN parkingslot s ON r.slot_id = s.slot_id
      LEFT JOIN users u ON v.user_id = u.user_id
      WHERE r.record_id = ?
    `, [recordId]);

    res.json({
      success: true,
      message: `Vehicle ${record.vehicle_number} exited successfully. Parking fee: ₹${feeDetails.fee}`,
      receipt: {
        record_id: recordId,
        vehicle_number: record.vehicle_number,
        vehicle_type: record.vehicle_type,
        slot_number: record.slot_number,
        entry_time: finalRecord[0].entry_time,
        exit_time: finalRecord[0].exit_time,
        duration: feeDetails.durationString,
        billable_hours: feeDetails.billableHours,
        hourly_rate: feeDetails.hourlyRate,
        parking_fee: feeDetails.fee
      }
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Exit transaction error:', err);
    res.status(500).json({ success: false, message: 'Database error processing exit: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// ==========================================
// 6. PARKING RECORDS MANAGEMENT APIS (CRUD)
// ==========================================

// GET /api/records - Read parking records with filters (search, status, date)
app.get('/api/records', async (req, res) => {
  const { search, status, start_date, end_date, limit } = req.query;

  try {
    let sql = `
      SELECT r.record_id, r.vehicle_id, r.slot_id, r.entry_time, r.exit_time, r.parking_fee, r.status,
             v.vehicle_number, v.vehicle_type, v.vehicle_model,
             s.slot_number, s.location as slot_location,
             u.user_name as owner_name, u.phone as owner_phone
      FROM parkingrecords r
      LEFT JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      LEFT JOIN parkingslot s ON r.slot_id = s.slot_id
      LEFT JOIN users u ON v.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];

    if (status && status.trim()) {
      sql += ` AND r.status = ?`;
      params.push(status.trim());
    }

    if (search && search.trim()) {
      sql += ` AND (v.vehicle_number LIKE ? OR s.slot_number LIKE ? OR u.user_name LIKE ?)`;
      const q = `%${search.trim()}%`;
      params.push(q, q, q);
    }

    if (start_date && start_date.trim()) {
      sql += ` AND DATE(r.entry_time) >= ?`;
      params.push(start_date.trim());
    }

    if (end_date && end_date.trim()) {
      sql += ` AND DATE(r.entry_time) <= ?`;
      params.push(end_date.trim());
    }

    sql += ` ORDER BY r.record_id DESC`;

    if (limit && parseInt(limit, 10) > 0) {
      sql += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
    }

    const [records] = await pool.query(sql, params);

    // Compute formatted durations for convenience
    const formattedRecords = records.map(rec => {
      let durationStr = 'Active';
      if (rec.exit_time && rec.entry_time) {
        const diffMs = Math.max(0, new Date(rec.exit_time).getTime() - new Date(rec.entry_time).getTime());
        const totalMins = Math.floor(diffMs / (1000 * 60));
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        durationStr = `${hrs}h ${mins}m`;
      } else if (rec.entry_time) {
        const diffMs = Math.max(0, new Date().getTime() - new Date(rec.entry_time).getTime());
        const totalMins = Math.floor(diffMs / (1000 * 60));
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        durationStr = `${hrs}h ${mins}m (so far)`;
      }
      return {
        ...rec,
        duration: durationStr
      };
    });

    res.json({ success: true, records: formattedRecords });
  } catch (err) {
    console.error('Fetch records error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving parking records: ' + err.message });
  }
});

// PUT /api/records/:id - Update record (e.g. fee adjustment or status)
app.put('/api/records/:id', async (req, res) => {
  const recordId = req.params.id;
  const { parking_fee, status } = req.body;

  try {
    const [result] = await pool.query(
      'UPDATE parkingrecords SET parking_fee = COALESCE(?, parking_fee), status = COALESCE(?, status) WHERE record_id = ?',
      [parking_fee !== undefined ? parking_fee : null, status || null, recordId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Parking record not found.' });
    }

    res.json({ success: true, message: 'Record updated successfully.' });
  } catch (err) {
    console.error('Update record error:', err);
    res.status(500).json({ success: false, message: 'Failed to update record: ' + err.message });
  }
});

// DELETE /api/records/:id - Delete record (with relationship check)
app.delete('/api/records/:id', async (req, res) => {
  const recordId = req.params.id;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [rec] = await connection.query('SELECT status, slot_id FROM parkingrecords WHERE record_id = ?', [recordId]);
    if (rec.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    // If active parked, release slot too
    if (rec[0].status === 'parked' && rec[0].slot_id) {
      await connection.query('UPDATE parkingslot SET status = 0 WHERE slot_id = ?', [rec[0].slot_id]);
    }

    await connection.query('DELETE FROM parkingrecords WHERE record_id = ?', [recordId]);
    await connection.commit();

    res.json({ success: true, message: 'Parking record deleted successfully.' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Delete record error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete record: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// ==========================================
// 7. USER MANAGEMENT APIS (CRUD)
// ==========================================

// GET /api/users - Read users
app.get('/api/users', async (req, res) => {
  const { search, role } = req.query;
  try {
    let sql = 'SELECT user_id, user_name, phone, email, role FROM users WHERE 1=1';
    const params = [];

    if (search && search.trim()) {
      sql += ' AND (user_name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const q = `%${search.trim()}%`;
      params.push(q, q, q);
    }

    if (role && role.trim()) {
      sql += ' AND role = ?';
      params.push(role.trim());
    }

    sql += ' ORDER BY user_id DESC';

    const [users] = await pool.query(sql, params);
    res.json({ success: true, users });
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving users: ' + err.message });
  }
});

// POST /api/users - Create user (CREATE)
app.post('/api/users', async (req, res) => {
  const { user_name, phone, email, role, password } = req.body;

  if (!user_name) {
    return res.status(400).json({ success: false, message: 'User name is required.' });
  }

  try {
    let hashedPassword = null;
    if (password && password.trim()) {
      hashedPassword = await bcrypt.hash(password.trim(), 10);
    }

    const [result] = await pool.query(
      'INSERT INTO users (user_name, phone, email, role, password) VALUES (?, ?, ?, ?, ?)',
      [user_name.trim(), (phone || '').trim() || null, (email || '').trim() || null, role || 'staff', hashedPassword]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully.',
      user_id: result.insertId
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ success: false, message: 'Failed to create user: ' + err.message });
  }
});

// PUT /api/users/:id - Update user (UPDATE)
app.put('/api/users/:id', async (req, res) => {
  const userId = req.params.id;
  const { user_name, phone, email, role, password } = req.body;

  if (!user_name) {
    return res.status(400).json({ success: false, message: 'User name is required.' });
  }

  try {
    let sql = 'UPDATE users SET user_name = ?, phone = ?, email = ?, role = ?';
    const params = [user_name.trim(), (phone || '').trim() || null, (email || '').trim() || null, role || 'staff'];

    if (password && password.trim()) {
      const hashedPassword = await bcrypt.hash(password.trim(), 10);
      sql += ', password = ?';
      params.push(hashedPassword);
    }

    sql += ' WHERE user_id = ?';
    params.push(userId);

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({ success: true, message: 'User updated successfully.' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: 'Failed to update user: ' + err.message });
  }
});

// DELETE /api/users/:id - Delete user (DELETE)
app.delete('/api/users/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    // Check if user has registered vehicles
    const [vehicles] = await pool.query('SELECT vehicle_id FROM vehicles WHERE user_id = ?', [userId]);
    if (vehicles.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete user because they have registered vehicles. Please reassign or delete their vehicles first.'
      });
    }

    const [delResult] = await pool.query('DELETE FROM users WHERE user_id = ?', [userId]);
    if (delResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete user: ' + err.message });
  }
});

// ==========================================
// 8. RATES MANAGEMENT APIS
// ==========================================

app.get('/api/rates', async (req, res) => {
  try {
    const [rates] = await pool.query('SELECT * FROM parking_rates ORDER BY hourly_rate ASC');
    res.json({ success: true, rates });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching rates: ' + err.message });
  }
});

app.put('/api/rates/:type', async (req, res) => {
  const vehicleType = req.params.type;
  const { hourly_rate } = req.body;

  if (hourly_rate === undefined || isNaN(hourly_rate) || Number(hourly_rate) <= 0) {
    return res.status(400).json({ success: false, message: 'Please provide a valid positive hourly rate.' });
  }

  try {
    await pool.query(
      'INSERT INTO parking_rates (vehicle_type, hourly_rate) VALUES (?, ?) ON DUPLICATE KEY UPDATE hourly_rate = ?',
      [vehicleType, Number(hourly_rate), Number(hourly_rate)]
    );
    res.json({ success: true, message: `Hourly rate for ${vehicleType} updated to ₹${hourly_rate}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error updating rate: ' + err.message });
  }
});

// ==========================================
// 9. REPORTS APIS
// ==========================================

app.get('/api/reports', async (req, res) => {
  try {
    // 1. Daily revenue for the last 30 days
    const [dailyRevenue] = await pool.query(`
      SELECT DATE_FORMAT(exit_time, '%Y-%m-%d') as report_date,
             DATE_FORMAT(exit_time, '%d %b %Y') as formatted_date,
             COUNT(record_id) as total_exits,
             COALESCE(SUM(parking_fee), 0) as total_revenue
      FROM parkingrecords
      WHERE status = 'completed' AND exit_time >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE_FORMAT(exit_time, '%Y-%m-%d'), DATE_FORMAT(exit_time, '%d %b %Y')
      ORDER BY report_date DESC
    `);

    // 2. Monthly revenue for the last 12 months
    const [monthlyRevenue] = await pool.query(`
      SELECT DATE_FORMAT(exit_time, '%Y-%m') as month_key,
             DATE_FORMAT(exit_time, '%M %Y') as month_name,
             COUNT(record_id) as total_vehicles,
             COALESCE(SUM(parking_fee), 0) as total_revenue
      FROM parkingrecords
      WHERE status = 'completed' AND exit_time >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(exit_time, '%Y-%m'), DATE_FORMAT(exit_time, '%M %Y')
      ORDER BY month_key DESC
    `);

    // 3. Most frequently used parking slots
    const [topSlots] = await pool.query(`
      SELECT s.slot_id, s.slot_number, s.vehicle_type, s.location, s.status as current_status,
             COUNT(r.record_id) as total_uses,
             COALESCE(SUM(r.parking_fee), 0) as total_revenue_generated
      FROM parkingslot s
      LEFT JOIN parkingrecords r ON s.slot_id = r.slot_id
      GROUP BY s.slot_id, s.slot_number, s.vehicle_type, s.location, s.status
      ORDER BY total_uses DESC, total_revenue_generated DESC
      LIMIT 10
    `);

    // 4. Vehicle-type statistics
    const [vehicleTypeStats] = await pool.query(`
      SELECT v.vehicle_type,
             COUNT(r.record_id) as total_parkings,
             COALESCE(SUM(r.parking_fee), 0) as total_revenue,
             COALESCE(AVG(r.parking_fee), 0) as avg_fee
      FROM parkingrecords r
      JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      GROUP BY v.vehicle_type
    `);

    // 5. Total entries & exits summary
    const [[summary]] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM parkingrecords) as total_entries,
        (SELECT COUNT(*) FROM parkingrecords WHERE status = 'completed') as total_exits,
        (SELECT COUNT(*) FROM parkingrecords WHERE status = 'parked') as currently_parked,
        (SELECT COALESCE(SUM(parking_fee), 0) FROM parkingrecords WHERE status = 'completed') as total_revenue
    `);

    res.json({
      success: true,
      data: {
        summary,
        dailyRevenue,
        monthlyRevenue,
        topSlots,
        vehicleTypeStats
      }
    });
  } catch (err) {
    console.error('Reports API error:', err);
    res.status(500).json({ success: false, message: 'Error generating reports: ' + err.message });
  }
});

// Fallback to index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚗 Parking Slot Management System Server Running`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`🔒 Login: admin@parking.com / admin123 or suresh@parking.com / staff123`);
    console.log(`====================================================`);
  });
}

startServer();
