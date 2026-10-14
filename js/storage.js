const path = require("path")
const fs = require("fs")

const dataDir = process.env.userPath
const session = path.join(dataDir, "domains.json")
const history = path.join(dataDir, "history.json")

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

function getHistory() {
	try {
		if (!fs.existsSync(history)) {
			fs.writeFileSync(history, "{}")
		}
		return JSON.parse(fs.readFileSync(history, "utf-8"))
	}
	catch {
		return {}
	}
}
function saveHistory() {
	fs.writeFileSync(history, JSON.stringify(global.searchHistory))
	console.log(global.searchHistory)
}
function addHistory(url) {
	if (!checkUrl(url)) {return}
	if (url.includes("://")) {
		url = url.split("://")[1]
	}
	if (url.includes("www.")) {
		url = url.split("www.")[1]
	}
	let search = global.searchHistory[url]
	if (search) { global.searchHistory[url] += 1 }
	else { global.searchHistory[url] = 1 }
}
function clearHistory() {
	global.searchHistory = {}
	fs.writeFileSync(history, JSON.stringify({}))
}

function checkUrl(url) {
	if (url.startsWith("mesh://")) {return false}
	if (url.length > 128) {return false}
	if (url.includes("accounts.google.com/")) {return false}
	if (url.includes("google.com/search")) {return false}
	return true
}

module.exports = {
	getDomains,
	saveDomains,
	getHistory,
	saveHistory,
	addHistory,
	clearHistory
}