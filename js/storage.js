const path = require("path")
const fs = require("fs")

const dataDir = process.env.userPath
const session = path.join(dataDir, "domains.json")

function getDomains() {
	try {
		if (!fs.existsSync(session)) {
			fs.writeFileSync(session, "[]")
		}
		return JSON.parse(fs.readFileSync(session, "utf-8"))
	}
	catch {
		return []
	}
}
function saveDomains() {
	fs.writeFileSync(session, JSON.stringify(global.domains))
}

module.exports = {
	getDomains,
	saveDomains
}