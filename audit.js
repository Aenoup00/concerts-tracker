const fs = require("fs");
const path = require("path");

const logFilePath = path.join(__dirname, "data", "audit_log.json");

module.exports.logAction = (username, action) => {
	let logs = [];
	if (fs.existsSync(logFilePath)) {
		logs = JSON.parse(fs.readFileSync(logFilePath, "utf8") || "[]");
	}

	logs.push({
		username: username || "Guest",
		action: action,
		timestamp: new Date().toISOString(),
	});

	fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
};
