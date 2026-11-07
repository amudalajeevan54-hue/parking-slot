# 🚗 Parking Slot Management System

A full-stack, enterprise-grade **Parking Slot Management System** designed for security personnel and parking operators to manage parking bays, register arriving and departing vehicles, assign available parking slots, record precise entry/exit timestamps, calculate parking charges automatically with customizable hourly rates, and generate real-time financial and utilization reports.

Built strictly with:
- **Frontend**: Pure HTML5, CSS3, Vanilla JavaScript (No React, Vue, Angular, or Bootstrap)
- **Backend**: Node.js & Express.js
- **Database**: MySQL (compatible with MySQL Workbench)
- **Environment**: Dotenv for credentials security

---

## 📁 Project Architecture & Folder Structure

```
parking-slot-management/
│
├── public/
│   ├── index.html               # Staff & Admin Login page
│   ├── dashboard.html           # Real-time metrics & telemetric surveillance
│   ├── vehicles.html            # Vehicle registration & CRUD management
│   ├── parking-slots.html       # Visual parking bay grid & rate config
│   ├── parking-records.html     # Parking records, receipts, and CSV export
│   ├── users.html               # Security staff & user management
│   ├── reports.html             # Financial revenue & slot utilization analytics
│   │
│   ├── css/
│   │   └── style.css            # Custom CSS3 design (Dark Navy + Modern Cards)
│   │
│   └── js/
│       ├── dashboard.js         # Dashboard telemetry & charts logic
│       ├── vehicles.js          # Vehicle CRUD & live search
│       ├── slots.js             # Slot visual grid & quick park/exit
│       ├── records.js           # Entry/exit workflow, receipts & CSV export
│       ├── users.js             # User & staff role management
│       └── reports.js           # Analytics & report tables
│
├── server.js                    # Express.js backend & REST API endpoints
├── db.js                        # MySQL connection pooling & auto-migration
├── package.json                 # Project dependencies & scripts
├── .env                         # MySQL connection configuration
└── README.md                    # Project documentation
```

---

## 🗄️ MySQL Database Schema

The system connects directly to your existing MySQL database: `parking`.

### 1. `users` Table
Stores system administrators, security staff, and vehicle owner profiles.
- `user_id` (INT, PRIMARY KEY, AUTO_INCREMENT)
- `user_name` (VARCHAR(45))
- `phone` (VARCHAR(45))
- `email` (VARCHAR(100))
- `role` (VARCHAR(20) - `'admin'`, `'staff'`, or `'customer'`)
- `password` (VARCHAR(255) - Bcrypt hashed password for secure login)

### 2. `vehicles` Table
Stores customer and visitor vehicles.
- `vehicle_id` (INT, PRIMARY KEY, AUTO_INCREMENT)
- `user_id` (INT - foreign reference to vehicle owner in `users`)
- `vehicle_number` (VARCHAR(30) - e.g. `KA-01-AB-1234`)
- `vehicle_type` (VARCHAR(45) - `Car`, `Bike`, `Bus`, `Truck`)
- `vehicle_model` (VARCHAR(45) - e.g. `Honda City`, `Royal Enfield`)

### 3. `parkingslot` Table
Stores physical parking bays with real-time status.
- `slot_id` (INT, PRIMARY KEY, AUTO_INCREMENT)
- `slot_number` (VARCHAR(45) - e.g. `A-101`, `B-201`)
- `vehicle_type` (VARCHAR(45) - Vehicle type allowed for this bay)
- `location` (VARCHAR(45) - e.g. `Basement 1 - Section A`)
- `status` (TINYINT - `0` = Available [Green], `1` = Occupied [Red])

### 4. `parkingrecords` Table
Maintains transaction logs of vehicle entry, exit, duration, and fees.
- `record_id` (INT, PRIMARY KEY, AUTO_INCREMENT)
- `vehicle_id` (INT)
- `slot_id` (INT)
- `entry_time` (DATETIME)
- `exit_time` (DATETIME - NULL while active)
- `parking_fee` (DECIMAL(10,2))
- `status` (VARCHAR(20) - `'parked'` or `'completed'`)

### 5. `parking_rates` Table (Safe Configuration Addition)
Provides editable hourly rates by vehicle type:
- `vehicle_type` (VARCHAR(45), PRIMARY KEY)
- `hourly_rate` (DECIMAL(10,2))
  - Bike: ₹10.00 / hour
  - Car: ₹20.00 / hour
  - Bus: ₹40.00 / hour
  - Truck: ₹50.00 / hour

---

## 🔒 Safe Schema Migration Details

When connecting to the existing database, `db.js` executed non-destructive schema enhancements:
1. **Added `password` Column**: Allowed bcrypt-hashed passwords for staff authentication without storing plain text.
2. **Corrected Primary Keys**: Set `user_id`, `vehicle_id`, and `record_id` to PRIMARY KEY with `AUTO_INCREMENT` so users can own multiple vehicles without key collisions.
3. **Seeded Realistic Data**: Initialized sample slots (Car, Bike, Bus, Truck), vehicles, active parking sessions, and staff accounts for immediate evaluation.

---

## ⚙️ Features & Capabilities

1. **Security Staff Authentication**:
   - Secure login supporting username or email.
   - Password encryption using Bcrypt.
   - Role-based access preview (Admin / Staff).

2. **Operations Dashboard**:
   - 8 Real-time metrics: Total Slots, Available Slots, Occupied Slots, Currently Parked, Total Registered Vehicles, Today's Entries, Today's Exits, and Total Revenue.
   - SVG visual occupancy donut gauge with live percentage calculation.
   - 7-Day revenue trend bar visualization.
   - Live activity log and recently registered vehicles stream.

3. **Vehicle Management (CRUD)**:
   - Full Create, Read, Update, and Delete operations.
   - Search by vehicle registration number, model, owner name, or phone.
   - Filter by vehicle type (Car, Bike, Bus, Truck).
   - Park status badges showing current assigned slot.

4. **Visual Parking Slot Grid**:
   - Color-coded bays: **Green (Available)** and **Red (Occupied)**.
   - Direct "Park Vehicle" action for free slots and "Exit & Bill" action for occupied slots.
   - Add/edit slot configurations.
   - Real-time rate management panel for Bike, Car, Bus, and Truck rates.

5. **Parking Entry & Exit with MySQL Transactions**:
   - **Entry**: Atomic MySQL transactions (`START TRANSACTION ... FOR UPDATE ... COMMIT`) prevent duplicate slot assignments.
   - **Exit**: Automatic duration calculation rounded up to the next billable hour (e.g. 2 hrs 30 mins = 3 billable hours).
   - **Backend Fee Calculation**: Multiplies billable hours by the vehicle type's hourly rate on the server.
   - **Receipt Generation**: Formatted printable parking slip with timestamps, duration breakdown, and total charges.

6. **Parking Records & Export**:
   - Filter records by status (`parked` vs `completed`) and date range.
   - One-click CSV export for external auditing and accounting.

7. **Reports & Analytics**:
   - Daily revenue breakdown (last 30 days).
   - Monthly revenue report (last 12 months).
   - Top 10 most frequently utilized parking bays.
   - Vehicle-type performance breakdown.

---

## 🚀 Installation & Running

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment
Verify `.env` has your MySQL Workbench connection credentials:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=jeevan
DB_NAME=parking
PORT=3000
```

### Step 3: Start Application
```bash
node server.js
```

### Step 4: Access in Web Browser
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🔑 Default Login Credentials

| Role | Username / Email | Password |
|---|---|---|
| **Administrator** | `admin@parking.com` | `admin123` |
| **Security Staff** | `suresh@parking.com` | `staff123` |

---

## 🧪 Verification & Testing Checklist

- [x] Verified MySQL database connection to `parking` at `localhost:3306`.
- [x] Inspected existing tables (`users`, `vehicles`, `parkingslot`, `parkingrecords`).
- [x] Implemented Express REST APIs with parameterization against SQL injection.
- [x] Tested Vehicle Registration, Update, and Search.
- [x] Tested Parking Entry with concurrency locks and duplicate prevention.
- [x] Tested Parking Exit with automatic fee computation and slot release.
- [x] Tested Visual Slot Grid with live status updates.
- [x] Tested CSV Export of parking records.
- [x] Verified Responsive Dashboard and live charts.
