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

    for (let i = 0; i++; i < 3) {
        let d = await reqRandNode()
        if (d === null) {i--; continue}
        for (let domain of d) {
            global.newDomain(domain)
        }
    }
    storage.saveDomains()
}

module.exports = {
    sync
}