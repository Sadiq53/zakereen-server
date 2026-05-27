require('./config/dataBase');
const User = require('./models/users');
const Group = require('./models/group');

setTimeout(async () => {
    try {
        const user = await User.findOne({ belongsto: { $ne: '' } });
        console.log('User belongsto:', user ? user.belongsto : 'None');
        const group = await Group.findOne();
        console.log('Group members:', group ? group.members : 'None');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}, 3000);
