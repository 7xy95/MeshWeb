const path = require("path")
const fs = require("fs")

const dataDir = process.env.userPath
const session = path.join(dataDir, "domains.json")
const peers = path.join(dataDir, "peers.json")
const history = path.join(dataDir, "history.json")
const settings = path.join(dataDir, "settings.json")

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

function getPeers() {
	try {
		if (!fs.existsSync(peers)) {
			fs.writeFileSync(peers, JSON.stringify(["https://node.meshcoin.org/"]))
		}
		return JSON.parse(fs.readFileSync(peers, "utf-8"))
	}
	catch {
		return ["https://node.meshcoin.org/"]
	}
}
function savePeers() {
	fs.writeFileSync(peers, JSON.stringify(global.allNodes))
}

function getSettings() {
	let defaultSettings = {
		"searchEngine": "https://www.google.com/search?",
		"saveHistory": true}
	try {
		if (!fs.existsSync(settings)) {
			fs.writeFileSync(settings, JSON.stringify(defaultSettings))
		}
		return JSON.parse(fs.readFileSync(settings, "utf-8"))
	}
	catch {
		return defaultSettings
	}
}
function saveSettings() {
	fs.writeFileSync(settings, JSON.stringify(global.settings))
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
	if (!global.settings.saveHistory) {return}
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
	getPeers,
	savePeers,
	getHistory,
	saveHistory,
	getSettings,
	saveSettings,
	addHistory,
	clearHistory
}