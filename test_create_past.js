require('dotenv').config();
const mongoose = require('./config/dataBase');
const occasionService = require('./services/occasionService');

async function test() {
    // Wait for connection to open
    while (mongoose.connection.readyState !== 1) {
        await new Promise(r => setTimeout(r, 100));
    }
    
    console.log('Connected to DB');
    const tenantId = '6a16a4532933fa6bbb81cfad'; 
    const userId = '6a16a3dda51f3dd1eb9d53dd'; 
    
    const occasionData = {
        name: "Test Occasion Script 3",
        start_at: "2026-06-30",
        time: "20:30",
        created_by: userId,
        events: [],
        attendance: [{ userId: userId, status: "present" }]
    };
    
    try {
        console.log('Creating past occasion...');
        const newOccasion = await occasionService.createPastOccasion(tenantId, occasionData, { role: 'superadmin' });
        console.log('Created!', newOccasion._id);
        
        const Attendance = require('./models/attendance');
        const atts = await Attendance.find({ occasion: newOccasion._id });
        console.log('Attendances created:', atts.length);
        console.log(atts);
    } catch (err) {
        console.error('Failed', err);
    }
    
    process.exit(0);
}

test();
