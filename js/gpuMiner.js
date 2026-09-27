const { BrowserWindow, ipcMain } = require("electron")
const path = require("path")

const BATCH_SIZE = 50_000_000
const MAX_NONCE = (1n << 64n) - 1n

let gpuMinerWindow = null
let gpuMinerReady = null
let gpuJobId = 0
let gpuJobs = new Map()

function createGpuMinerWindow() {
    if (gpuMinerWindow && !gpuMinerWindow.isDestroyed()) {
        return gpuMinerWindow
    }

    gpuMinerWindow = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false
        }
    })

    gpuMinerWindow.loadFile(
        path.join(__dirname, "gpuMinerWindow.html")
    )

    gpuMinerWindow.on("closed", () => {
        gpuMinerWindow = null
        gpuMinerReady = null

        for (let job of gpuJobs.values()) {
            job.resolve({
                ok: false,
                nonce: "0",
                hash: null,
                attempts: 0,
                error: "GPU miner window closed"
            })
        }

        gpuJobs.clear()
    })

    return gpuMinerWindow
}

async function initGpuMiner() {
    if (gpuMinerReady) {
        return gpuMinerReady
    }

    gpuMinerReady = new Promise((resolve, reject) => {
        let minerWindow = createGpuMinerWindow()

        minerWindow.webContents.once("did-finish-load", () => {
            resolve(true)
        })

        minerWindow.webContents.once(
            "did-fail-load",
            (event, code, description) => {
                gpuMinerReady = null
                reject(new Error(description))
            }
        )
    })

    return gpuMinerReady
}

ipcMain.on("gpu:result", (event, data) => {
    let job = gpuJobs.get(data.id)
    if (!job) {return}

    gpuJobs.delete(data.id)
    job.resolve(data.result)
})

async function mine(domain, publicKey, startNonce = 0n) {
    await initGpuMiner()

    if (!gpuMinerWindow || gpuMinerWindow.isDestroyed()) {
        return {
            ok: false,
            nonce: "0",
            hash: null,
            attempts: 0,
            error: "GPU miner window unavailable"
        }
    }

    try {
        startNonce = BigInt(startNonce)
    }
    catch {
        throw new Error("startNonce must be an integer or integer string")
    }

    if (startNonce < 0n) {
        throw new Error("startNonce must be non-negative")
    }

    if (startNonce + BigInt(BATCH_SIZE) - 1n > MAX_NONCE) {
        throw new Error("Mining batch exceeds uint64 nonce range")
    }

    const startNonceLow =
        Number(startNonce & 0xffffffffn)

    const startNonceHigh =
        Number((startNonce >> 32n) & 0xffffffffn)

    // MUST match verifier:
    // sha256(domain + publicKey + nonce)
    const prefix = domain + publicKey

    let id = ++gpuJobId

    return await new Promise(resolve => {
        gpuJobs.set(id, {resolve})

        gpuMinerWindow.webContents.send("gpu:mine", {
            id,
            prefix,
            startNonceLow,
            startNonceHigh,
            attempts: BATCH_SIZE
        })
    })
}

module.exports = {
    mine,
    initGpuMiner,
    BATCH_SIZE,
    MAX_NONCE
}
