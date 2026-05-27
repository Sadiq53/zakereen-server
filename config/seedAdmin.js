const userClient = require('../models/users');
const { hashPassword } = require('../middlewares/auth');

const ROOT_ADMIN = {
  fullname: 'Jafar Us Sadiq',
  userid: '50480993',
  address: '941, Noorani Nagar, Indore',
  phone: '8319321198',
  email: 'jafarussadiq.work@gmail.com',
  role: 'rootadmin',
  tenantId: null,
  title: 'tipper',
  belongsto: '',
  grade: 'A',
  attendence: [],
  profileImage: {
    s3Url: '',
    s3Key: '',
  },
};

const seedRootAdmin = async () => {
  try {
    const existingAdmin = await userClient.findOne({ userid: ROOT_ADMIN.userid, role: 'rootadmin' });

    if (existingAdmin) {
      console.log('✅ Root admin already exists, skipping seed.');
      return;
    }

    // Hash the userid as the default password
    const hashedPass = await hashPassword(ROOT_ADMIN.userid);

    const admin = new userClient({
      ...ROOT_ADMIN,
      userpass: hashedPass,
      createdat: new Date(),
      updatedat: new Date(),
    });

    await admin.save();
    console.log('✅ Root admin seeded successfully.');
  } catch (error) {
    console.error('❌ Error seeding root admin:', error);
  }
};

module.exports = { seedRootAdmin };
