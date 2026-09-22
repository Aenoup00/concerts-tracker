const passHelper = require("./passwords.js");

let x = passHelper.createSHA256v2(process.argv[3], process.argv[2]);
console.log(x);

console.log(passHelper.createSHA256v1(process.argv[3]));
