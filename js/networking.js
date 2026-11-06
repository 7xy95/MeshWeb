const http = require("node:http")
const { spawn } = require("node:child_process")
const { app, net } = require("electron")
const path = require("path")
const {sync} = require("./sync");

let server = null
let port = null
let tunnelProcess = null
let tunnelUrl = null

async function updateURL() {
    try {
        let html = await (await fetch("https://meshcoin.org/webNode")).text()
        const match = html.match(/https?:\/\/[^<\s]+/)
        if (!match) {
            throw new Error("No URL found")
        }
        let url = match[0].replace(/\/$/, "") + "/"
        if (!global.allNodes.includes(url) && url !== tunnelUrl) {
            global.allNodes.push(url)
        }
    }
    catch (error) {console.log(error)}
}
async function get(nodeUrl, request, timeout=3) {
    let controller = new AbortController()
    let timer = setTimeout(() => controller.abort(), timeout*1000)
    try {
        let response = await fetch(nodeUrl + request, {
            method: "GET",
            headers: {"Content-Type": "application/json"},
            signal: controller.signal
        })
        if (!response.ok) {
            console.log("GET error:", response.status, nodeUrl + request)
            console.log("Response:", (await response.text()).slice(0, 500))
            return null
        }

        return await response.json()
    }
    catch (error) {
        console.log("GET error:", nodeUrl + request, error)
        return null
    }
    finally {
        clearTimeout(timer)
    }
}

async function getNodes() {
    async function g(node) {
        try {
            let res = await get(node, "peers")
            let nodes = res.peers
            for (let n of nodes) {
                if (!global.allNodes.includes(n) && n !== tunnelUrl) {
                    global.allNodes.push(n)
                }
            }
            return true
        }
        catch (error) {return false}
    }
    if (global.allNodes.length === 0) {global.allNodes = ["https://node.meshcoin.org/"]}
    for (let i = 0; i<3; i++) {
        await g(global.allNodes[Math.floor(Math.random()*(global.allNodes.length))])
    }
}
async function shareUrl() {
    for (let i = 0; i<5; i++) {
        let randNode = global.allNodes[Math.floor(Math.random()*(global.allNodes.length))]
        if (randNode === undefined) {console.log("no nodes"); continue}
        void fetch(randNode + "node", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                node: tunnelUrl
            })
        }).catch(error => {console.log(error)})
    }
}
async function checkUrl() {
    let response = await get(tunnelUrl, "online")
    if (response === null && tunnelProcess) {
        tunnelProcess.kill()
    }
}

async function broadcastDomain(domain, n=15) {
    let randN = [...global.allNodes]
        .sort(() => Math.random() - 0.5)
        .slice(0, n)
    for (let node of randN) {
        void fetch(node + "domain", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                domain: domain,
                node: tunnelUrl
            })
        }).catch(error => {console.log(error)})
    }
}
async function broadcastNode(nodeUrl) {
    let randN = [...global.allNodes]
        .sort(() => Math.random() - 0.5)
        .slice(0, 15)
    for (let node of randN) {
        void fetch(node + "node", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                node: nodeUrl
            })
        }).catch(error => {console.log(error)})
    }
}

function getTunnelPath(name="tunnel") {
    if (process.platform === "win32") {
        if (app.isPackaged) {
            return path.join(process.resourcesPath, "bin", "win-x64", `${name}.exe`)
        }

        return path.join(__dirname, "..", "bin", "win-x64", `${name}.exe`)
    }
    if (process.platform === "darwin" && process.arch === "arm64") {
        if (app.isPackaged) {
            return path.join(process.resourcesPath, "bin", "mac-arm64", name)
        }

        return path.join(__dirname, "..", "bin", "mac-arm64", name)
    }
    if (process.platform === "darwin" && process.arch === "x64") {
        if (app.isPackaged) {
            return path.join(process.resourcesPath, "bin", "mac-x64", name)
        }

        return path.join(__dirname, "..", "bin", "mac-x64", name)
    }
}

async function runServer() {
    function readBody(req, maxSize) {
        return new Promise((resolve, reject) => {
            let body = ""
            let size = 0
            let done = false
            req.on("data", chunk => {
                if (done) {return}
                body += chunk.toString()
                size += chunk.length
                if (size > maxSize) {
                    done = true
                    reject(new Error("Body too large"))
                    return
                }
            })
            req.on("end", () => {
                if (!done) {
                    resolve(body)
                }
            })
            req.on("error", reject)
        })
    }
    function sendJSON(res, statusCode, data) {
        res.writeHead(statusCode, {
            "Content-Type": "application/json"
        })
        res.end(JSON.stringify(data))
    }
    if (server) {return}

    server = http.createServer({
        maxHeaderSize: 2048
    }, async (req, res) => {
        try {
            if (req.method === "GET" && req.url === "/routes") {
                sendJSON(res, 200, {
                    ok: true,
                    routes: JSON.stringify(["/peers", "/online", "/hash",
                        "/routes", "/domains", "/domains?chars", "/domains?name", "/domains?key"])
                })
            }
            if (req.method === "GET" && req.url === "/peers") {
                sendJSON(res, 200, {
                    ok: true,
                    peers: global.allNodes
                })
                return
            }
            if (req.method === "GET" && req.url === "/online") {
                sendJSON(res, 200, {
                    ok: true
                })
                return
            }
            if (req.method === "GET" && req.url === "/hash") {
                global.sortDomains()
                sendJSON(res, 200, {
                    ok: true,
                    hash: require("crypto").createHash("sha256").update(JSON.stringify(global.domains)).digest("hex")
                })
                return
            }
            if (req.method === "GET" && req.url === "/domains") {
                sendJSON(res, 200, {
                    ok: true,
                    domains: global.domains
                })
                return
            }
            if (req.method === "GET" && req.url.startsWith("/domains?chars")) {
                let u = new URL(req.url, "http://localhost")
                let chars = JSON.parse(u.searchParams.get("chars"))

                let matches = []
                for (let char of chars) {
                    matches.push(...domains.filter((d) => d[0].startsWith(char)))
                }
                if (matches.length > 2048) {
                    sendJSON(res, 422, {
                        ok: false,
                        error: "Too Many Matching Domains",
                        matches: matches.length,
                        limit: 2048
                    })
                }
                else {
                    sendJSON(res, 200, {
                        ok: true,
                        domains: matches
                    })
                }
                return
            }
            if (req.method === "GET" && req.url.startsWith("/domains?name")) {
                let u = new URL(req.url, "http://localhost")
                let name = u.searchParams.get("name")
                let domain = global.domains.find((d) => d[0] === name)
                if (!domain) {
                    sendJSON(res, 404, {
                        ok: false,
                        error: "Domain Not Found"
                    })
                }
                else {
                    sendJSON(res, 200, {
                        ok: true,
                        domain: domain
                    })
                }
                return
            }
            if (req.method === "GET" && req.url.startsWith("/domains?key")) {
                let u = new URL(req.url, "http://localhost")
                let key = u.searchParams.get("key")
                let domains = global.domains.filter((d) => d[1] === key)
                sendJSON(res, 200, {
                    ok: true,
                    domains: domains
                })
                return
            }

            async function parsePOST(req, res, maxSize) {
                let body = null
                try {
                    body = await readBody(req, maxSize)
                }
                catch (error) {
                    sendJSON(res, 413, {
                        ok: false,
                        error: "Request body too large"
                    })
                    return "return"
                }
                let data = null
                try {
                    data = JSON.parse(body)
                    return data
                }
                catch (error) {
                    sendJSON(res, 400, {
                        ok: false,
                        error: "Invalid JSON"
                    })
                    return "return"
                }
            }
            if (req.method === "POST" && req.url === "/domain") {
                let data = await parsePOST(req, res, 1024)
                if (data === "return") {return}

                sendJSON(res, 200, { ok: true })

                let valid = global.newDomain(data.domain)
                if (!valid) {return}

                void broadcastDomain(data.domain)
                return
            }
            if (req.method === "POST" && req.url === "/node") {
                let data = await parsePOST(req, res, 1024)
                if (data === "return") {return}
                try {
                    let url = new URL(data.node)
                    if (url.protocol !== "https:") {return}
                }
                catch (error) {return}

                sendJSON(res, 200, {
                    ok: true
                })
                if (global.allNodes.includes(data.node) || data.node === tunnelUrl) {return}
                let online = await get(data.node, "online")
                if (!online?.ok) {return}

                global.allNodes.push(data.node)
                void broadcastNode(data.node)
                return
            }

            sendJSON(res, 404, {
                ok: false,
                error: "Invalid Endpoint"
            })
        }
        catch (error) {
            sendJSON(res, 500, {
                ok: false,
                error: error
            })
        }
    })

    let isSpecial = false

    server.on("listening", () => {
        console.log("LISTENING:", server.address())
    })
    server.listen(isSpecial ? 8787 : 0, isSpecial ? "127.0.0.1" : "0.0.0.0", async () => {
        port = server.address().port
        if (isSpecial) {
            tunnelUrl = "https://node.meshcoin.org/"
            global.tunnelUrl = tunnelUrl
            await getNodes()
            await checkAllNodes(true)
            await shareUrl()

            void require("./sync.js").sync()
        }
        else {
            startTunnel()
        }
    })
    function startTunnel(provider = "cloudflared") {
        let gotUrl = false
        let isChecking = false

        if (tunnelProcess) {return}
        if (!port) {return}
        let tunnelTimeout = setTimeout(() => {
            if (!gotUrl && tunnelProcess) {
                tunnelProcess.kill()
            }
        }, 60000)
        async function tunnelOutput(text) {
            console.log(text)
            if (!gotUrl) {
                let match = text.match(provider === "bore" ? /https:\/\/[a-zA-Z0-9-]+\.trybore\.com/ : /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/)
                if (!match) {
                    return
                }
                tunnelUrl = match[0] + "/"
                global.tunnelUrl = tunnelUrl
                console.log(`tunnel url: ${tunnelUrl}`)
                gotUrl = true
                clearTimeout(tunnelTimeout)
                await updateURL()
                await getNodes()
                await checkAllNodes(true)
                void require("./sync.js").sync()
                if (provider === "bore") {
                    void checkTunnel()
                    await shareUrl()
                }
                if (provider === "cloudflared" && !isChecking) {
                    isChecking = true
                    await sleep(20_000)
                    void checkTunnel()
                    void shareUrl()
                }
            }
        }

        const pty = require("node-pty")
        function onTunnelExit(code) {
            console.log(`${provider} tunnel closed: ${code}`)

            clearTimeout(tunnelTimeout)
            tunnelProcess = null
            tunnelUrl = null
            global.tunnelUrl = null

            setTimeout(() => {
                startTunnel(process.platform === "win32" ? "cloudflared" : provider === "cloudflared" ? "bore" : "cloudflared")
            }, 5000)
        }
        if (provider === "cloudflared") {
            tunnelProcess = spawn(
                getTunnelPath("cloudflared"),
                [
                    "tunnel",
                    "--protocol",
                    "http2",
                    "--url",
                    `http://127.0.0.1:${port}`
                ],
                {windowsHide: true}
            )
            tunnelProcess.stdout.on("data", data => {
                void tunnelOutput(data.toString())
            })

            tunnelProcess.stderr.on("data", data => {
                void tunnelOutput(data.toString())
            })

            tunnelProcess.on("error", error => {
                console.error("Cloudflared error:", error)
            })

            tunnelProcess.on("close", code => {
                onTunnelExit(code)
            })
        }
        else if (provider === "bore") {
            tunnelProcess = pty.spawn(
                getTunnelPath("tunnel"),
                [`-u=http://127.0.0.1:${port}`],
                {
                    name: "xterm-256color",
                    cols: 160,
                    rows: 24
                }
            )

            tunnelProcess.onData(data => {
                void tunnelOutput(data)
            })
            tunnelProcess.onExit(({exitCode}) => {
                onTunnelExit(exitCode)
            })
        }
    }
}

let stopChecking = false
async function checkTunnel() {
    let currentProcess = tunnelProcess
    let fails = 0
    while (currentProcess === tunnelProcess) {
        try {
            let response = await net.fetch(tunnelUrl + "online", {
                signal: AbortSignal.timeout(5000)
            })
            if (!response.ok) {
                fails++
                if (fails >= 3) {
                    console.log(`Tunnel restarted, ${tunnelUrl}`)
                    currentProcess.kill()
                    return
                }
            }
            else {
                fails = 0
            }
        }
        catch (error) {
            console.log(error)
            fails++
            if (fails >= 3) {
                console.log(`Tunnel restarted, ${tunnelUrl}`)
                currentProcess.kill()
                return
            }
        }
        await global.sleep(2500)
    }
}

let checking = false
async function checkAllNodes(once=false) {
    if (checking) {return}
    checking = true
    while (true) {
        try {
            let results = await Promise.all(
                global.allNodes.map(async node => {
                    let data = await get(node, "online", 6)
                    return {node: node, data: data}
                })
            )

            for (let r of results) {
                if (!r.data || !r.data.ok) {
                    let i = global.allNodes.indexOf(r.node)
                    if (i !== -1) {
                        global.allNodes.splice(i, 1)
                    }
                }
            }
            if (once) {checking = false; return}
            if (Math.random() < 0.5) {
                void shareUrl()
                void getNodes()
            }
            void require("./sync.js").sync(1, false)

            await global.sleep(30000)
        }
        catch {}
    }
}
function getPort() {
    return port
}

module.exports = {
    runServer,
    checkAllNodes,
    get,
    getPort,
    getNodes,
    tunnelUrl,
    broadcastDomain
}