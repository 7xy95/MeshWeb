const { ipcMain } = require("electron")
const { globalShortcut } = require("electron")
const fs = require("fs")
const vm = require("vm")
const path = require("path")
const network = require("./js/networking.js")
const storage = require("./js/storage.js")
const sync = require("./js/sync.js")
require("./js/utils.js")
require("./js/new.js")
require("./js/mining.js")

global.domains = []
global.allNodes = ["https://node.meshcoin.org/"]
global.privateKey = null
global.publicKey = null

let win = null
let appStarted = false

global.require = require
global.__dirname = __dirname

async function attachWindow(window) {
    win = window
}


let ss = null
async function startApp(window) {
    if (appStarted) {return}
    appStarted = true
    win = window

    global.callRenderer = callRenderer
    global.edit = edit
    global.style = style
    global.value = value
    global.sendToRenderer = sendToRenderer

    await network.getNodes()
    void network.runServer()
    void network.checkAllNodes()

    if (ss === null) {
        ss = setInterval(() => {
            if (global.domains.length !== 0) {
                storage.saveDomains()
            }
        }, 30_000)
    }
}

ipcMain.on("main:run", (event, code) => {
    try {
        vm.runInThisContext(code)
    }
    catch (error) {
        console.log(error)
    }
})
ipcMain.handle("main:get", async (event, code) => {
    try {
        return await vm.runInThisContext(code)
    }
    catch (error) {
        console.log(error)
        return null
    }
})

function sendToRenderer(channel, data) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {return}
    win.webContents.send(channel, data)
}
function callRenderer(functionName, args = []) {
    sendToRenderer("ui:call", {
        functionName,
        args
    })
}
function edit(id, property, value) {
    sendToRenderer("ui:set", {id, property, value})
}
function style(id, property, value) {
    sendToRenderer("ui:style", {id, property, value})
}
async function value(id) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {return ""}
    try {
        return await win.webContents.executeJavaScript(
            "(() => {" +
            "const el = document.getElementById(" + JSON.stringify(id) + ");" +
            "return el ? el.value : '';" +
            "})()"
        )
    }
    catch (error) {
        console.log("value failed:", error.message)
        return ""
    }
}

module.exports = {
    startApp,
    attachWindow
}