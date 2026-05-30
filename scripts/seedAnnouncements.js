require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/tenant');
const User = require('../models/users');
const AnnouncementGroup = require('../models/announcementGroup');

async function seed() {
    try {
        // Mongoose connection is handled automatically by require('../models/...')
        // We just need to wait a tiny bit to ensure it is connected, but actually mongoose queues operations.
        console.log('Using active database connection from config/dataBase.js...');

        // 1. Find a rootadmin to act as the creator of default groups
        const rootAdmin = await User.findOne({ role: 'rootadmin' });
        if (!rootAdmin) {
            console.error('No rootadmin found. Please create a rootadmin user first.');
            process.exit(1);
        }
        console.log(`Using rootadmin ${rootAdmin._id} as creator.`);

        // 2. Ensure Global Jamiat group exists
        const globalJamiat = await AnnouncementGroup.findOneAndUpdate(
            { type: 'global_jamiat' },
            {
                $setOnInsert: {
                    name: 'Indore Jamiat',
                    description: 'Official announcements for all Jamaat members across the Jamiat.',
                    type: 'global_jamiat',
                    tenantId: null,
                    isReadOnly: true,
                    createdBy: rootAdmin._id,
                    admins: [rootAdmin._id],
                }
            },
            { upsert: true, new: true }
        );
        console.log(`Global Jamiat Group verified/created: ${globalJamiat._id}`);

        // 3. Ensure a Jamaat group exists for every tenant
        const tenants = await Tenant.find({});
        console.log(`Found ${tenants.length} tenants. Verifying Jamaat groups...`);

        let createdCount = 0;
        for (const tenant of tenants) {
            // Determine who the creator/admin should be (use tenant coordinator if available, else rootAdmin)
            const groupAdminId = tenant.coordinator || rootAdmin._id;

            const jamaatGroup = await AnnouncementGroup.findOneAndUpdate(
                { tenantId: tenant._id, type: 'tenant_jamaat' },
                {
                    $setOnInsert: {
                        name: `${tenant.name} Announcements`,
                        description: `Official announcements for ${tenant.name} Jamaat members.`,
                        type: 'tenant_jamaat',
                        tenantId: tenant._id,
                        isReadOnly: true,
                        createdBy: groupAdminId,
                        admins: [groupAdminId],
                    }
                },
                { upsert: true, new: false } // new: false means if it returned null before update, it was inserted. But actually findOneAndUpdate with upsert returns the found doc if not upserted (if new:false).
            );
            
            if (!jamaatGroup) {
                createdCount++;
            }
        }
        console.log(`Successfully created ${createdCount} new Jamaat groups.`);
        console.log('Seed completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Seed failed:', error);
        process.exit(1);
    }
}

seed();
