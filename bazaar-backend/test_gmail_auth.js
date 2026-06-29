import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const testAuth = async (user, pass) => {
  console.log(`Testing user: "${user}" with password: "${pass}"`);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user,
      pass: pass,
    },
  });

  try {
    await transporter.verify();
    console.log(`SUCCESS!`);
    return true;
  } catch (err) {
    console.log(`FAILED. Error: ${err.message}`);
    return false;
  }
};

async function run() {
  const user1 = 'bazarboost884@gmail.com'; // 1 'a'
  const user2 = 'bazaarboost884@gmail.com'; // 2 'a's
  const pass = 'xddp mcsz mztt lfae';
  
  console.log("--- TEST 1 ---");
  await testAuth(user1, pass);
  
  console.log("--- TEST 2 ---");
  await testAuth(user2, pass);

  console.log("--- TEST 3 (FROM ENV) ---");
  await testAuth(process.env.EMAIL_USER, process.env.EMAIL_PASS);
}

run();
