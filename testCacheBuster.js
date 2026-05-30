require('dotenv').config();
require('./config/dataBase');
const Occasion = require('./models/occassion');
const cacheService = require('./services/cacheService');

async function test() {
    try {
        console.log("Setting dummy caches...");
        const tenantId = "6a16a4532933fa6bbb81cfad"; // From user's payload
        await cacheService.set(`stats:tenant:v2:${tenantId}`, { status: "cached" });
        await cacheService.set(`miqaats:tenant:v1:${tenantId}:5`, { status: "cached" });
        await cacheService.set(`stats:global:v2`, { status: "cached global" });

        const beforeGlobal = await cacheService.get(`stats:global:v2`);
        console.log("Before save global cache:", beforeGlobal);

        console.log("Creating dummy Occasion...");
        const newOccasion = new Occasion({
            tenantId,
            name: "Dummy Validation Miqaat",
            start_at: new Date(),
            ends_at: new Date()
        });
        
        // This should trigger the post('save') hook
        await newOccasion.save();

        console.log("Dummy Occasion saved! Id:", newOccasion._id);
        
        // Wait a small bit for async cache bust if needed, though await was used.
        await new Promise(r => setTimeout(r, 1000));

        const afterTenantStats = await cacheService.get(`stats:tenant:v2:${tenantId}`);
        const afterMiqaats = await cacheService.get(`miqaats:tenant:v1:${tenantId}:5`);
        const afterGlobal = await cacheService.get(`stats:global:v2`);

        console.log("After save, tenant stats cache exists?:", !!afterTenantStats);
        console.log("After save, miqaats cache exists?:", !!afterMiqaats);
        console.log("After save, global cache exists?:", !!afterGlobal);

        console.log("Deleting dummy occasion...");
        // This should trigger the post('findOneAndDelete') hook
        await Occasion.findByIdAndDelete(newOccasion._id);
        console.log("Deleted!");

        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
test();
