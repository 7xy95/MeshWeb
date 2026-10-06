const network = require("./networking.js")
const storage = require("./storage.js")

async function sync() {
    async function reqRandNode() {
        try {
            let node = global.allNodes[Math.floor(Math.random() * (global.allNodes.length))]
            let data = await network.get(node, `domains`)
            return data.domains
        } catch (error) {
            return null
        }
    }

    global.domains = storage.getDomains()

    if (global.allNodes.length === 0) {
        return
    }

    let f = 0
    for (let i = 0; i < 3; i++) {
        let d = await reqRandNode()
        if (d === null) {
            if (f<10) {
                i--
            }
            f++
            continue
        }
        for (let domain of d) {
            global.newDomain(domain, 2147483648n)
        }
    }
    storage.saveDomains()
}

module.exports = {
    sync
}