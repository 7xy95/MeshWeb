const { app, BrowserWindow, powerMonitor, globalShortcut,
    nativeTheme,session } = require("electron")
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

global.settings = storage.getSettings()
nativeTheme.themeSource = "dark"

let win = null
let reloading = false

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

function createWindow() {
    let win = new BrowserWindow({
        icon: path.join(__dirname, "assets", "icon.png"),
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
    win.webContents.on("will-attach-webview", (event, webPreferences) => {
        webPreferences.disableDialogs = false
    })

    win.webContents.on("did-attach-webview", (event, webContents) => {
        webContents.on("before-input-event", (event, input) => {
            if (BrowserWindow.getFocusedWindow() !== win) {return}
            if ((input.control || input.meta) && ["r", "w", "q", "t"].includes(input.key.toLowerCase())) {
                event.preventDefault()
            }
            if ((input.control || input.meta) && input.key.toLowerCase() === "n") {
                event.preventDefault()
                createWindow()
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
    let blocked = ["doubleclick.net", "googlesyndication.com", "googleadservices.com"]
    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["*://*/*"] },
        (details, callback) => {
            if (!global.settings.blockAds) {
                callback({cancel: false})
                return
            }
            let host = null
            try {host = new URL(details.url).hostname}
            catch {callback({}); return}

            let shouldBlock = blocked.some(domain => host === domain || host.endsWith("." + domain))
            callback({cancel: shouldBlock})
        }
    )
    session.defaultSession.setPermissionCheckHandler((webContents, permission, callback, details) => {
        let allowed = false
        if (permission === "media") {
            let types = details.mediaTypes || []
            allowed = types.length > 0 && types.every(type => {
                if (type === "audio") {return global.settings.allowMicrophone}
                if (type === "video") {return global.settings.allowCamera}
                return false
            })

        }
        else if (permission === "geolocation") {
            allowed = global.settings.allowLocation
        }
        else if (permission === "notifications") {
            allowed = global.settings.allowNotifications
        }

        return allowed
    })

    app.configureHostResolver({
        secureDnsMode: global.settings.encryptDNS ? "secure" : "automatic",
        secureDnsServers: global.settings.encryptDNS ? ["https://cloudflare-dns.com/dns-query"] : []
    })

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
app.on("before-quit", async () => {
    if (global.domains.length !== 0) {
        storage.saveDomains()
        if (global.settings.clearHistoryOnExit) {
            storage.clearHistory()
            storage.saveHistory()
        }
        if (global.settings.clearDataOnExit) {
            await session.defaultSession.clearData()
        }
    }
})

powerMonitor.on("resume", async () => {
    await global.sleep(10000)
    await network.getNodes()
    await sync.sync()
})