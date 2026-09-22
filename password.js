const crypto = require("crypto");

module.exports.createSHA256v1 = (text) => {
	const hash = crypto.createHash("sha256");
	hash.update(text);
	const output = hash.digest("hex");
	return output;
};

module.exports.createSHA256v2 = (text, salt) => {
	const hash = crypto.createHash("sha256");
	hash.update(salt + text + salt);
	const output = hash.digest("hex");
	return output;
};
