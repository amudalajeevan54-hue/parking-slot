require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'parking',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  dateStrings: true // Return date as string for exact timezone representation
});

/**
 * Safe database initialization:
 * Ensures all required keys, AUTO_INCREMENT, password column, and parking_rates exist
 * without dropping or destroying existing user tables or data.
 */
async function initializeDatabase() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('✓ Connected to MySQL database successfully.');

    // 1. Ensure 'password' column exists in 'users'
    const [passwordCol] = await connection.query("SHOW COLUMNS FROM `users` LIKE 'password'");
    if (passwordCol.length === 0) {
      console.log('Adding password column to users table...');
      await connection.query("ALTER TABLE `users` ADD COLUMN `password` VARCHAR(255) NULL");
    }

    // 2. Ensure PRIMARY KEY on users(user_id) with AUTO_INCREMENT
    const [userKeys] = await connection.query("SHOW KEYS FROM `users` WHERE Key_name = 'PRIMARY'");
    if (userKeys.length === 0) {
      await connection.query("ALTER TABLE `users` ADD PRIMARY KEY (`user_id`)");
    }
    await connection.query("ALTER TABLE `users` MODIFY COLUMN `user_id` INT NOT NULL AUTO_INCREMENT");

    // 3. Ensure PRIMARY KEY on vehicles(vehicle_id) with AUTO_INCREMENT
    const [vehKeys] = await connection.query("SHOW KEYS FROM `vehicles` WHERE Key_name = 'PRIMARY'");
    if (vehKeys.length > 0 && vehKeys[0].Column_name === 'user_id') {
      await connection.query("ALTER TABLE `vehicles` DROP PRIMARY KEY");
      await connection.query("ALTER TABLE `vehicles` ADD PRIMARY KEY (`vehicle_id`)");
    } else if (vehKeys.length === 0) {
      await connection.query("ALTER TABLE `vehicles` ADD PRIMARY KEY (`vehicle_id`)");
    }
    await connection.query("ALTER TABLE `vehicles` MODIFY COLUMN `vehicle_id` INT NOT NULL AUTO_INCREMENT");
    await connection.query("ALTER TABLE `vehicles` MODIFY COLUMN `user_id` INT NULL");

    // 4. Ensure AUTO_INCREMENT on parkingslot(slot_id)
    await connection.query("ALTER TABLE `parkingslot` MODIFY COLUMN `slot_id` INT NOT NULL AUTO_INCREMENT");

    // 5. Ensure PRIMARY KEY on parkingrecords(record_id) with AUTO_INCREMENT
    const [recKeys] = await connection.query("SHOW KEYS FROM `parkingrecords` WHERE Key_name = 'PRIMARY'");
    if (recKeys.length === 0) {
      await connection.query("ALTER TABLE `parkingrecords` ADD PRIMARY KEY (`record_id`)");
    }
    await connection.query("ALTER TABLE `parkingrecords` MODIFY COLUMN `record_id` INT NOT NULL AUTO_INCREMENT");

    // 6. Ensure parking_rates configuration table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ` + "`parking_rates`" + ` (
        ` + "`vehicle_type`" + ` VARCHAR(45) NOT NULL,
        ` + "`hourly_rate`" + ` DECIMAL(10,2) NOT NULL DEFAULT 20.00,
        PRIMARY KEY (` + "`vehicle_type`" + `)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Check if parking_rates has defaults
    const [rateCount] = await connection.query("SELECT COUNT(*) as cnt FROM `parking_rates`");
    if (rateCount[0].cnt === 0) {
      await connection.query(`
        INSERT INTO ` + "`parking_rates`" + ` (vehicle_type, hourly_rate) VALUES
        ('Bike', 10.00),
        ('Car', 20.00),
        ('Bus', 40.00),
        ('Truck', 50.00)
      `);
      console.log('Seeded default hourly parking rates (Bike: ₹10, Car: ₹20, Bus: ₹40, Truck: ₹50).');
    }

    // 7. Ensure at least one admin user exists for login
    const [adminExists] = await connection.query("SELECT * FROM `users` WHERE role IN ('admin', 'staff') LIMIT 1");
    if (adminExists.length === 0) {
      const hashedPass = await bcrypt.hash('admin123', 10);
      await connection.query(`
        INSERT INTO ` + "`users`" + ` (user_name, phone, email, role, password) VALUES
        ('Admin Jeevan', '9876543210', 'admin@parking.com', 'admin', ?)
      `, [hashedPass]);
      console.log('Default admin created: admin@parking.com / admin123');
    }

    console.log('✓ Database schema and initialization verified successfully.');
  } catch (err) {
    console.error('Database initialization warning/error:', err.message);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  initializeDatabase
};
