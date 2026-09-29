const { app, BrowserWindow, powerMonitor, globalShortcut, nativeTheme } = require("electron")
const path = require("path")
const fs = require("fs")
const http = require("node:http")
const { spawn } = require("node:child_process")

app.commandLine.appendSwitch("password-store", "basic")
app.commandLine.appendSwitch("use-mock-keychain")
app.commandLine.appendSwitch("disable-renderer-backgrounding")
app.commandLine.appendSwitch("disable-background-timer-throttling")
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion")

const dataDir = app.getPath("userData")
process.env.userPath = dataDir
global.dataDir = dataDir
fs.mkdirSync(dataDir, { recursive: true })

const main = require("./mainlogic")
const sync = require("./js/sync.js")
const storage = require("./js/storage.js")
const network = require("./js/networking.js")

let win = null
let reloading = false
let wakeReloadTimer = null

function reloadWindow() {
    if (reloading) return
    reloading = true

    if (win && !win.isDestroyed()) {
        win.webContents.reloadIgnoringCache()
    }
    else {
        createWindow()
    }

    setTimeout(() => {
        reloading = false
    }, 3000)
}

function scheduleWakeReload() {
    if (wakeReloadTimer) {
        clearTimeout(wakeReloadTimer)
    }

    wakeReloadTimer = setTimeout(() => {
        wakeReloadTimer = null
        reloadWindow()
    }, 10000)
}

function createWindow() {
    win = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            webviewTag: true
        }
    })

    win.maximize()
    win.loadFile("index.html")

    win.webContents.on("did-finish-load", () => {
        main.startApp(win)
        main.attachWindow(win)
    })

    win.webContents.on("render-process-gone", () => {
        reloadWindow()
    })

    win.webContents.on("unresponsive", () => {
        reloadWindow()
    })

    win.webContents.on("did-attach-webview", (event, webContents) => {
        webContents.on("before-input-event", (event, input) => {
            if (input.control || input.meta && ["r", "w"].includes(input.key.toLowerCase())) {
                event.preventDefault()
            }
            win.webContents.send("shortcut", input)
        })

        webContents.setWindowOpenHandler(({ url }) => {
            win.webContents.send("new-tab-url", url)
            return { action: "deny" }
        })
    })

    win.webContents.on("before-input-event", (event, input) => {
        if (input.control || input.meta && ["r", "w"].includes(input.key.toLowerCase())) {
            event.preventDefault()
        }
        win.webContents.send("shortcut", input)
    })

    win.on("closed", () => {
        win = null
        main.attachWindow(win)
    })
}

app.whenReady().then(async () => {
    createWindow()
})

app.on("activate", () => {
    if (!win || win.isDestroyed()) {
        createWindow()
    }
})
app.on("window-all-closed", (event) => {
    event.preventDefault()
})
app.on("will-quit", () => {
    globalShortcut.unregisterAll()
})
app.on("before-quit", () => {
    if (global.domains !== []) {
        storage.saveDomains()
    }
})

powerMonitor.on("resume", async () => {
    await global.sleep(5000)
    void sync.sync()
})